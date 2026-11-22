package nl.markmaaktmedia.markmysteps.next

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.ui.graphics.Color
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * The test app's line to a real MarkMySteps server: sign in, then read the
 * trips, their stops and their photos. It only ever reads; nothing is
 * written back. The tokens stay in this app's own storage on the phone.
 */
object Api {
    private const val PREFS = "mms.next"
    var base: String = ""
        private set
    private var access: String? = null
    private var refresh: String? = null
    private lateinit var prefs: android.content.SharedPreferences

    fun init(context: Context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        base = prefs.getString("base", "") ?: ""
        access = prefs.getString("access", null)
        refresh = prefs.getString("refresh", null)
    }

    val signedIn: Boolean get() = access != null && base.isNotEmpty()

    /** Another server, from the settings: kept for the sign-in page, which the caller opens after signing out. */
    fun setServer(url: String) {
        base = url.trim().trimEnd('/')
        save()
    }

    fun remember(key: String, value: String) = prefs.edit().putString("cache.$key", value).apply()
    fun recall(key: String): String? = prefs.getString("cache.$key", null)

    fun signOut() {
        access = null; refresh = null
        prefs.edit().remove("access").remove("refresh").remove("cache.trips").remove("cache.me").apply()
        Photos.clear()
    }

    private fun save() {
        prefs.edit().putString("base", base).putString("access", access).putString("refresh", refresh).apply()
    }

    class Failure(message: String, val status: Int = 0) : Exception(message)

    /** What signing in answered: done, or a second step with an authenticator code. */
    sealed interface Login {
        data object Done : Login
        data class NeedsCode(val mfaToken: String) : Login
    }

    suspend fun login(server: String, identifier: String, password: String): Login = withContext(Dispatchers.IO) {
        base = server.trim().trimEnd('/').let { if (it.startsWith("http")) it else "https://$it" }
        val body = JSONObject().put("identifier", identifier.trim()).put("password", password)
        val answer = JSONObject(request("POST", "/api/auth/login", body.toString(), auth = false))
        if (answer.optBoolean("mfaRequired")) return@withContext Login.NeedsCode(answer.getString("mfaToken"))
        tokens(answer)
        Login.Done
    }

    suspend fun loginCode(mfaToken: String, code: String) = withContext(Dispatchers.IO) {
        val body = JSONObject().put("mfaToken", mfaToken).put("code", code.trim())
        tokens(JSONObject(request("POST", "/api/auth/login/mfa", body.toString(), auth = false)))
    }

    private fun tokens(o: JSONObject) {
        access = o.getString("accessToken")
        refresh = o.getString("refreshToken")
        save()
    }

    private fun renew(): Boolean {
        val r = refresh ?: return false
        return try {
            tokens(JSONObject(request("POST", "/api/auth/refresh", JSONObject().put("refreshToken", r).toString(), auth = false)))
            true
        } catch (_: Failure) { false }
    }

    private fun open(method: String, path: String, auth: Boolean): HttpURLConnection =
        (URL(base + path).openConnection() as HttpURLConnection).apply {
            setMethod(this, method)
            connectTimeout = 15_000
            readTimeout = 30_000
            setRequestProperty("Accept", "application/json")
            if (auth) access?.let { setRequestProperty("Authorization", "Bearer $it") }
        }

    /** HttpURLConnection refuses PATCH; set it on the underlying field, as OkHttp-less apps do. */
    private fun setMethod(c: HttpURLConnection, method: String) {
        try { c.requestMethod = method } catch (_: java.net.ProtocolException) {
            runCatching {
                val f = HttpURLConnection::class.java.getDeclaredField("method"); f.isAccessible = true; f.set(c, method)
            }.onFailure {
                // On Android the real connection is wrapped; reach it through "delegate" when present.
                val d = c.javaClass.getDeclaredField("delegate").apply { isAccessible = true }.get(c) as HttpURLConnection
                val f = HttpURLConnection::class.java.getDeclaredField("method"); f.isAccessible = true; f.set(d, method)
            }
        }
    }

    private fun request(method: String, path: String, body: String? = null, auth: Boolean = true, retried: Boolean = false): String {
        val c = open(method, path, auth)
        try {
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(body.toByteArray()) }
            }
            val code = c.responseCode
            if (code == 401 && auth && !retried && renew()) return request(method, path, body, auth, retried = true)
            if (code !in 200..299) {
                val text = c.errorStream?.bufferedReader()?.readText().orEmpty()
                val message = runCatching { JSONObject(text).optString("message") }.getOrNull()?.takeIf { it.isNotBlank() }
                throw Failure(message ?: "De server gaf $code", code)
            }
            return c.inputStream.bufferedReader().readText()
        } catch (e: java.io.IOException) {
            throw Failure("Kan de server niet bereiken")
        } finally {
            c.disconnect()
        }
    }

    suspend fun get(path: String): String = withContext(Dispatchers.IO) { request("GET", path) }

    /** A change the user made themselves (a reaction, a comment): sent as it is, nothing else. */
    /**
     * Test mode: started with `--ez dryRun true`, every write is answered here and never leaves the phone, so a
     * test can tap delete, reorder or rename on real data without changing anything. Lives until the app stops.
     */
    @Volatile var dryRun = false

    suspend fun send(method: String, path: String, body: JSONObject? = null): String = withContext(Dispatchers.IO) {
        if (dryRun && method != "GET") {
            // Only the names of the fields: a body can hold a password, a code or a key, and logcat is no place for them.
            android.util.Log.i("MmsDryRun", "$method ${path.substringBefore('?')} ${body?.keys()?.asSequence()?.toList()?.joinToString(",", "{", "}") ?: ""}")
            return@withContext "{}"
        }
        request(method, path, body?.toString())
    }

    /**
     * A file sent as the multipart field [field], as the web's FormData does (a profile photo, a Polarsteps zip,
     * a GPX track). In test mode nothing is opened at all: only the path and the size are logged.
     */
    suspend fun upload(path: String, field: String, filename: String, mime: String, data: ByteArray): String = withContext(Dispatchers.IO) {
        if (dryRun) {
            android.util.Log.i("MmsDryRun", "POST ${path.substringBefore('?')} [file ${data.size} bytes]")
            return@withContext "{}"
        }
        multipart(path, field, filename, mime, data)
    }

    private fun multipart(path: String, field: String, filename: String, mime: String, data: ByteArray, retried: Boolean = false): String {
        val boundary = "mms" + java.util.UUID.randomUUID().toString().replace("-", "")
        val c = open("POST", path, auth = true)
        try {
            c.doOutput = true
            c.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
            val safeName = filename.replace(Regex("[\\r\\n\"]"), "_")
            c.outputStream.use { out ->
                out.write("--$boundary\r\nContent-Disposition: form-data; name=\"$field\"; filename=\"$safeName\"\r\nContent-Type: $mime\r\n\r\n".toByteArray())
                out.write(data)
                out.write("\r\n--$boundary--\r\n".toByteArray())
            }
            val code = c.responseCode
            if (code == 401 && !retried && renew()) return multipart(path, field, filename, mime, data, retried = true)
            if (code !in 200..299) {
                val text = c.errorStream?.bufferedReader()?.readText().orEmpty()
                val message = runCatching { JSONObject(text).optString("message") }.getOrNull()?.takeIf { it.isNotBlank() }
                throw Failure(message ?: "De server gaf $code", code)
            }
            return c.inputStream.bufferedReader().readText()
        } catch (e: java.io.IOException) {
            throw Failure("Kan de server niet bereiken")
        } finally {
            c.disconnect()
        }
    }

    /** An image from the server, with the token, as bytes. */
    /**
     * A file read as a stream (a download): [block] gets the open connection once the server said yes,
     * so an original of fifty megabytes goes straight to disk and never sits in memory. Blocking.
     */
    fun <T> stream(path: String, retried: Boolean = false, block: (HttpURLConnection) -> T): T? {
        val c = open("GET", path, auth = true)
        return try {
            c.readTimeout = 60_000
            val code = c.responseCode
            if (code == 401 && !retried && renew()) return stream(path, true, block)
            if (code !in 200..299) null else block(c)
        } catch (_: java.io.IOException) { null } finally { c.disconnect() }
    }

    fun bytes(path: String, retried: Boolean = false): ByteArray? {
        val c = open("GET", path, auth = true)
        return try {
            val code = c.responseCode
            if (code == 401 && !retried && renew()) return bytes(path, true)
            if (code !in 200..299) null else c.inputStream.use { it.readBytes() }
        } catch (_: java.io.IOException) { null } finally { c.disconnect() }
    }
}

/** Photos from the server, small ones kept in memory while the app runs. */
object Photos {
    /** A timeline asks for a hundred photos at once; six at a time is what the server likes. */
    private val lanes = kotlinx.coroutines.sync.Semaphore(6)
    /** The photo you just tapped skips that queue: after a fling it would otherwise wait behind hundreds of tiles. */
    private val urgent = kotlinx.coroutines.sync.Semaphore(3)
    // Small grid photos and big ones in separate caches, so a few previews never push the grid out
    // (that made a tapped photo open without its thumbnail to grow from).
    private val maxMem = Runtime.getRuntime().maxMemory()
    private val small = object : LruCache<String, Bitmap>((maxMem / 8).toInt()) {
        override fun sizeOf(key: String, value: Bitmap) = value.allocationByteCount
    }
    private val large = object : LruCache<String, Bitmap>((maxMem / 6).toInt()) {
        override fun sizeOf(key: String, value: Bitmap) = value.allocationByteCount
    }
    private val cache = object {
        fun get(key: String): Bitmap? = (if (key.endsWith("/thumbnail") || key.startsWith("avatar/")) small else large).get(key)
        fun put(key: String, b: Bitmap) { (if (key.endsWith("/thumbnail") || key.startsWith("avatar/")) small else large).put(key, b) }
        fun evictAll() { small.evictAll(); large.evictAll() }
    }

    /** Width over height of photos the server sent no size for, learnt from the picture itself and kept on the phone. */
    val ratios = androidx.compose.runtime.mutableStateMapOf<String, Float>()
    private var ratioPrefs: android.content.SharedPreferences? = null
    fun initRatios(context: android.content.Context) {
        ratioPrefs = context.getSharedPreferences("mms.next.ratios", android.content.Context.MODE_PRIVATE)
        ratioPrefs?.all?.forEach { (k, v) -> (v as? Float)?.let { ratios[k] = it } }
    }
    private fun learn(key: String, b: Bitmap) {
        val id = key.substringBefore('/')
        if (key.startsWith("avatar/") || ratios.containsKey(id) || b.height == 0) return
        val r = b.width.toFloat() / b.height
        // Gathered and handed over a few at a time: each new size reflows the whole timeline, and one reflow
        // per thumbnail (hundreds on a trip whose photos came without sizes) kept the main thread busy.
        synchronized(learnt) {
            learnt[id] = r
            if (!flushing) {
                flushing = true
                android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                    val batch = synchronized(learnt) { flushing = false; HashMap(learnt).also { learnt.clear() } }
                    ratios.putAll(batch)
                }, 400)
            }
        }
        ratioPrefs?.edit()?.putFloat(id, r)?.apply()
    }
    private val learnt = HashMap<String, Float>()
    private var flushing = false

    fun clear() = cache.evictAll()

    /** What the photos in memory take now, in bytes. */
    fun usedBytes(): Long = small.size().toLong() + large.size().toLong()

    /** Drops one picture (a profile photo just replaced), so the next look fetches it anew. */
    fun forget(key: String) { small.remove(key); large.remove(key); if (key.startsWith("avatar/")) avatarStamp++ }

    /** Bumped when a profile photo changed, so every face on screen reads it again. */
    var avatarStamp by androidx.compose.runtime.mutableIntStateOf(0)

    /** A ratio for layout: the server's, or the one learnt from the picture when the server had none. */
    fun ratioOf(m: Media): Float = if (m.sized) m.ratio else ratios[m.id] ?: m.ratio

    fun cached(key: String): Bitmap? = cache.get(key)

    /**
     * Fetches photos ahead into the cache, a few at a time in the background, so they are already there when
     * they scroll into view instead of showing an empty tile first.
     */
    suspend fun prefetch(ids: List<String>, size: String = "thumbnail") = kotlinx.coroutines.coroutineScope {
        ids.distinct().filter { cached("$it/$size") == null }.forEach { id -> launch(kotlinx.coroutines.Dispatchers.IO) { runCatching { load(id, size) } } }
    }

    /**
     * `size` is the server's rendition: "thumbnail" for grids, "preview" for a
     * screen, "original" for the file as taken, which is the one that still
     * carries an HDR gain map.
     */
    suspend fun load(id: String, size: String, now: Boolean = false): Bitmap? = loadPath("$id/$size", "/api/media/$id/thumbnail?size=$size", now)

    /** Someone's profile photo. */
    suspend fun avatar(userId: String): Bitmap? = loadPath("avatar/$userId", "/api/users/$userId/avatar")

    suspend fun loadPath(key: String, path: String, now: Boolean = false): Bitmap? {
        cache.get(key)?.let { return it }
        return (if (now) urgent else lanes).withPermitCompat {
            cache.get(key)?.let { return@withPermitCompat it }
            val data = Api.bytes(path) ?: return@withPermitCompat null
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(data, 0, data.size, bounds)
            // An original can be 50 megapixels: bring it down to about a screen and a half.
            var sample = 1
            while (bounds.outWidth / (sample * 2) >= 2400 || bounds.outHeight / (sample * 2) >= 2400) sample *= 2
            val bitmap = BitmapFactory.decodeByteArray(data, 0, data.size, BitmapFactory.Options().apply { inSampleSize = sample })
            bitmap?.also { cache.put(key, it); learn(key, it) }
        }
    }

    private suspend fun <T> kotlinx.coroutines.sync.Semaphore.withPermitCompat(block: suspend () -> T): T {
        acquire()
        try { return withContext(Dispatchers.IO) { block() } } finally { release() }
    }
}

/** A photo of a trip, with when it was taken. */
data class Media(
    val id: String, val takenAt: LocalDate, val video: Boolean, val ratio: Float, val sized: Boolean = true,
    /** Whose photo it is, and where it sits in their Immich (for "Openen in Immich"). */
    val userId: String = "", val immichAssetId: String? = null,
    /** Where it was taken, when the photo knows: the viewer turns it into a place name. */
    val lat: Double? = null, val lon: Double? = null,
)

/** Reads the signed-in account's trips into the same shapes the demo uses. */
object Remote {
    /** [mustChange]: still on a temporary password an admin set; the app asks for an own one. */
    data class Me(val id: String, val name: String, val username: String, val hasAvatar: Boolean = false, val mustChange: Boolean = false)

    /** Your travelling in numbers, as the web's Reizigers page shows it. */
    data class Stats(
        val trips: Int, val days: Int, val countries: List<String>, val places: Int,
        val flights: Int, val km: Int, val photos: Int, val ongoing: Int,
    )

    data class Friend(val id: String, val name: String, val username: String, val hasAvatar: Boolean, val sharedTrips: Int)

    suspend fun stats(userId: String): Stats {
        val o = JSONObject(Api.get("/api/users/$userId/stats"))
        val c = o.optJSONArray("countries")
        return Stats(
            trips = o.optInt("trips"), days = o.optInt("days"),
            countries = (0 until (c?.length() ?: 0)).map { c!!.getString(it) },
            places = o.optInt("places"), flights = o.optInt("flights"),
            km = o.optDouble("distanceKm", 0.0).toInt(), photos = if (UiPrefs.ownPhotosOnly) o.optInt("ownPhotoCount", o.optInt("photoCount")) else o.optInt("photoCount"), ongoing = o.optInt("ongoing"),
        )
    }

    data class Comment(val id: String, val mediaId: String?, val day: String?, val author: String, val body: String, val at: java.time.Instant, val canDelete: Boolean)

    /** Reactions per target (a media id, or "c:" + comment id): counts, your own pick, and who. */
    data class Reactions(val counts: Map<String, List<Pair<String, Int>>>, val mine: Map<String, String>, val names: Map<String, List<Pair<String, String>>>)

    private fun parseComment(o: JSONObject) = Comment(
        o.getString("id"), o.optString("mediaId").takeIf { it.isNotBlank() && it != "null" }, o.optString("day").takeIf { it.isNotBlank() && it != "null" },
        o.optString("authorName"), o.optString("body"), runCatching { java.time.Instant.parse(o.getString("createdAt")) }.getOrDefault(java.time.Instant.now()),
        o.optBoolean("canDelete"),
    )

    suspend fun comments(trip: Trip): List<Comment> {
        val a = JSONArray(Api.get("/api/trips/${trip.remoteId}/comments"))
        return (0 until a.length()).map { parseComment(a.getJSONObject(it)) }
    }

    suspend fun reactions(trip: Trip): Reactions {
        val o = JSONObject(Api.get("/api/trips/${trip.remoteId}/reactions"))
        val counts = mutableMapOf<String, MutableList<Pair<String, Int>>>()
        o.optJSONArray("counts")?.let { a -> for (i in 0 until a.length()) a.getJSONObject(i).let { c -> counts.getOrPut(c.getString("target")) { mutableListOf() } += c.getString("kind") to c.getInt("count") } }
        val mine = mutableMapOf<String, String>()
        o.optJSONObject("mine")?.let { m -> m.keys().forEach { k -> mine[k] = m.getString(k) } }
        val names = mutableMapOf<String, List<Pair<String, String>>>()
        o.optJSONObject("names")?.let { m -> m.keys().forEach { k -> val a = m.getJSONArray(k); names[k] = (0 until a.length()).map { a.getJSONObject(it).let { n -> n.getString("kind") to n.getString("name") } } } }
        return Reactions(counts.mapValues { (_, v) -> v.sortedByDescending { it.second } }, mine, names)
    }

    suspend fun addComment(trip: Trip, mediaId: String, body: String): Comment =
        parseComment(JSONObject(Api.send("POST", "/api/trips/${trip.remoteId}/media/$mediaId/comments", JSONObject().put("body", body))))

    suspend fun deleteComment(trip: Trip, id: String) { Api.send("DELETE", "/api/trips/${trip.remoteId}/comments/$id") }

    suspend fun setReaction(trip: Trip, mediaId: String, kind: String?) {
        Api.send("PUT", "/api/trips/${trip.remoteId}/media/$mediaId/reaction", JSONObject().put("kind", kind ?: JSONObject.NULL))
    }

    data class ShareLink(val id: String, val url: String, val hasPassword: Boolean, val canManage: Boolean)

    /** The server may answer with a path; a link to copy or send needs the whole address. */
    private fun fullUrl(u: String) = if (u.startsWith("/")) Api.base + u else u

    suspend fun shareLinks(trip: Trip): List<ShareLink> {
        val a = JSONArray(Api.get("/api/trips/${trip.remoteId}/share"))
        return (0 until a.length()).map { a.getJSONObject(it) }.map { ShareLink(it.getString("id"), fullUrl(it.optString("url")), it.optBoolean("hasPassword"), it.optBoolean("canManage", true)) }
    }

    suspend fun createShareLink(trip: Trip, password: String?): ShareLink {
        val o = JSONObject(Api.send("POST", "/api/trips/${trip.remoteId}/share", JSONObject().apply { if (!password.isNullOrBlank()) put("password", password) }))
        return ShareLink(o.getString("id"), fullUrl(o.optString("url")), o.optBoolean("hasPassword"), o.optBoolean("canManage", true))
    }

    suspend fun setSharePassword(trip: Trip, id: String, password: String?) {
        Api.send("PATCH", "/api/trips/${trip.remoteId}/share/$id", JSONObject().put("password", password ?: JSONObject.NULL))
    }

    suspend fun revokeShareLink(trip: Trip, id: String) { Api.send("DELETE", "/api/trips/${trip.remoteId}/share/$id") }

    /** People to add, by name or @username. */
    suspend fun findPeople(query: String): List<Friend> {
        val a = JSONArray(Api.get("/api/users/suggestions?limit=25&q=" + java.net.URLEncoder.encode(query.trim(), "UTF-8")))
        return (0 until a.length()).map { a.getJSONObject(it) }.map { Friend(it.optString("id"), it.optString("displayName"), it.optString("username"), it.optBoolean("hasAvatar"), 0) }
    }

    suspend fun addMembers(trip: Trip, usernames: List<String>, guest: Boolean) {
        Api.send("POST", "/api/trips/${trip.remoteId}/members", JSONObject().put("usernames", JSONArray(usernames)))
        if (guest) {
            // Added as companions by the server; guests get their role straight after.
            val now = trips().firstOrNull { it.remoteId == trip.remoteId }?.members.orEmpty()
            now.filter { it.username in usernames }.forEach { updateMember(trip, it.userId, role = "GUEST") }
        }
    }

    suspend fun updateMember(trip: Trip, userId: String, role: String? = null, canTrack: Boolean? = null) {
        Api.send("PATCH", "/api/trips/${trip.remoteId}/members/$userId", JSONObject().apply {
            role?.let { put("role", it) }; canTrack?.let { put("canTrack", it) }
        })
    }

    suspend fun removeMember(trip: Trip, userId: String) { Api.send("DELETE", "/api/trips/${trip.remoteId}/members/$userId") }

    private fun modeName(m: Mode) = when (m) { Mode.Car -> "GROUND"; Mode.Train -> "TRAIN"; Mode.Bus -> "BUS"; Mode.Boat -> "BOAT"; Mode.Flight -> "FLIGHT" }

    suspend fun updateStop(trip: Trip, stopId: String, nights: Int? = null, mode: Mode? = null) {
        Api.send("PATCH", "/api/trips/${trip.remoteId}/stops/$stopId", JSONObject().apply {
            nights?.let { put("nights", it) }; mode?.let { put("travelMode", modeName(it)) }
        })
    }

    suspend fun deleteStop(trip: Trip, stopId: String) { Api.send("DELETE", "/api/trips/${trip.remoteId}/stops/$stopId") }

    suspend fun reorderStops(trip: Trip, ids: List<String>) {
        Api.send("PUT", "/api/trips/${trip.remoteId}/stops/order", JSONObject().put("stopIds", JSONArray(ids)))
    }

    /** The way there and back are stops on the server too; the planner shows them as legs, but every reorder must name them. */
    val legStopIds = HashMap<String, Pair<String?, String?>>()

    suspend fun addStop(trip: Trip, id: String, place: Place, nights: Int, afterStopId: String? = null) {
        Api.send("POST", "/api/trips/${trip.remoteId}/stops", JSONObject().apply {
            put("id", id); put("name", place.name); put("nights", nights)
            // Before the way back, never after it.
            afterStopId?.let { put("afterStopId", it) }
            put("latitude", place.at.second); put("longitude", place.at.first)
            place.countryCode?.let { put("countryCode", it) }
        })
    }

    data class Place(val name: String, val region: String, val countryCode: String?, val at: LonLat)

    /** Towns by name, from Photon like the web app (only what was typed leaves the phone). */
    suspend fun searchPlaces(query: String): List<Place> = withContext(Dispatchers.IO) {
        if (query.trim().length < 2) return@withContext emptyList()
        val url = URL("https://photon.komoot.io/api/?limit=8&lang=en&osm_tag=place&q=" + java.net.URLEncoder.encode(query.trim(), "UTF-8"))
        runCatching {
            val c = (url.openConnection() as HttpURLConnection).apply { connectTimeout = 8000; readTimeout = 8000 }
            val o = JSONObject(c.inputStream.bufferedReader().readText())
            val f = o.getJSONArray("features")
            (0 until f.length()).map { f.getJSONObject(it) }.mapNotNull { x ->
                val p = x.getJSONObject("properties"); val g = x.getJSONObject("geometry").getJSONArray("coordinates")
                val name = p.optString("name").takeIf { it.isNotBlank() } ?: return@mapNotNull null
                val cc = p.optString("countrycode").takeIf { it.isNotBlank() }?.uppercase()
                // Photon only speaks English, German and French: the country is named in Dutch from its code, the region stays as given.
                val country = cc?.let { java.util.Locale("", it).getDisplayCountry(java.util.Locale.forLanguageTag("nl-NL")) }?.takeIf { it.isNotBlank() && it != cc } ?: p.optString("country")
                Place(name, listOf(p.optString("state"), country).filter { it.isNotBlank() }.joinToString(", "), cc, g.getDouble(0) to g.getDouble(1))
            }.distinctBy { it.name + it.region }.take(6)
        }.getOrDefault(emptyList())
    }

    /** A playable address for a video: the server hands out a short-lived token in the URL. */
    suspend fun videoUrl(mediaId: String): String = Api.base + JSONObject(Api.get("/api/media/$mediaId/video-url")).getString("url")

    suspend fun renameTrip(trip: Trip, title: String) {
        Api.send("PATCH", "/api/trips/${trip.remoteId}", JSONObject().put("title", title.trim()))
    }

    suspend fun deleteTrip(trip: Trip) { Api.send("DELETE", "/api/trips/${trip.remoteId}") }

    /** Leaving a trip someone else made: you take yourself off its members. */
    suspend fun leaveTrip(trip: Trip) {
        val me = cachedMe()?.id ?: return
        Api.send("DELETE", "/api/trips/${trip.remoteId}/members/$me")
    }

    suspend fun setTripColor(trip: Trip, hex: String?) {
        Api.send("PATCH", "/api/trips/${trip.remoteId}", JSONObject().put("color", hex ?: JSONObject.NULL))
    }

    /** Ask the server to fetch the trip's photos from Immich again now. */
    suspend fun syncPhotos(trip: Trip) { Api.send("POST", "/api/trips/${trip.remoteId}/sync") }

    data class Notice(
        val id: String, val kind: String, val at: java.time.Instant, val read: Boolean,
        val actorId: String?, val actor: String?, val actorAvatar: Boolean, val tripId: String?, val trip: String?,
        val requestId: String?, val requestStatus: String?, val detail: String?, val message: String? = null,
    )

    suspend fun noticeCount(): Int {
        val o = JSONObject(Api.get("/api/notifications/count"))
        return o.optInt("unread") + o.optInt("pending")
    }

    suspend fun notices(): List<Notice> {
        val a = JSONArray(Api.get("/api/notifications"))
        return (0 until a.length()).map { a.getJSONObject(it) }.map { o ->
            val actor = o.optJSONObject("actor"); val trip = o.optJSONObject("trip"); val req = o.optJSONObject("request")
            Notice(
                o.getString("id"), o.optString("kind"), runCatching { java.time.Instant.parse(o.getString("createdAt")) }.getOrDefault(java.time.Instant.now()), o.optBoolean("read"),
                actor?.optString("id"), actor?.optString("displayName"), actor?.optBoolean("hasAvatar") == true, trip?.optString("id"), trip?.optString("title"),
                req?.optString("id"), req?.optString("status"), o.optString("detail").takeIf { it.isNotBlank() && it != "null" },
                req?.optString("message")?.takeIf { it.isNotBlank() && it != "null" },
            )
        }
    }

    suspend fun markNoticesRead() { Api.send("POST", "/api/notifications/read") }

    /** Takes one line off the list; an unanswered request itself stays open, as on the web. */
    suspend fun dismissNotice(id: String) { Api.send("DELETE", "/api/notifications/$id") }

    /** Let someone look along as a guest, or turn them down; making them a companion lives in people and sharing. */
    suspend fun answerAccess(requestId: String, approve: Boolean) {
        Api.send("POST", "/api/access-requests/$requestId/${if (approve) "approve" else "deny"}", if (approve) JSONObject().put("role", "GUEST") else null)
    }

    data class Note(val day: String, val title: String?, val body: String, val author: String)

    suspend fun notes(trip: Trip): List<Note> {
        val a = JSONArray(Api.get("/api/trips/${trip.remoteId}/notes"))
        return (0 until a.length()).map { a.getJSONObject(it) }.map {
            Note(it.optString("day"), it.optString("title").takeIf { t -> t.isNotBlank() && t != "null" }, it.optString("body"), it.optString("authorName"))
        }
    }

    /** A day's weather where you were, as the web reads it: open-meteo, the archive for days older than 90. */
    data class Weather(val maxC: Int, val code: Int)

    private val weatherCache = HashMap<String, Weather?>()

    suspend fun weather(at: LonLat, day: LocalDate): Weather? = withContext(Dispatchers.IO) {
        val key = "%.2f,%.2f,%s".format(java.util.Locale.ROOT, at.second, at.first, day)
        if (weatherCache.containsKey(key)) return@withContext weatherCache[key]
        Api.recall("w.$key")?.split(',')?.let { p -> return@withContext Weather(p[0].toInt(), p[1].toInt()).also { weatherCache[key] = it } }
        if (day.isAfter(LocalDate.now().plusDays(14))) return@withContext null
        val old = java.time.temporal.ChronoUnit.DAYS.between(day, LocalDate.now()) > 90
        val host = if (old) "archive-api.open-meteo.com/v1/archive" else "api.open-meteo.com/v1/forecast"
        val url = URL("https://$host?latitude=${at.second}&longitude=${at.first}&daily=weather_code,temperature_2m_max,precipitation_sum,precipitation_hours&start_date=$day&end_date=$day&timezone=auto")
        val w = runCatching {
            val c = (url.openConnection() as HttpURLConnection).apply { connectTimeout = 8000; readTimeout = 8000 }
            val d = JSONObject(c.inputStream.bufferedReader().readText()).getJSONObject("daily")
            val t = d.getJSONArray("temperature_2m_max").optDouble(0); var code = d.getJSONArray("weather_code").optInt(0, -1)
            val mm = d.optJSONArray("precipitation_sum")?.optDouble(0, 0.0) ?: 0.0
            val hours = d.optJSONArray("precipitation_hours")?.optDouble(0, 0.0) ?: 0.0
            // Under half a millimetre nothing meaningful fell: the day was just clouded over (web dayCondition).
            if (code in 51..86 && code !in 71..77 && code !in 85..86 && (mm < 0.5 || hours < 1)) code = 3
            if (t.isNaN() || code < 0) null else Weather(kotlin.math.round(t).toInt(), code)
        }.getOrNull()
        weatherCache[key] = w
        if (w != null && !day.isAfter(LocalDate.now().minusDays(2))) Api.remember("w.$key", "${w.maxC},${w.code}")
        w
    }

    /** Whether the account has an authenticator app, and how many recovery codes are left. */
    suspend fun twoFactor(): Pair<Boolean, Int> = JSONObject(Api.get("/api/auth/2fa")).let { it.optBoolean("enabled") to it.optInt("recoveryCodesLeft") }

    /** The Immich connection: where, and when photos were last fetched (null when not connected). */
    suspend fun immich(): Pair<String, String?>? = runCatching {
        val o = JSONObject(Api.get("/api/immich/connection"))
        o.optString("serverUrl").takeIf { it.isNotBlank() }?.let { it to o.optString("lastSyncAt").takeIf { s -> s.isNotBlank() && s != "null" } }
    }.getOrNull()

    suspend fun friends(): List<Friend> {
        val a = JSONArray(Api.get("/api/users/friends"))
        return (0 until a.length()).map { a.getJSONObject(it) }.map {
            Friend(it.getString("id"), it.optString("displayName"), it.optString("username"), it.optBoolean("hasAvatar"), it.optInt("sharedTrips"))
        }
    }

    suspend fun me(): Me {
        val raw = Api.get("/api/users/me")
        Api.remember("me", raw)
        return parseMe(raw)
    }

    fun cachedMe(): Me? = Api.recall("me")?.let { runCatching { parseMe(it) }.getOrNull() }

    private fun parseMe(raw: String): Me = JSONObject(raw).let { o -> Me(o.getString("id"), o.optString("displayName"), o.optString("username"), o.optBoolean("hasAvatar"), o.optBoolean("mustChangePassword")) }

    private val Palette = listOf(0xFFE8613C, 0xFF2BB6A8, 0xFFD08A2A, 0xFF7A5BD6, 0xFFE34B8A, 0xFF5B8DEF, 0xFFC9772E, 0xFF7DA7D9)

    private fun points(a: JSONArray?): List<LonLat> =
        if (a == null) emptyList() else (0 until a.length()).map { i -> a.getJSONArray(i).let { it.getDouble(0) to it.getDouble(1) } }

    fun flag(code: String?): String {
        if (code == null || code.length != 2) return "📍"
        val up = code.uppercase()
        return String(Character.toChars(0x1F1E6 + (up[0] - 'A'))) + String(Character.toChars(0x1F1E6 + (up[1] - 'A')))
    }

    private val MonthsShort = listOf("jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec")
    private val MonthsLong = listOf("januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december")

    private fun range(a: LocalDate, b: LocalDate, withYear: Boolean): String {
        val end = "${b.dayOfMonth} ${MonthsShort[b.monthValue - 1]}" + if (withYear) " ${b.year}" else ""
        return if (a.month == b.month) "${a.dayOfMonth} t/m $end" else "${a.dayOfMonth} ${MonthsShort[a.monthValue - 1]} t/m $end"
    }

    suspend fun trips(): List<Trip> {
        val raw = Api.get("/api/trips")
        Api.remember("trips", raw)
        return parseTrips(raw)
    }

    /** The trips as last read, so the app opens on them straight away. */
    fun cachedTrips(): List<Trip>? = Api.recall("trips")?.let { runCatching { parseTrips(it) }.getOrNull() }

    private fun parseTrips(raw: String): List<Trip> {
        val me = cachedMe()?.id
        val list = JSONArray(raw)
        val today = LocalDate.now()
        return (0 until list.length()).map { i ->
            val o = list.getJSONObject(i)
            val start = LocalDate.parse(o.getString("startDate").take(10))
            val end = LocalDate.parse(o.getString("endDate").take(10))
            val segments = o.optJSONArray("routePath")?.let { r -> (0 until r.length()).map { points(r.getJSONArray(it)) }.filter { it.size >= 2 } }.orEmpty()
            val routes = segments.flatten()
            val flightLegs = o.optJSONArray("flightPath")?.let { r -> (0 until r.length()).map { points(r.getJSONArray(it)) }.filter { it.size >= 2 } }.orEmpty()
            val flights = flightLegs.map { it.first() to it.last() }
            val stopPoints = points(o.optJSONArray("stopPoints"))
            val color = o.optString("color").takeIf { it.startsWith("#") }?.let { Color(android.graphics.Color.parseColor(it)) }
                ?: Color(Palette[i % Palette.size])
            val members = o.optJSONArray("members")
            val memberList = (0 until (members?.length() ?: 0)).map { k ->
                val m = members!!.getJSONObject(k); val u = m.getJSONObject("user")
                Member(
                    m.getString("userId"), u.optString("displayName"), u.optString("username"), u.optBoolean("hasAvatar"),
                    m.optString("role"), m.optBoolean("canTrack"),
                    m.optString("fromDate").takeIf { it.isNotBlank() && it != "null" }, m.optString("toDate").takeIf { it.isNotBlank() && it != "null" },
                )
            }
            // Faces are the people who travelled; guests only look along and are not counted.
            val people = memberList.filter { it.role != "GUEST" }.mapIndexed { k, m ->
                Person(m.name.take(1).uppercase(), personColor(m.userId), m.userId, m.hasAvatar, m.name)
            }
            val ongoing = !start.isAfter(today) && !end.isBefore(today)
            Trip(
                id = o.getString("id"),
                title = o.getString("title"),
                month = MonthsLong[start.monthValue - 1],
                year = start.year.toString(),
                dates = range(start, end, withYear = true),
                days = (ChronoUnit.DAYS.between(start, end) + 1).toInt(),
                km = o.optDouble("distanceKm").takeIf { !it.isNaN() }?.toInt(),
                color = color,
                route = routes.ifEmpty { stopPoints },
                stopPoints = stopPoints,
                flights = flights,
                upcoming = !end.isBefore(today),
                startsInDays = ChronoUnit.DAYS.between(today, start).toInt().takeIf { it > 0 },
                people = people,
                extraPeople = 0,
                ongoingDay = if (ongoing) (ChronoUnit.DAYS.between(start, today) + 1).toInt() else null,
                remoteId = o.getString("id"),
                coverId = o.optString("resolvedCoverId").takeIf { it.isNotBlank() && it != "null" },
                start = start,
                // As on the web: shared with you means you are a guest on it; a trip you travelled is yours.
                shared = me != null && memberList.any { it.userId == me && it.role == "GUEST" },
                segments = segments,
                flightLegs = flightLegs,
                ownerId = o.optString("ownerId"),
                members = memberList,
                marker = if (o.isNull("markerLng") || o.isNull("markerLat") || !o.has("markerLng")) null
                    else (o.optDouble("markerLng") to o.optDouble("markerLat")).takeIf { !it.first.isNaN() && !it.second.isNaN() },
            )
        }.sortedByDescending { it.start }
    }

    /** The planned stops of a trip, each with its day trips, with their dates worked out from the trip's start. */
    suspend fun stops(trip: Trip): Pair<List<Stop>, Pair<Leg?, Leg?>> {
        val list = JSONArray(Api.get("/api/trips/${trip.remoteId}/stops"))
        val start = trip.start ?: LocalDate.now()
        var day = start
        val stops = mutableListOf<Stop>()
        var outbound: Leg? = null
        var back: Leg? = null
        var outboundId: String? = null
        var backId: String? = null
        val all = (0 until list.length()).map { list.getJSONObject(it) }
        val rows = all.filter { it.isNull("parentStopId") }.sortedBy { it.optInt("orderIndex") }
        // Day trips hang under their stop in the planner; the route, the map and the nights leave them out.
        fun text(o: JSONObject, key: String) = o.optString(key).takeIf { it.isNotBlank() && it != "null" }
        fun vias(o: JSONObject) = o.optJSONArray("viaAirports")?.let { v -> (0 until v.length()).map { v.optString(it) }.filter { it.isNotBlank() } }.orEmpty()
        val dayTrips = all.filter { !it.isNull("parentStopId") }.sortedBy { it.optInt("orderIndex") }.groupBy { it.optString("parentStopId") }.mapValues { (_, list) ->
            list.map { o ->
                val la = o.optDouble("latitude"); val lo = o.optDouble("longitude")
                DayTrip(
                    o.optString("id"), o.optString("name"), flag(text(o, "countryCode")),
                    if (la.isNaN() || lo.isNaN()) null else lo to la,
                    (text(o, "dayTripDate") ?: text(o, "arrivalDate"))?.let { runCatching { LocalDate.parse(it.take(10)) }.getOrNull() },
                )
            }
        }
        rows.forEachIndexed { index, o ->
            val mode = when (o.optString("travelMode")) {
                "FLIGHT" -> Mode.Flight; "TRAIN" -> Mode.Train; "BUS" -> Mode.Bus; "BOAT" -> Mode.Boat; else -> Mode.Car
            }
            val nights = o.optInt("nights")
            val name = o.optString("name")
            val lat = o.optDouble("latitude"); val lon = o.optDouble("longitude")
            // The way there and back are stops of their own with no nights, at the ends.
            if (nights == 0 && (index == 0 || index == rows.lastIndex) && (name.startsWith("Heen") || name.startsWith("Terug"))) {
                val leg = Leg(
                    mode, o.optString("fromAirport").ifBlank { "Thuis" }, o.optString("toAirport").ifBlank { "" }, 0,
                    id = o.optString("id"), flightNumber = text(o, "flightNumber"), fromAirport = text(o, "fromAirport"), toAirport = text(o, "toAirport"),
                    viaAirports = vias(o), placeName = text(o, "notes"), place = if (lat.isNaN() || lon.isNaN()) null else lon to lat,
                )
                if (index == 0) { outbound = leg; outboundId = o.optString("id") } else { back = leg; backId = o.optString("id") }
                return@forEachIndexed
            }
            val from = day
            day = day.plusDays(nights.toLong())
            stops += Stop(
                name = name,
                flag = flag(o.optString("countryCode").takeIf { it.isNotBlank() && it != "null" }),
                at = if (lat.isNaN() || lon.isNaN()) (trip.route.firstOrNull() ?: (0.0 to 0.0)) else lon to lat,
                nights = nights,
                dates = if (nights == 0) "${from.dayOfMonth} ${MonthsShort[from.monthValue - 1]}" else range(from, day, withYear = false),
                mode = mode,
                start = from,
                id = o.optString("id"),
                flightNumber = text(o, "flightNumber"),
                fromAirport = text(o, "fromAirport"),
                toAirport = text(o, "toAirport"),
                dayTrips = dayTrips[o.optString("id")].orEmpty(),
                viaAirports = vias(o),
                hideLeg = o.optBoolean("hideLeg"),
            )
        }
        trip.remoteId?.let { legStopIds[it] = outboundId to backId }
        return stops to (outbound to back)
    }

    suspend fun media(trip: Trip): List<Media> {
        val list = JSONArray(Api.get("/api/trips/${trip.remoteId}/media"))
        return (0 until list.length()).map { list.getJSONObject(it) }.map { o ->
            val w = o.optInt("width", 0); val h = o.optInt("height", 0)
            Media(
                id = o.getString("id"),
                takenAt = LocalDate.parse(o.getString("takenAt").take(10)),
                video = o.optString("assetType") == "VIDEO",
                ratio = if (w > 0 && h > 0) w.toFloat() / h else 1f,
                sized = w > 0 && h > 0,
                userId = o.optString("userId"),
                immichAssetId = o.optString("immichAssetId").takeIf { it.isNotBlank() && it != "null" },
                lat = o.optDouble("latitude").takeIf { !o.isNull("latitude") && !it.isNaN() },
                lon = o.optDouble("longitude").takeIf { !o.isNull("longitude") && !it.isNaN() },
            )
        }.distinctBy { it.id }.sortedBy { it.takenAt }
    }
}
