package nl.markmaaktmedia.markmysteps.next

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.ui.graphics.Color
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
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
    suspend fun send(method: String, path: String, body: JSONObject? = null): String = withContext(Dispatchers.IO) { request(method, path, body?.toString()) }

    /** An image from the server, with the token, as bytes. */
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
    private val cache = object : LruCache<String, Bitmap>(64 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.allocationByteCount
    }

    fun clear() = cache.evictAll()

    fun cached(key: String): Bitmap? = cache.get(key)

    /**
     * `size` is the server's rendition: "thumbnail" for grids, "preview" for a
     * screen, "original" for the file as taken, which is the one that still
     * carries an HDR gain map.
     */
    suspend fun load(id: String, size: String): Bitmap? = loadPath("$id/$size", "/api/media/$id/thumbnail?size=$size")

    /** Someone's profile photo. */
    suspend fun avatar(userId: String): Bitmap? = loadPath("avatar/$userId", "/api/users/$userId/avatar")

    suspend fun loadPath(key: String, path: String): Bitmap? {
        cache.get(key)?.let { return it }
        return lanes.withPermitCompat {
            cache.get(key)?.let { return@withPermitCompat it }
            val data = Api.bytes(path) ?: return@withPermitCompat null
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(data, 0, data.size, bounds)
            // An original can be 50 megapixels: bring it down to about a screen and a half.
            var sample = 1
            while (bounds.outWidth / (sample * 2) >= 2400 || bounds.outHeight / (sample * 2) >= 2400) sample *= 2
            val bitmap = BitmapFactory.decodeByteArray(data, 0, data.size, BitmapFactory.Options().apply { inSampleSize = sample })
            bitmap?.also { cache.put(key, it) }
        }
    }

    private suspend fun <T> kotlinx.coroutines.sync.Semaphore.withPermitCompat(block: suspend () -> T): T {
        acquire()
        try { return withContext(Dispatchers.IO) { block() } } finally { release() }
    }
}

/** A photo of a trip, with when it was taken. */
data class Media(val id: String, val takenAt: LocalDate, val video: Boolean, val ratio: Float)

/** Reads the signed-in account's trips into the same shapes the demo uses. */
object Remote {
    data class Me(val id: String, val name: String, val username: String, val hasAvatar: Boolean = false)

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
            km = o.optDouble("distanceKm", 0.0).toInt(), photos = o.optInt("photoCount"), ongoing = o.optInt("ongoing"),
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

    suspend fun shareLinks(trip: Trip): List<ShareLink> {
        val a = JSONArray(Api.get("/api/trips/${trip.remoteId}/share"))
        return (0 until a.length()).map { a.getJSONObject(it) }.map { ShareLink(it.getString("id"), it.optString("url"), it.optBoolean("hasPassword"), it.optBoolean("canManage", true)) }
    }

    suspend fun createShareLink(trip: Trip, password: String?): ShareLink {
        val o = JSONObject(Api.send("POST", "/api/trips/${trip.remoteId}/share", JSONObject().apply { if (!password.isNullOrBlank()) put("password", password) }))
        return ShareLink(o.getString("id"), o.optString("url"), o.optBoolean("hasPassword"), o.optBoolean("canManage", true))
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

    private fun parseMe(raw: String): Me = JSONObject(raw).let { o -> Me(o.getString("id"), o.optString("displayName"), o.optString("username"), o.optBoolean("hasAvatar")) }

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
                Person(m.name.take(1).uppercase(), Color(Palette[(k + 3) % Palette.size]), m.userId, m.hasAvatar, m.name)
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
            )
        }.sortedByDescending { it.start }
    }

    /** The planned stops of a trip, day trips left out, with their dates worked out from the trip's start. */
    suspend fun stops(trip: Trip): Pair<List<Stop>, Pair<Leg?, Leg?>> {
        val list = JSONArray(Api.get("/api/trips/${trip.remoteId}/stops"))
        val start = trip.start ?: LocalDate.now()
        var day = start
        val stops = mutableListOf<Stop>()
        var outbound: Leg? = null
        var back: Leg? = null
        val rows = (0 until list.length()).map { list.getJSONObject(it) }
            .filter { it.isNull("parentStopId") }
            .sortedBy { it.optInt("orderIndex") }
        rows.forEachIndexed { index, o ->
            val mode = when (o.optString("travelMode")) {
                "FLIGHT" -> Mode.Flight; "TRAIN" -> Mode.Train; "BUS" -> Mode.Bus; "BOAT" -> Mode.Boat; else -> Mode.Car
            }
            val nights = o.optInt("nights")
            val name = o.optString("name")
            val lat = o.optDouble("latitude"); val lon = o.optDouble("longitude")
            // The way there and back are stops of their own with no nights, at the ends.
            if (nights == 0 && (index == 0 || index == rows.lastIndex) && (name.startsWith("Heen") || name.startsWith("Terug"))) {
                val leg = Leg(mode, o.optString("fromAirport").ifBlank { "Thuis" }, o.optString("toAirport").ifBlank { "" }, 0)
                if (index == 0) outbound = leg else back = leg
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
            )
        }
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
            )
        }.sortedBy { it.takenAt }
    }
}
