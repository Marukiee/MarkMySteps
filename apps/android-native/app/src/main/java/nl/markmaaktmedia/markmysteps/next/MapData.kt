package nl.markmaaktmedia.markmysteps.next

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.LocalDate

/*
 * What the trip map reads from the server besides the trip itself, as the web's trip page does: every
 * traveller's own line (all of it or one day), the days that have something on them, where the
 * companions are right now, and the raw points of a day for the points editor. Every change goes
 * through Api.send, so the test mode (dryRun) holds all of them back.
 */
object MapRemote {
    /** One traveller's recorded line, as the server simplified it. */
    data class RouteLine(val userId: String, val name: String, val points: List<LonLat>)

    /** A day of the trip with a track or photos on it. */
    data class TripDay(val day: LocalDate, val points: Int, val photos: Int)

    /** A companion's latest position (the server keeps two days of them). */
    data class LiveFix(val userId: String, val name: String, val hasAvatar: Boolean, val at: LonLat, val time: Instant, val accuracy: Double?)

    /** One stored point of your own route, as the points editor shows it. */
    data class TrackPoint(val id: String, val at: LonLat, val time: Instant, val accuracy: Double?, val source: String)

    /** A railway station from the search, for drawing a train ride. */
    data class Station(val name: String, val region: String, val at: LonLat, val main: Boolean)

    private fun JSONObject.dbl(k: String): Double? = if (isNull(k) || !has(k)) null else optDouble(k).takeIf { !it.isNaN() }

    suspend fun routes(tripId: String, day: LocalDate?): List<RouteLine> {
        val o = JSONObject(Api.get("/api/trips/$tripId/route" + (day?.let { "?day=$it" } ?: "")))
        val f = o.optJSONArray("features") ?: return emptyList()
        return (0 until f.length()).mapNotNull { i ->
            val feat = f.getJSONObject(i)
            val props = feat.optJSONObject("properties") ?: return@mapNotNull null
            val coords = feat.optJSONObject("geometry")?.optJSONArray("coordinates") ?: return@mapNotNull null
            val pts = (0 until coords.length()).mapNotNull { k -> coords.optJSONArray(k)?.let { it.getDouble(0) to it.getDouble(1) } }
            RouteLine(props.optString("userId"), props.optString("displayName"), pts)
        }
    }

    suspend fun days(tripId: String): List<TripDay> {
        val a = JSONArray(Api.get("/api/trips/$tripId/days"))
        return (0 until a.length()).mapNotNull { i ->
            val o = a.getJSONObject(i)
            runCatching { TripDay(LocalDate.parse(o.getString("day").take(10)), o.optInt("points"), o.optInt("photos")) }.getOrNull()
        }.sortedBy { it.day }
    }

    suspend fun live(tripId: String): List<LiveFix> {
        val a = JSONArray(Api.get("/api/trips/$tripId/live"))
        return (0 until a.length()).mapNotNull { i ->
            val o = a.getJSONObject(i)
            val lat = o.dbl("latitude") ?: return@mapNotNull null
            val lng = o.dbl("longitude") ?: return@mapNotNull null
            LiveFix(
                o.optString("userId"), o.optString("displayName"), o.optBoolean("hasAvatar"), lng to lat,
                runCatching { Instant.parse(o.getString("recordedAt")) }.getOrDefault(Instant.now()), o.dbl("accuracy"),
            )
        }
    }

    private fun parsePoint(o: JSONObject) = TrackPoint(
        o.optString("id"), o.getDouble("longitude") to o.getDouble("latitude"),
        runCatching { Instant.parse(o.getString("recordedAt")) }.getOrDefault(Instant.now()), o.dbl("accuracy"), o.optString("source", "TRACKED"),
    )

    suspend fun dayPoints(tripId: String, day: LocalDate): List<TrackPoint> {
        val a = JSONArray(Api.get("/api/trips/$tripId/points/day?day=$day"))
        return (0 until a.length()).map { parsePoint(a.getJSONObject(it)) }.sortedBy { it.time }
    }

    suspend fun pointDays(tripId: String): List<Pair<LocalDate, Int>> {
        val a = JSONArray(Api.get("/api/trips/$tripId/points/days"))
        return (0 until a.length()).mapNotNull { i ->
            val o = a.getJSONObject(i)
            runCatching { LocalDate.parse(o.getString("day").take(10)) to o.optInt("count") }.getOrNull()
        }
    }

    suspend fun movePoint(tripId: String, id: String, at: LonLat) {
        Api.send("PATCH", "/api/trips/$tripId/points/$id", JSONObject().put("latitude", at.second).put("longitude", at.first))
    }

    suspend fun addPoint(tripId: String, at: LonLat, time: Instant) {
        Api.send("POST", "/api/trips/$tripId/points", JSONObject().put("latitude", at.second).put("longitude", at.first).put("recordedAt", time.toString()))
    }

    suspend fun deletePoint(tripId: String, id: String) { Api.send("DELETE", "/api/trips/$tripId/points/$id") }

    /** Fills the nearest straight gap in your line with the road between its ends. */
    suspend fun drawRoad(tripId: String, at: LonLat) {
        Api.send("POST", "/api/trips/$tripId/route-fill", JSONObject().put("lat", at.second).put("lng", at.first))
    }

    /** Draws the rails between two stations into the gap that was pressed. */
    suspend fun drawTrain(tripId: String, at: LonLat, from: Station, to: Station) {
        Api.send(
            "POST", "/api/trips/$tripId/route-fill/train",
            JSONObject().put("lat", at.second).put("lng", at.first)
                .put("from", JSONObject().put("lat", from.at.second).put("lng", from.at.first))
                .put("to", JSONObject().put("lat", to.at.second).put("lng", to.at.first)),
        )
    }

    /** Whether a drawn stretch lies near this spot, so the line menu can offer to wipe it. */
    suspend fun drawnNear(tripId: String, at: LonLat): Boolean =
        runCatching { JSONObject(Api.get("/api/trips/$tripId/route-fill/near?lng=${at.first}&lat=${at.second}")).optBoolean("near") }.getOrDefault(false)

    suspend fun wipeDrawn(tripId: String, at: LonLat) { Api.send("DELETE", "/api/trips/$tripId/route-fill?lng=${at.first}&lat=${at.second}") }

    /** Hides the straight line to a stop (the stop stays), or brings it back. */
    suspend fun hideLeg(tripId: String, stopId: String, hide: Boolean) {
        Api.send("PATCH", "/api/trips/$tripId/stops/$stopId", JSONObject().put("hideLeg", hide))
    }

    private fun photon(url: String): JSONArray? = runCatching {
        val c = (URL(url).openConnection() as HttpURLConnection).apply { connectTimeout = 8000; readTimeout = 8000; setRequestProperty("Accept", "application/json") }
        try { JSONObject(c.inputStream.bufferedReader().readText()).optJSONArray("features") } finally { c.disconnect() }
    }.getOrNull()

    private fun dutchCountry(cc: String?, fallback: String): String =
        cc?.let { java.util.Locale("", it).getDisplayCountry(Lang.locale) }?.takeIf { it.isNotBlank() && it != cc } ?: fallback

    private val MainStation = listOf("centraal", "central", "centrale", "hauptbahnhof", "hbf", "hovedbanegård", "hlavní nádraží", "termini", "kolodvor", "główny", "principal")

    /** Stations only, never towns: a town's point is its centre, and rails drawn from there start off the platform. */
    suspend fun stations(query: String): List<Station> = withContext(Dispatchers.IO) {
        if (query.trim().length < 2) return@withContext emptyList()
        val f = photon("https://photon.komoot.io/api/?limit=8&lang=en&osm_tag=railway:station&osm_tag=railway:halt&q=" + java.net.URLEncoder.encode(query.trim(), "UTF-8")) ?: return@withContext emptyList()
        (0 until f.length()).map { f.getJSONObject(it) }.mapNotNull { x ->
            val p = x.getJSONObject("properties"); val g = x.getJSONObject("geometry").getJSONArray("coordinates")
            val name = p.optString("name").takeIf { it.isNotBlank() } ?: return@mapNotNull null
            val cc = p.optString("countrycode").takeIf { it.isNotBlank() }?.uppercase()
            val region = listOf(p.optString("city").ifBlank { p.optString("county") }, dutchCountry(cc, p.optString("country"))).filter { it.isNotBlank() }.joinToString(", ")
            Station(name, region, g.getDouble(0) to g.getDouble(1), MainStation.any { name.lowercase().contains(it) })
        }.distinctBy { it.name + it.region }.sortedByDescending { it.main }
    }

    /** The place at a spot picked on the map, for a new stop: the nearest town with its country. */
    suspend fun placeAt(at: LonLat): Remote.Place = withContext(Dispatchers.IO) {
        val f = photon("https://photon.komoot.io/reverse?lat=${coarse(at.second)}&lon=${coarse(at.first)}&limit=1&lang=en&osm_tag=place&radius=30")
            ?.takeIf { it.length() > 0 } ?: photon("https://photon.komoot.io/reverse?lat=${coarse(at.second)}&lon=${coarse(at.first)}&limit=1&lang=en")
        val p = f?.optJSONObject(0)?.optJSONObject("properties")
        fun s(k: String) = p?.optString(k)?.takeIf { it.isNotBlank() }
        val cc = s("countrycode")?.uppercase()
        val name = s("city") ?: s("name") ?: s("town") ?: s("village") ?: s("county") ?: s("state") ?: "%.4f, %.4f".format(java.util.Locale.ROOT, at.second, at.first)
        Remote.Place(name, listOfNotNull(s("state"), cc?.let { dutchCountry(it, s("country").orEmpty()) }?.takeIf { it.isNotBlank() }).joinToString(", "), cc, at)
    }
}

/**
 * Whose photos sit on the map of a trip, as the web keeps it per trip in the browser: a set of user ids,
 * an empty set meaning "none" (only the line), no entry meaning everyone. Kept on this phone.
 */
object MapPhotosPref {
    private var prefs: android.content.SharedPreferences? = null
    private val cache = androidx.compose.runtime.mutableStateMapOf<String, Set<String>>()
    fun init(context: android.content.Context) { prefs = context.getSharedPreferences("mms.next.ui", android.content.Context.MODE_PRIVATE) }
    fun get(tripId: String): Set<String>? = cache[tripId] ?: prefs?.getString("mapPhotos.$tripId", null)?.let { raw ->
        runCatching { JSONArray(raw).let { a -> (0 until a.length()).map { a.getString(it) }.toSet() } }.getOrNull()?.also { cache[tripId] = it }
    }
    /** [users] null is everyone again, also whoever joins the trip later. */
    fun set(tripId: String, users: Set<String>?) {
        if (users == null) { cache.remove(tripId); prefs?.edit()?.remove("mapPhotos.$tripId")?.apply(); return }
        cache[tripId] = users
        prefs?.edit()?.putString("mapPhotos.$tripId", JSONArray(users.toList()).toString())?.apply()
    }
}

/** The camera of a trip map, for the page around it: fly to a spot, frame some points, or the whole trip again. */
interface MapCamera {
    fun flyTo(at: LonLat, zoom: Double = 9.0)
    fun focusOn(points: List<LonLat>)
    fun reset()
}

/**
 * Everything the trip page and its two maps (in the page and full screen) share, so the server is asked
 * once: the travellers' lines, the day on show, whose lines and photos are on, where the companions are and
 * where you are.
 */
class TripMapState(val tripId: String?) {
    /** The lines from the server; null until they came (the map shows the trip list's route until then). */
    var routes by mutableStateOf<List<MapRemote.RouteLine>?>(null)
    var days by mutableStateOf<List<MapRemote.TripDay>>(emptyList())
    /** One day of the trip, or the whole of it (null). */
    var day by mutableStateOf<LocalDate?>(null)
    /** Whose routes are drawn; null until the trip's members are known. */
    var routeUsers by mutableStateOf<Set<String>?>(null)
    /** Whose photos are on the map; null means everyone. */
    var photoUsers by mutableStateOf<Set<String>?>(null)
    var live by mutableStateOf<List<MapRemote.LiveFix>>(emptyList())
    /** Your own position, for the blue dot; null when not known (or not wanted on this trip). */
    var self by mutableStateOf<LonLat?>(null)
    /** Stops whose line was hidden or shown just now, before the trip is read again. */
    val hiddenLegs = androidx.compose.runtime.mutableStateMapOf<String, Boolean>()

    /** Whose lines are on before anyone chose: given the lines, as the page decides it. */
    var defaultUsers: ((List<MapRemote.RouteLine>) -> Set<String>)? = null

    suspend fun reloadRoutes() {
        val id = tripId ?: return
        runCatching { MapRemote.routes(id, day) }.onSuccess { r ->
            // The default set first, so no line comes up only to go again.
            if (routeUsers == null) defaultUsers?.let { routeUsers = it(r) }
            routes = r
        }
    }
}

/**
 * Test switches for the trip map, only ever set in test mode (dryRun), from the start intent: "mapOngoing"
 * treats the opened trip as under way (your own dot, the locate button, the tracking question), "mapPoints"
 * opens its points editor straight away, and "mapLive" puts a companion on the map, so a screenshot can show
 * what only a trip under way would. They never write anything; test mode holds every write back anyway.
 */
object MapDebug {
    var ongoing = false
    var openPoints = false
    var fakeLive = false
}
