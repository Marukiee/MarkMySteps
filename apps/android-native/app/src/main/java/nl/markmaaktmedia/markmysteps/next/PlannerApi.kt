package nl.markmaaktmedia.markmysteps.next

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.text.Normalizer
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * What the route planner writes to the server, beyond the nights, order and
 * stops that `Remote` already knows: the mode of a leg, a flight's number and
 * airports, day trips, and the way there and back. Every write goes through
 * `Api.send`, so a dry run answers it on the phone; nothing reads the answer,
 * the planner already shows the change.
 */
object PlannerRemote {
    fun modeName(m: Mode) = when (m) { Mode.Car -> "GROUND"; Mode.Train -> "TRAIN"; Mode.Bus -> "BUS"; Mode.Boat -> "BOAT"; Mode.Flight -> "FLIGHT" }

    /** Away from a flight the server clears the airports and the flight number by itself. */
    suspend fun setMode(trip: Trip, stopId: String, mode: Mode) {
        Api.send("PATCH", "/api/trips/${trip.remoteId}/stops/$stopId", JSONObject().put("travelMode", modeName(mode)))
    }

    /**
     * A flight as filled in. Only what is valid goes along (the server takes 3 or 4 letters for an airport and
     * up to 16 characters for a number), so a half typed code never turns the whole save down.
     */
    suspend fun saveFlight(trip: Trip, stopId: String, number: String?, from: String?, to: String?) {
        Api.send("PATCH", "/api/trips/${trip.remoteId}/stops/$stopId", JSONObject().apply {
            put("travelMode", "FLIGHT")
            // An empty string clears a number that was there; nothing at all leaves it as it is.
            if (number == "") put("flightNumber", "") else cleanNumber(number)?.let { put("flightNumber", it) }
            cleanCode(from)?.let { put("fromAirport", it) }
            cleanCode(to)?.let { put("toAirport", it) }
        })
    }

    fun cleanCode(code: String?): String? = code?.trim()?.uppercase()?.takeIf { it.matches(Regex("[A-Z]{3,4}")) }
    fun cleanNumber(number: String?): String? = number?.trim()?.uppercase()?.replace(" ", "")?.take(16)?.takeIf { it.isNotEmpty() }

    /** An excursion from [parentId] and back the same day: no nights, and never a leg of the route. */
    suspend fun addDayTrip(trip: Trip, id: String, parentId: String, place: Remote.Place, day: java.time.LocalDate) {
        Api.send("POST", "/api/trips/${trip.remoteId}/stops", JSONObject().apply {
            put("id", id); put("name", place.name.take(120)); put("nights", 0)
            put("parentStopId", parentId); put("dayTripDate", day.toString())
            put("latitude", place.at.second); put("longitude", place.at.first)
            place.countryCode?.let { put("countryCode", it) }
        })
    }

    /**
     * The way there or back, a stop of its own with no nights, named as the web names it. The way there is
     * added at the end like any stop and then moved to the front with [order], every stop named.
     */
    suspend fun addLeg(trip: Trip, id: String, outbound: Boolean, mode: Mode, order: List<String>?) {
        Api.send("POST", "/api/trips/${trip.remoteId}/stops", JSONObject().apply {
            put("id", id); put("name", if (outbound) "Heenreis" else "Terugreis"); put("nights", 0); put("travelMode", modeName(mode))
        })
        if (order != null) Remote.reorderStops(trip, order)
    }
}

/**
 * Every airport with scheduled flights and an IATA code, the same list the web
 * searches (OurAirports, made by apps/web/scripts/build-airports.mjs), read
 * from the app's assets the first time a flight needs it.
 */
object Airports {
    data class Airport(val iata: String, val name: String, val city: String, val country: String, val lat: Double, val lon: Double, val size: Char)

    @Volatile private var list: List<Airport>? = null
    private var byCode: Map<String, Airport> = emptyMap()
    @Volatile private var folded: List<Triple<String, String, String>>? = null
    val ready: Boolean get() = list != null

    private val marks = Regex("\\p{M}+")
    private fun fold(s: String) = marks.replace(Normalizer.normalize(s, Normalizer.Form.NFD), "").lowercase()

    suspend fun load(context: Context) {
        if (list != null) return
        withContext(Dispatchers.IO) {
            val rows = context.assets.open("airports.txt").bufferedReader().readLines().mapNotNull { line ->
                val p = line.split('|')
                if (p.size < 7) null else Airport(p[0], p[1], p[2], p[3], p[4].toDoubleOrNull() ?: return@mapNotNull null, p[5].toDoubleOrNull() ?: return@mapNotNull null, p[6].firstOrNull() ?: 'S') to (p.getOrNull(7) ?: "")
            }
            byCode = rows.associate { it.first.iata to it.first }
            list = rows.map { it.first }
            // Folded for search here, off the main thread: four thousand names took long enough to freeze the screen.
            folded = rows.map { (a, words) -> Triple(fold(a.city), fold(a.name), fold("${a.iata} ${a.city} ${a.name} $words")) }
        }
    }

    fun byCode(code: String?): Airport? = code?.let { byCode[it.trim().uppercase()] }

    /** The airport for a city within about 250 km, a hub counting as closer than it is (web nearestAirport). */
    fun nearest(at: LonLat?): Airport? {
        val all = list ?: return null
        val (lng, lat) = at ?: return null
        var best: Airport? = null
        var bestScore = Double.MAX_VALUE
        for (a in all) {
            val km = hypot((a.lon - lng) * cos(Math.toRadians(lat)), a.lat - lat) * 111
            if (km > 250) continue
            val score = km * when (a.size) { 'L' -> 1; 'M' -> 3; else -> 6 }
            if (score < bestScore) { bestScore = score; best = a }
        }
        return best
    }

    /** As the web scores a search: the code, then the city, then the name, then anything else it is known by. */
    /** Off the main thread: it scores every airport. */
    suspend fun search(query: String, limit: Int = 6): List<Airport> = withContext(Dispatchers.Default) { searchNow(query, limit) }

    private fun searchNow(query: String, limit: Int): List<Airport> {
        val all = list ?: return emptyList()
        val folded = folded ?: return emptyList()
        val q = fold(query.trim())
        if (q.isEmpty()) return emptyList()
        return all.indices.mapNotNull { i ->
            val a = all[i]; val (city, name, any) = folded[i]
            val score = when {
                a.iata.lowercase() == q -> 100
                city == q -> 80
                city.startsWith(q) -> 60
                name.startsWith(q) -> 50
                any.contains(" $q") -> 40
                any.contains(q) -> 20
                else -> 0
            } + when (a.size) { 'L' -> 3; 'M' -> 1; else -> 0 }
            if (score <= 3) null else a to score
        }.sortedByDescending { it.second }.take(limit).map { it.first }
    }

    /** Great circle distance between two airports, in km. */
    fun km(a: Airport, b: Airport): Int {
        val r = 6371.0
        val dLat = Math.toRadians(b.lat - a.lat); val dLon = Math.toRadians(b.lon - a.lon)
        val h = sin(dLat / 2).let { it * it } + cos(Math.toRadians(a.lat)) * cos(Math.toRadians(b.lat)) * sin(dLon / 2).let { it * it }
        return (2 * r * asin(sqrt(h))).roundToInt()
    }
}

/** A rough travel time for a distance, as the web's estimateDuration: an average speed plus time at the terminal. */
fun estimateDuration(km: Int, mode: Mode): String {
    val (kmh, overhead) = when (mode) { Mode.Car -> 75 to 0; Mode.Train -> 110 to 15; Mode.Bus -> 65 to 15; Mode.Boat -> 35 to 30; Mode.Flight -> 750 to 90 }
    val total = (km.toDouble() / kmh * 60).roundToInt() + overhead
    return if (total >= 60) "${total / 60}u ${total % 60}m" else "${total}m"
}
