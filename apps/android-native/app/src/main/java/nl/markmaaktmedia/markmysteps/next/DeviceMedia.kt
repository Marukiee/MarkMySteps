package nl.markmaaktmedia.markmysteps.next

import android.content.ContentUris
import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.provider.MediaStore
import android.util.Size
import androidx.compose.runtime.mutableIntStateOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.time.LocalDate
import java.time.ZoneId

/**
 * Photos from this phone's own gallery in a trip, without uploading them, as the web's deviceMedia.ts: the
 * gallery is searched for photos and videos of the trip's days and they join the timeline and the map. They
 * stay only on this phone (companions do not see them, they are not in a share link, a new phone does not
 * have them) and the files themselves are never touched; unlinking only forgets them.
 *
 * Their ids start with "device:" followed by the content URI, so Photos reads them from the phone and every
 * server action (reactions, comments, cover, Immich) can leave them out.
 */
object DeviceMedia {
    const val PREFIX = "device:"
    private var prefs: android.content.SharedPreferences? = null
    private var app: Context? = null
    /** Bumped on every link or unlink, so pages that show the count read it again. */
    val version = mutableIntStateOf(0)

    fun init(context: Context) {
        app = context.applicationContext
        prefs = context.getSharedPreferences("mms.next.device", Context.MODE_PRIVATE)
    }

    fun isDevice(id: String) = id.startsWith(PREFIX)
    private fun uriOf(id: String): Uri = Uri.parse(Uri.decode(id.removePrefix(PREFIX)))
    private fun key(trip: Trip) = trip.remoteId ?: trip.id

    private fun rows(trip: Trip): JSONArray = runCatching { JSONArray(prefs?.getString(key(trip), "[]") ?: "[]") }.getOrDefault(JSONArray())

    fun count(trip: Trip): Int = rows(trip).length()

    fun list(trip: Trip): List<Media> {
        val a = rows(trip)
        // The day it was taken where it was taken, as the server's photos have it (PhotoDay): a photo from this
        // phone was taken in the zone the phone is in.
        val zone = ZoneId.systemDefault()
        return (0 until a.length()).mapNotNull { a.optJSONObject(it) }.map { o ->
            val w = o.optInt("w"); val h = o.optInt("h")
            Media(
                id = PREFIX + Uri.encode(o.getString("uri")),
                takenAt = java.time.Instant.ofEpochMilli(o.getLong("at")).atZone(zone).toLocalDate(),
                video = o.optBoolean("video"),
                ratio = if (w > 0 && h > 0) w.toFloat() / h else 1f,
                sized = w > 0 && h > 0,
                userId = Data.me?.id ?: "",
                lat = o.optDouble("lat").takeIf { o.has("lat") && !it.isNaN() },
                lon = o.optDouble("lon").takeIf { o.has("lon") && !it.isNaN() },
                at = o.getLong("at"),
            )
        }
    }

    /** The picture behind a Photos key ("device:…/thumbnail"), read from the phone; null for anything else. */
    fun bytes(key: String): ByteArray? {
        if (!key.startsWith(PREFIX)) return null
        val context = app ?: return null
        val id = key.substringBeforeLast('/')
        val size = key.substringAfterLast('/')
        val uri = uriOf(id)
        return runCatching {
            if (size == "original" && !isVideo(uri)) {
                context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
            } else {
                val edge = if (size == "thumbnail") 480 else 1600
                val bitmap = context.contentResolver.loadThumbnail(uri, Size(edge, edge), null)
                ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) }.toByteArray()
            }
        }.getOrNull()
    }

    private fun isVideo(uri: Uri) = uri.toString().contains("/video/")

    /** The address a video plays from: its own content URI. */
    fun videoUri(id: String): String = uriOf(id).toString()

    data class Result(val found: Int, val added: Int, val hasLocation: Boolean)

    /** The permissions to ask before [link]: the gallery, and the places in photos for the map. */
    fun permissions(): Array<String> = if (android.os.Build.VERSION.SDK_INT >= 33) {
        arrayOf(android.Manifest.permission.READ_MEDIA_IMAGES, android.Manifest.permission.READ_MEDIA_VIDEO, android.Manifest.permission.ACCESS_MEDIA_LOCATION)
    } else arrayOf(android.Manifest.permission.READ_EXTERNAL_STORAGE, android.Manifest.permission.ACCESS_MEDIA_LOCATION)

    /** Searches the gallery for the trip's days and adds what is not there yet. Reads only; writes nothing to the server. */
    suspend fun link(context: Context, trip: Trip): Result = withContext(Dispatchers.IO) {
        val start = trip.start ?: return@withContext Result(0, 0, false)
        val end = start.plusDays((trip.days - 1).coerceAtLeast(0).toLong())
        val zone = ZoneId.systemDefault()
        val from = start.atStartOfDay(zone).toInstant().toEpochMilli()
        val to = end.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
        val hasLocation = context.checkSelfPermission(android.Manifest.permission.ACCESS_MEDIA_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
        val found = mutableListOf<JSONObject>()
        fun query(collection: Uri, video: Boolean) {
            val projection = arrayOf(MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DATE_TAKEN, MediaStore.MediaColumns.WIDTH, MediaStore.MediaColumns.HEIGHT, MediaStore.MediaColumns.ORIENTATION)
            context.contentResolver.query(
                collection, projection,
                "${MediaStore.MediaColumns.DATE_TAKEN} >= ? AND ${MediaStore.MediaColumns.DATE_TAKEN} < ?", arrayOf(from.toString(), to.toString()),
                "${MediaStore.MediaColumns.DATE_TAKEN} ASC",
            )?.use { c ->
                while (c.moveToNext()) {
                    val uri = ContentUris.withAppendedId(collection, c.getLong(0))
                    var w = c.getInt(2); var h = c.getInt(3)
                    if (c.getInt(4) % 180 == 90) { val t = w; w = h; h = t }
                    val o = JSONObject().put("uri", uri.toString()).put("at", c.getLong(1)).put("video", video).put("w", w).put("h", h)
                    if (!video && hasLocation) runCatching {
                        context.contentResolver.openInputStream(MediaStore.setRequireOriginal(uri))?.use { input ->
                            val ll = FloatArray(2)
                            if (android.media.ExifInterface(input).getLatLong(ll)) o.put("lat", ll[0].toDouble()).put("lon", ll[1].toDouble())
                        }
                    }
                    found += o
                }
            }
        }
        runCatching { query(MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL), false) }
        runCatching { query(MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL), true) }
        val a = rows(trip)
        val known = (0 until a.length()).mapNotNull { a.optJSONObject(it)?.optString("uri") }.toSet()
        val fresh = found.filter { it.getString("uri") !in known }
        fresh.forEach { a.put(it) }
        prefs?.edit()?.putString(key(trip), a.toString())?.apply()
        withContext(Dispatchers.Main) { version.intValue++ }
        Result(found.size, fresh.size, hasLocation)
    }

    /** Forgets them again; the photos stay in the gallery. Returns how many. */
    fun unlink(trip: Trip): Int {
        val n = count(trip)
        prefs?.edit()?.remove(key(trip))?.apply()
        version.intValue++
        return n
    }
}
