package nl.markmaaktmedia.markmysteps.next

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLDecoder
import java.time.LocalDate
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/*
 * What the photo viewer asks the server for beyond the photos themselves, as
 * the web's viewer does (viewerTools.ts): the covers, the file as it was
 * taken, the link into Immich, and the name of the place a photo was taken.
 */
object ViewerApi {
    /** A stop as the server plans it, day trips included, with the days it covers. */
    data class StopRow(
        val id: String, val name: String, val lat: Double?, val lon: Double?,
        val arrival: LocalDate?, val departure: LocalDate?, val dayTrip: Boolean,
    )

    suspend fun stops(trip: Trip): List<StopRow> {
        val a = JSONArray(Api.get("/api/trips/${trip.remoteId}/stops"))
        fun day(o: JSONObject, k: String) = o.optString(k).take(10).takeIf { it.length == 10 }?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
        return (0 until a.length()).map { a.getJSONObject(it) }.sortedBy { it.optInt("orderIndex") }.map { o ->
            StopRow(
                id = o.getString("id"), name = o.optString("name"),
                lat = o.optDouble("latitude").takeIf { !o.isNull("latitude") && !it.isNaN() },
                lon = o.optDouble("longitude").takeIf { !o.isNull("longitude") && !it.isNaN() },
                arrival = day(o, "arrivalDate"), departure = day(o, "departureDate"),
                dayTrip = !o.isNull("parentStopId"),
            )
        }
    }

    /**
     * The stop a photo belongs to, as the web decides it (stopForPhoto): of the stops that cover its day the
     * nearest one within 30 km, else the nearest of all within 30 km, else the first stop (no day trip) that
     * covers the day.
     */
    fun stopFor(media: Media, stops: List<StopRow>): StopRow? {
        val day = media.takenAt
        val covering = stops.filter { s -> s.arrival != null && s.departure != null && !day.isBefore(s.arrival) && !day.isAfter(s.departure) }
        if (media.lat != null && media.lon != null) {
            fun nearest(list: List<StopRow>) = list.filter { it.lat != null && it.lon != null }
                .map { it to km(media.lat, media.lon, it.lat!!, it.lon!!) }.minByOrNull { it.second }
            nearest(covering)?.takeIf { it.second <= NEAR_KM }?.let { return it.first }
            nearest(stops)?.takeIf { it.second <= NEAR_KM }?.let { return it.first }
        }
        return covering.firstOrNull { !it.dayTrip }
    }

    private const val NEAR_KM = 30.0

    private fun km(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val r = Math.toRadians(1.0)
        val a = sin((lat2 - lat1) * r / 2).pow(2) + cos(lat1 * r) * cos(lat2 * r) * sin((lon2 - lon1) * r / 2).pow(2)
        return 2 * 6371.0 * asin(sqrt(a))
    }

    /** The trip's cover (owner only). Exactly the field the server's UpdateTripDto takes. */
    suspend fun setTripCover(trip: Trip, mediaId: String) {
        Api.send("PATCH", "/api/trips/${trip.remoteId}", JSONObject().put("coverMediaId", mediaId))
    }

    /** One stop's cover (owner only), as UpdateStopDto takes it. */
    suspend fun setStopCover(trip: Trip, stopId: String, mediaId: String) {
        Api.send("PATCH", "/api/trips/${trip.remoteId}/stops/$stopId", JSONObject().put("coverMediaId", mediaId))
    }

    private var immich: String? = null
    private var immichAsked = false
    /** Signing out: the next account must not see this one's Immich address. */
    fun reset() { immich = null; immichAsked = false }

    /** Where your own Immich opens in a browser: its public address; null hides "Openen in Immich". */
    suspend fun immichUrl(): String? {
        if (immichAsked) return immich
        val o = runCatching { JSONObject(Api.get("/api/immich/connection")) }.getOrNull() ?: return null
        immichAsked = true
        // Only the public address: the one the server talks to can be a home-network name a phone cannot open.
        immich = o.optString("publicUrl").takeIf { !o.isNull("publicUrl") && it.isNotBlank() }?.trimEnd('/')
        return immich
    }

    // ---- The place a photo was taken -------------------------------------------------------

    private val places = HashMap<String, String?>()

    private fun placeKey(lat: Double, lon: Double) = "%.2f,%.2f".format(java.util.Locale.ROOT, lat, lon)

    /**
     * "City, Country" for a spot, as the web's reversePlaceName: Photon's nearest settlement first, then
     * anything there. A real answer is kept (also "nothing here"); a failed lookup is not, so it is asked again.
     * Throws when the lookup failed.
     */
    suspend fun placeName(lat: Double, lon: Double): String? {
        val k = placeKey(lat, lon)
        synchronized(places) { if (places.containsKey(k)) return places[k] }
        // Each call gives up after five seconds; an exception (offline, timeout) is a failed lookup, not "nowhere".
        val name = withContext(Dispatchers.IO) {
            photon("lat=${coarse(lat)}&lon=${coarse(lon)}&limit=1&lang=en&osm_tag=place&radius=30") ?: photon("lat=${coarse(lat)}&lon=${coarse(lon)}&limit=1&lang=en") ?: ""
        }
        val value = name.ifBlank { null }
        synchronized(places) { places[k] = value }
        return value
    }

    /** One Photon reverse lookup: the name, "" for no result, null when that variant found nothing to go on. */
    private fun photon(query: String): String? {
        val c = URL("https://photon.komoot.io/reverse?$query").openConnection() as HttpURLConnection
        try {
            c.connectTimeout = 5_000; c.readTimeout = 5_000
            c.setRequestProperty("Accept", "application/json")
            if (c.responseCode !in 200..299) throw java.io.IOException("photon ${c.responseCode}")
            val features = JSONObject(c.inputStream.bufferedReader().readText()).optJSONArray("features")
            val p = features?.optJSONObject(0)?.optJSONObject("properties") ?: return null
            fun s(k: String) = p.optString(k).takeIf { it.isNotBlank() }
            val city = s("city") ?: s("district") ?: s("locality") ?: s("name") ?: s("county") ?: s("state")
            // The country in Dutch from its code ("Marokko", not "Morocco"); Photon itself has no Dutch.
            val country = s("countrycode")?.let { java.util.Locale("", it.uppercase()).getDisplayCountry(java.util.Locale.forLanguageTag("nl-NL")).takeIf { n -> n.isNotBlank() } } ?: s("country")
            return listOfNotNull(city, country).joinToString(", ")
        } finally { c.disconnect() }
    }

    // ---- The file itself ---------------------------------------------------------------------

    /** The original's name: the server's (from Immich), else the day and the start of the id, as the web names it. */
    private fun fileName(c: HttpURLConnection, media: Media): String {
        val d = c.getHeaderField("Content-Disposition").orEmpty()
        val star = Regex("filename\\*=UTF-8''([^;]+)", RegexOption.IGNORE_CASE).find(d)?.groupValues?.get(1)?.let { runCatching { URLDecoder.decode(it, "UTF-8") }.getOrNull() }
        val plain = Regex("filename=\"?([^\";]+)\"?", RegexOption.IGNORE_CASE).find(d)?.groupValues?.get(1)
        val type = mimeOf(c, media)
        val ext = when (type.substringAfter('/').lowercase()) {
            "jpeg", "jpg" -> "jpg"; "png" -> "png"; "webp" -> "webp"; "heic" -> "heic"; "heif" -> "heif"; "avif" -> "avif"
            "gif" -> "gif"; "tiff" -> "tiff"; "mp4" -> "mp4"; "quicktime" -> "mov"; "webm" -> "webm"
            else -> if (media.video) "mp4" else "jpg"
        }
        val name = (star ?: plain)?.trim()?.takeIf { it.isNotBlank() } ?: "${media.takenAt}-${media.id.take(8)}.$ext"
        return name.replace(Regex("[\\\\/:*?\"<>|]"), "_").take(120)
    }

    private fun mimeOf(c: HttpURLConnection, media: Media): String =
        c.contentType?.substringBefore(';')?.trim()?.takeIf { it.contains('/') } ?: if (media.video) "video/mp4" else "image/jpeg"

    /**
     * Saves the original, as it was taken, into Pictures/MarkMySteps through MediaStore (no storage permission
     * needed). Streamed straight to the file, so even a film never sits in memory. Null when it failed.
     */
    suspend fun download(context: Context, media: Media): Uri? = withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        var made: Uri? = null
        val done = Api.stream("/api/media/${media.id}/thumbnail?size=original") { c ->
            val type = mimeOf(c, media)
            val video = type.startsWith("video/")
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, fileName(c, media))
                put(MediaStore.MediaColumns.MIME_TYPE, type)
                put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/MarkMySteps")
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val collection = if (video) MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            else MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            val uri = resolver.insert(collection, values) ?: return@stream null
            made = uri
            resolver.openOutputStream(uri)?.use { out -> c.inputStream.use { it.copyTo(out, 64 * 1024) } } ?: return@stream null
            resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
            uri
        }
        if (done == null) made?.let { runCatching { resolver.delete(it, null, null) } }
        done
    }

    /** The original in the app's own cache, to hand to another app (open in, share). Null when it failed. */
    suspend fun shared(context: Context, media: Media): Pair<Uri, String>? = withContext(Dispatchers.IO) {
        // A photo linked from this phone is handed over as the gallery's own file.
        if (DeviceMedia.isDevice(media.id)) return@withContext Uri.parse(DeviceMedia.videoUri(media.id)) to (if (media.video) "video/*" else "image/*")
        val dir = File(context.cacheDir, "shared").apply { mkdirs() }
        // One file at a time is enough: the last one shared is the only one another app may still be reading.
        dir.listFiles()?.forEach { it.delete() }
        Api.stream("/api/media/${media.id}/thumbnail?size=original") { c ->
            val file = File(dir, fileName(c, media))
            file.outputStream().use { out -> c.inputStream.use { it.copyTo(out, 64 * 1024) } }
            FileProvider.getUriForFile(context, context.packageName + ".files", file) to mimeOf(c, media)
        }
    }

    /** Another app opens the photo (an editor, a gallery). */
    fun openIn(context: Context, uri: Uri, type: String) {
        val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, type).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(Intent.createChooser(view, "Openen in").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
    }

    /** The share sheet with the photo itself. */
    fun share(context: Context, uri: Uri, type: String) {
        val send = Intent(Intent.ACTION_SEND).setType(type).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        send.clipData = android.content.ClipData.newRawUri("", uri)
        context.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
    }

    /** A web address in the browser (Immich). */
    fun browse(context: Context, url: String) {
        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
    }
}
