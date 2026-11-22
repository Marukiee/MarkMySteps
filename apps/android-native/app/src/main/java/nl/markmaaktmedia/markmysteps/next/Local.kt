package nl.markmaaktmedia.markmysteps.next

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * "Doorgaan zonder server": the app on this phone alone, as the web's local mode. There is no account and no
 * server; the app's server line (Api) answers from [LocalBackend], a small copy of the server's trip and stop
 * routes kept in a file on the phone. Trips, their stops, the recorded route and the photos from the gallery
 * work; what needs other people (companions, share links, Immich, notifications) says it needs a server.
 */
object LocalMode {
    const val BASE = "local"
    private var prefs: android.content.SharedPreferences? = null
    var name by mutableStateOf(""); private set

    val on: Boolean get() = Api.base == BASE

    fun init(context: Context) {
        prefs = context.getSharedPreferences("mms.next.local", Context.MODE_PRIVATE)
        name = prefs?.getString("name", "") ?: ""
        LocalBackend.init(context)
    }

    fun changeName(v: String) { name = v; prefs?.edit()?.putString("name", v)?.apply() }

    /** Starts the app without a server: everything from now on stays on this phone. */
    fun start() {
        Api.startLocal()
        Onboarding.needed()
    }
}

/**
 * The server's routes the app needs, answered on the phone from one JSON file: me, the trips (create, rename,
 * colour, dates, delete), their stops (add, change, move, delete), recorded points and the figures worked out
 * from them. Shapes as the real server's, so the rest of the app reads them unchanged.
 */
object LocalBackend {
    private var file: java.io.File? = null
    private var app: Context? = null
    private var db = JSONObject()
    private const val ME = "local"

    fun init(context: Context) {
        app = context.applicationContext
        file = java.io.File(context.filesDir, "local.json")
        db = runCatching { JSONObject(file!!.readText()) }.getOrDefault(JSONObject())
        if (!db.has("trips")) db.put("trips", JSONArray())
        if (!db.has("stops")) db.put("stops", JSONObject())
        if (!db.has("points")) db.put("points", JSONObject())
    }

    private fun save() = runCatching { file?.writeText(db.toString()) }

    private fun fail(status: Int, text: String = Lang.text(R.string.local_unsupported)): Nothing = throw Api.Failure(text, status)

    private val trips: JSONArray get() = db.getJSONArray("trips")
    private fun trip(id: String): JSONObject = (0 until trips.length()).map { trips.getJSONObject(it) }.firstOrNull { it.getString("id") == id } ?: fail(404, Lang.text(R.string.local_unsupported))
    private fun stopsOf(id: String): JSONArray = db.getJSONObject("stops").optJSONArray(id) ?: JSONArray().also { db.getJSONObject("stops").put(id, it) }
    private fun pointsOf(id: String): JSONArray = db.getJSONObject("points").optJSONArray(id) ?: JSONArray().also { db.getJSONObject("points").put(id, it) }

    private fun me() = JSONObject().put("id", ME).put("displayName", LocalMode.name.ifBlank { Lang.text(R.string.local_user) }).put("username", "").put("hasAvatar", false)

    /** A trip as the server sends it, with its stops and route worked into the fields the list reads. */
    private fun dressed(t: JSONObject): JSONObject {
        val id = t.getString("id")
        val stops = ordered(id)
        val stopPoints = JSONArray()
        stops.filter { !it.isNull("latitude") && !it.isNull("longitude") && it.isNull("parentStopId") }.forEach { s ->
            stopPoints.put(JSONArray().put(s.getDouble("longitude")).put(s.getDouble("latitude")))
        }
        val pts = pointsOf(id)
        val route = JSONArray()
        for (i in 0 until pts.length()) pts.getJSONObject(i).let { route.put(JSONArray().put(it.getDouble("longitude")).put(it.getDouble("latitude"))) }
        val km = distance(route.takeIf { it.length() >= 2 } ?: stopPoints)
        return JSONObject(t.toString())
            .put("ownerId", ME)
            .put("members", JSONArray().put(JSONObject().put("userId", ME).put("role", "OWNER").put("canTrack", true).put("user", me())))
            .put("stopPoints", stopPoints)
            .put("routePath", if (route.length() >= 2) JSONArray().put(route) else JSONArray())
            .put("flightPath", JSONArray())
            .put("distanceKm", km)
    }

    private fun distance(line: JSONArray): Double {
        var km = 0.0
        for (i in 1 until line.length()) {
            val a = line.getJSONArray(i - 1); val b = line.getJSONArray(i)
            val dLat = Math.toRadians(b.getDouble(1) - a.getDouble(1)); val dLon = Math.toRadians(b.getDouble(0) - a.getDouble(0))
            val h = Math.sin(dLat / 2).let { it * it } + Math.cos(Math.toRadians(a.getDouble(1))) * Math.cos(Math.toRadians(b.getDouble(1))) * Math.sin(dLon / 2).let { it * it }
            km += 6371.0 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
        }
        return Math.round(km * 10) / 10.0
    }

    private fun ordered(id: String): List<JSONObject> {
        val a = stopsOf(id)
        return (0 until a.length()).map { a.getJSONObject(it) }.sortedBy { it.optInt("orderIndex") }
    }

    private fun renumber(id: String, list: List<JSONObject>) {
        val a = JSONArray()
        list.forEachIndexed { i, s -> a.put(s.put("orderIndex", i)) }
        db.getJSONObject("stops").put(id, a)
    }

    private fun stopList(id: String): String = JSONArray(ordered(id)).toString()

    /** One request of the app, answered here. Throws [Api.Failure] for what needs a server. */
    @Synchronized
    fun handle(method: String, fullPath: String, body: String?): String {
        val path = fullPath.substringBefore('?').removePrefix("/api")
        val b = body?.let { runCatching { JSONObject(it) }.getOrNull() } ?: JSONObject()
        val parts = path.trim('/').split('/')
        fun at(i: Int) = parts.getOrNull(i)
        return when {
            path == "/users/me" && method == "GET" -> me().toString()
            path == "/users/me" && method == "PATCH" -> { b.optString("displayName").takeIf { it.isNotBlank() }?.let { LocalMode.changeName(it) }; me().toString() }
            path == "/notifications/count" -> JSONObject().put("unread", 0).put("pending", 0).toString()
            path == "/notifications" || path == "/users/friends" -> "[]"
            path == "/auth/2fa" -> JSONObject().put("enabled", false).toString()
            at(0) == "users" && at(2) == "stats" -> stats().toString()
            path == "/trips" && method == "GET" -> JSONArray((0 until trips.length()).map { dressed(trips.getJSONObject(it)) }).toString()
            path == "/trips" && method == "POST" -> {
                val t = JSONObject().put("id", b.optString("id").ifBlank { java.util.UUID.randomUUID().toString() })
                    .put("title", b.optString("title")).put("startDate", b.optString("startDate").take(10)).put("endDate", b.optString("endDate").take(10))
                    .put("color", b.opt("color") ?: JSONObject.NULL).put("createdAt", java.time.Instant.now().toString())
                trips.put(t); save(); dressed(t).toString()
            }
            at(0) == "trips" && parts.size == 2 -> {
                val id = at(1)!!
                when (method) {
                    "GET" -> dressed(trip(id)).toString()
                    "PATCH" -> {
                        val t = trip(id)
                        listOf("title", "startDate", "endDate", "color", "autoTrack").forEach { k -> if (b.has(k)) t.put(k, b.get(k)) }
                        save(); dressed(t).toString()
                    }
                    "DELETE" -> {
                        val keep = JSONArray(); for (i in 0 until trips.length()) trips.getJSONObject(i).takeIf { it.getString("id") != id }?.let { keep.put(it) }
                        db.put("trips", keep); db.getJSONObject("stops").remove(id); db.getJSONObject("points").remove(id); save(); "{}"
                    }
                    else -> fail(405)
                }
            }
            at(0) == "trips" && at(2) == "stops" -> stops(at(1)!!, method, at(3), b)
            at(0) == "trips" && at(2) == "points" && method == "POST" -> {
                val id = at(1)!!; trip(id)
                val list = pointsOf(id); val add = b.optJSONArray("points") ?: JSONArray()
                for (i in 0 until add.length()) list.put(add.getJSONObject(i))
                save(); JSONObject().put("accepted", add.length()).toString()
            }
            at(0) == "trips" && at(2) == "stats" -> {
                val t = dressed(trip(at(1)!!))
                val start = LocalDate.parse(t.getString("startDate")); val end = LocalDate.parse(t.getString("endDate"))
                JSONObject().put("distanceKm", t.optDouble("distanceKm")).put("days", ChronoUnit.DAYS.between(start, end) + 1)
                    .put("photoCount", DeviceMedia.count(fakeTrip(at(1)!!))).put("countries", countries(at(1)!!)).toString()
            }
            at(0) == "trips" && at(2) == "media" && method == "GET" -> {
                // Without a server the photos come from the gallery: the trip's days are looked up each time it opens
                // (only with the gallery permission; DeviceMedia adds them to what this answers).
                val t = trip(at(1)!!)
                val context = app
                val start = runCatching { LocalDate.parse(t.getString("startDate")) }.getOrNull()
                val end = runCatching { LocalDate.parse(t.getString("endDate")) }.getOrNull()
                if (context != null && start != null && end != null && DeviceMedia.permissions().any { context.checkSelfPermission(it) == android.content.pm.PackageManager.PERMISSION_GRANTED && it != android.Manifest.permission.ACCESS_MEDIA_LOCATION }) {
                    val days = (ChronoUnit.DAYS.between(start, end) + 1).toInt()
                    runCatching { kotlinx.coroutines.runBlocking { DeviceMedia.link(context, fakeTrip(at(1)!!).copy(start = start, days = days)) } }
                }
                "[]"
            }
            at(0) == "trips" && at(2) in setOf("comments", "notes", "share", "days") && method == "GET" -> "[]"
            at(0) == "trips" && at(2) == "reactions" -> JSONObject().put("counts", JSONArray()).put("mine", JSONObject()).put("names", JSONObject()).toString()
            else -> fail(501)
        }
    }

    private fun fakeTrip(id: String) = Trip(id, "", "", "", "", 0, null, androidx.compose.ui.graphics.Color.Unspecified, emptyList(), remoteId = id)

    private fun countries(id: String): JSONArray = JSONArray(ordered(id).mapNotNull { it.optString("countryCode").takeIf { c -> c.length == 2 } }.distinct())

    private fun stats(): JSONObject {
        val all = (0 until trips.length()).map { trips.getJSONObject(it) }
        val today = LocalDate.now()
        val past = all.filter { runCatching { !LocalDate.parse(it.getString("startDate")).isAfter(today) }.getOrDefault(false) }
        val days = past.sumOf { t -> runCatching { ChronoUnit.DAYS.between(LocalDate.parse(t.getString("startDate")), minOf(today, LocalDate.parse(t.getString("endDate")))) + 1 }.getOrDefault(0L) }
        val countries = past.flatMap { t -> ordered(t.getString("id")).mapNotNull { it.optString("countryCode").takeIf { c -> c.length == 2 } } }.distinct()
        return JSONObject().put("trips", past.size).put("days", days).put("countries", JSONArray(countries))
            .put("places", past.sumOf { ordered(it.getString("id")).count { s -> s.optInt("nights") > 0 } })
            .put("flights", 0).put("distanceKm", past.sumOf { dressed(it).optDouble("distanceKm", 0.0) })
            .put("photoCount", past.sumOf { DeviceMedia.count(fakeTrip(it.getString("id"))) }).put("ongoing", all.size - past.size)
    }

    private val stopFields = listOf("name", "nights", "latitude", "longitude", "countryCode", "travelMode", "flightNumber", "fromAirport", "toAirport", "parentStopId", "dayTripDate", "arrivalDate", "departureDate", "notes")

    private fun stops(id: String, method: String, sub: String?, b: JSONObject): String {
        trip(id)
        val list = ordered(id).toMutableList()
        when {
            method == "GET" && sub == null -> return stopList(id)
            method == "POST" && sub == null -> {
                val s = JSONObject().put("id", b.optString("id").ifBlank { java.util.UUID.randomUUID().toString() }).put("parentStopId", JSONObject.NULL).put("travelMode", "GROUND")
                stopFields.forEach { k -> if (b.has(k)) s.put(k, b.get(k)) }
                if (!s.has("nights")) s.put("nights", 1)
                val after = b.optString("afterStopId").takeIf { it.isNotBlank() }?.let { a -> list.indexOfFirst { it.getString("id") == a } } ?: -1
                if (after >= 0) list.add(after + 1, s) else list.add(s)
                renumber(id, list)
            }
            method == "PUT" && sub == "order" -> {
                val order = b.optJSONArray("stopIds") ?: JSONArray()
                val ids = (0 until order.length()).map { order.getString(it) }
                renumber(id, list.sortedBy { s -> ids.indexOf(s.getString("id")).let { if (it < 0) Int.MAX_VALUE else it } })
            }
            method == "PATCH" && sub != null -> {
                val s = list.firstOrNull { it.getString("id") == sub } ?: fail(404)
                stopFields.forEach { k -> if (b.has(k)) s.put(k, b.get(k)) }
                renumber(id, list)
            }
            method == "DELETE" && sub != null -> renumber(id, list.filter { it.getString("id") != sub && it.optString("parentStopId") != sub })
            else -> fail(501)
        }
        save()
        return stopList(id)
    }
}
