package nl.markmaaktmedia.markmysteps.next

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.LocalDate

/**
 * The social side of a trip, as the web reads and writes it: day stories, the comments under them and their
 * likes, a share link's password, the days a companion was along, asking to look along, the trips you were
 * added to, what is behind the figures on Reizigers, and the stays the planner found in your route.
 *
 * Every write goes through `Api.send`, so a dry run answers it on the phone with "{}". Nothing here may
 * depend on that answer: the screens change first from what they already know, and only use a reply that
 * really came back.
 */
object SocialRemote {
    private fun JSONObject.str(k: String): String? = optString(k).takeIf { !isNull(k) && it.isNotBlank() && it != "null" }

    // ---- Day stories -------------------------------------------------------------------------

    /** One person's story of one day. Only its author may change or remove it. */
    data class DayNote(val id: String, val day: String, val title: String?, val body: String, val authorId: String?, val author: String)

    private fun parseNotes(raw: String): List<DayNote> {
        val a = JSONArray(raw)
        return (0 until a.length()).map { a.getJSONObject(it) }.map {
            DayNote(it.optString("id"), it.optString("day").take(10), it.str("title"), it.optString("body"), it.str("authorId"), it.optString("authorName"))
        }
    }

    suspend fun notes(trip: Trip): List<DayNote> = parseNotes(Api.get("/api/trips/${trip.remoteId}/notes"))

    /** The server keeps one story per author per day, so saving is the same for a new one and a changed one. Null when the answer was no list. */
    suspend fun saveNote(trip: Trip, day: String, body: String): List<DayNote>? =
        runCatching { parseNotes(Api.send("PUT", "/api/trips/${trip.remoteId}/notes", JSONObject().put("day", day).put("body", body.trim().take(8000)))) }
            .getOrElse { if (it is Api.Failure) throw it else null }

    suspend fun deleteNote(trip: Trip, id: String) { Api.send("DELETE", "/api/trips/${trip.remoteId}/notes/$id") }

    // ---- Comments on a day, and likes on comments --------------------------------------------

    data class Comment(
        val id: String, val mediaId: String?, val day: String?, val author: String, val body: String,
        val at: Instant, val canDelete: Boolean, val traveller: Boolean,
    )

    private fun parseComment(o: JSONObject) = Comment(
        o.getString("id"), o.str("mediaId"), o.str("day")?.take(10), o.optString("authorName"), o.optString("body"),
        runCatching { Instant.parse(o.getString("createdAt")) }.getOrDefault(Instant.now()), o.optBoolean("canDelete"), o.optBoolean("traveller", true),
    )

    suspend fun comments(trip: Trip): List<Comment> {
        val a = JSONArray(Api.get("/api/trips/${trip.remoteId}/comments"))
        return (0 until a.length()).map { parseComment(a.getJSONObject(it)) }
    }

    /** Null when the answer was no comment (a dry run): the thread then keeps the one it shows already. */
    suspend fun addDayComment(trip: Trip, day: String, body: String): Comment? =
        runCatching { parseComment(JSONObject(Api.send("POST", "/api/trips/${trip.remoteId}/days/$day/comments", JSONObject().put("body", body.trim().take(2000))))) }
            .getOrElse { if (it is Api.Failure) throw it else null }

    suspend fun deleteComment(trip: Trip, id: String) { Api.send("DELETE", "/api/trips/${trip.remoteId}/comments/$id") }

    /** A comment is liked or it is not: a heart, or nothing. */
    suspend fun likeComment(trip: Trip, commentId: String, on: Boolean) {
        Api.send("PUT", "/api/trips/${trip.remoteId}/comments/$commentId/reaction", JSONObject().put("kind", if (on) "heart" else JSONObject.NULL))
    }

    // ---- Share link password -----------------------------------------------------------------

    /** The password of a link, read back; null with recoverable false when it predates passwords that can be read back. */
    suspend fun sharePassword(trip: Trip, linkId: String): Pair<String?, Boolean> {
        val o = JSONObject(Api.get("/api/trips/${trip.remoteId}/share/$linkId/password"))
        return o.str("password") to o.optBoolean("recoverable")
    }

    // ---- Days along --------------------------------------------------------------------------

    /** The days someone was along; null on a side is the trip's own first or last day. */
    suspend fun setMemberDays(trip: Trip, userId: String, from: String?, to: String?) {
        Api.send("PATCH", "/api/trips/${trip.remoteId}/members/$userId", JSONObject().put("fromDate", from ?: JSONObject.NULL).put("toDate", to ?: JSONObject.NULL))
    }

    // ---- Asking to look along ----------------------------------------------------------------

    data class AccessPreview(
        val tripId: String, val title: String, val start: LocalDate?, val end: LocalDate?,
        val ownerId: String, val owner: String, val ownerHasAvatar: Boolean, val status: String,
    )

    /** What you may know of a trip you are not on: only for trips of people you travel with; anything else is a Failure (404). */
    suspend fun access(tripId: String): AccessPreview {
        val o = JSONObject(Api.get("/api/trips/$tripId/access"))
        val owner = o.optJSONObject("owner") ?: JSONObject()
        fun day(k: String) = o.str(k)?.take(10)?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
        return AccessPreview(o.optString("tripId", tripId), o.optString("title"), day("startDate"), day("endDate"), owner.optString("id"), owner.optString("displayName"), owner.optBoolean("hasAvatar"), o.optString("status", "NONE"))
    }

    /** Only what was typed goes along: the grey line in the box is an example, not a default. */
    suspend fun askAccess(tripId: String, message: String) {
        Api.send("POST", "/api/trips/$tripId/access", JSONObject().apply { message.trim().takeIf { it.isNotEmpty() }?.let { put("message", it.take(300)) } })
    }

    // ---- Trips you were added to -------------------------------------------------------------

    data class Invite(val id: String, val title: String, val owner: String, val coverId: String?)

    suspend fun invites(): List<Invite> {
        val a = JSONArray(Api.get("/api/trips/invites"))
        return (0 until a.length()).map { a.getJSONObject(it) }.map { Invite(it.getString("id"), it.optString("title"), it.optString("ownerName"), it.str("coverId")) }
    }

    suspend fun invitesSeen() { Api.send("POST", "/api/trips/invites/seen") }

    // ---- What is behind the figures ----------------------------------------------------------

    data class Visit(val tripId: String, val tripTitle: String, val stopId: String, val from: String, val to: String, val places: List<String> = emptyList())
    data class ListTrip(val id: String, val title: String, val color: String?, val from: String, val to: String, val days: Int, val km: Int, val photos: Int)
    data class ListPlace(val name: String, val countryCode: String?, val visits: List<Visit>)
    data class ListCountry(val code: String, val visits: List<Visit>)
    data class FlightEnd(val name: String?, val airport: String?, val countryCode: String?)
    data class ListFlight(val tripId: String, val tripTitle: String, val stopId: String, val day: String, val from: FlightEnd, val to: FlightEnd)
    data class Lists(val trips: List<ListTrip>, val places: List<ListPlace>, val countries: List<ListCountry>, val flights: List<ListFlight>)
    data class Recent(val id: String, val title: String, val start: LocalDate?, val color: String?)
    data class Profile(val stats: Remote.Stats, val recent: List<Recent>, val lists: Lists?)

    private fun <T> JSONArray?.each(f: (JSONObject) -> T): List<T> = if (this == null) emptyList() else (0 until length()).map { f(getJSONObject(it)) }

    private fun visit(o: JSONObject) = Visit(
        o.optString("tripId"), o.optString("tripTitle"), o.optString("stopId"), o.optString("from").take(10), o.optString("to").take(10),
        o.optJSONArray("places")?.let { a -> (0 until a.length()).map { a.getString(it) } }.orEmpty(),
    )

    private fun end(o: JSONObject?) = FlightEnd(o?.str("name"), o?.str("airport"), o?.str("countryCode"))

    /** Someone's figures, their last trips and the lists behind the tiles, in one read. */
    suspend fun profile(userId: String): Profile {
        val o = JSONObject(Api.get("/api/users/$userId/stats"))
        val c = o.optJSONArray("countries")
        val stats = Remote.Stats(
            trips = o.optInt("trips"), days = o.optInt("days"),
            countries = (0 until (c?.length() ?: 0)).map { c!!.getString(it) },
            places = o.optInt("places"), flights = o.optInt("flights"),
            km = o.optDouble("distanceKm", 0.0).toInt(),
            photos = if (UiPrefs.ownPhotosOnly) o.optInt("ownPhotoCount", o.optInt("photoCount")) else o.optInt("photoCount"),
            ongoing = o.optInt("ongoing"),
        )
        val recent = o.optJSONArray("recent").each { Recent(it.optString("id"), it.optString("title"), it.str("startDate")?.take(10)?.let { d -> runCatching { LocalDate.parse(d) }.getOrNull() }, it.str("color")) }
        val l = o.optJSONObject("lists")
        val lists = l?.let {
            Lists(
                trips = it.optJSONArray("trips").each { t -> ListTrip(t.optString("id"), t.optString("title"), t.str("color"), t.optString("from").take(10), t.optString("to").take(10), t.optInt("days"), t.optDouble("km", 0.0).toInt(), t.optInt("photos")) },
                places = it.optJSONArray("places").each { p -> ListPlace(p.optString("name"), p.str("countryCode"), p.optJSONArray("visits").each(::visit)) },
                countries = it.optJSONArray("countries").each { p -> ListCountry(p.optString("code"), p.optJSONArray("visits").each(::visit)) },
                flights = it.optJSONArray("flights").each { f -> ListFlight(f.optString("tripId"), f.optString("tripTitle"), f.optString("stopId"), f.optString("day").take(10), end(f.optJSONObject("from")), end(f.optJSONObject("to"))) },
            )
        }
        return Profile(stats, recent, lists)
    }

    // ---- Stays found in the route ------------------------------------------------------------

    data class Stay(val key: String, val lat: Double, val lon: Double, val from: String, val to: String, val nights: Int, val photos: Int)

    suspend fun stays(trip: Trip): List<Stay> {
        val a = JSONArray(Api.get("/api/trips/${trip.remoteId}/stops/suggestions"))
        return a.each { Stay(it.optString("key"), it.optDouble("latitude"), it.optDouble("longitude"), it.optString("from"), it.optString("to"), it.optInt("nights"), it.optInt("photos")) }
            .filter { !it.lat.isNaN() && !it.lon.isNaN() }
    }

    /** The town at a spot and its country code, from Photon like the web (only the spot leaves the phone). */
    suspend fun townAt(lat: Double, lon: Double): Pair<String, String?>? = withContext(Dispatchers.IO) {
        fun ask(query: String): Pair<String, String?>? {
            val c = URL("https://photon.komoot.io/reverse?$query").openConnection() as HttpURLConnection
            return try {
                c.connectTimeout = 6_000; c.readTimeout = 6_000
                if (c.responseCode !in 200..299) return null
                val p = JSONObject(c.inputStream.bufferedReader().readText()).optJSONArray("features")?.optJSONObject(0)?.optJSONObject("properties") ?: return null
                fun s(k: String) = p.optString(k).takeIf { it.isNotBlank() }
                val name = s("city") ?: s("district") ?: s("locality") ?: s("name") ?: s("county") ?: s("state") ?: return null
                name to s("countrycode")?.uppercase()
            } finally { c.disconnect() }
        }
        runCatching { ask("lat=$lat&lon=$lon&limit=1&lang=en&osm_tag=place&radius=30") ?: ask("lat=$lat&lon=$lon&limit=1&lang=en") }.getOrNull()
    }

    /** A stay added as a stop with its own nights, at the end before the way back, as the web does. */
    suspend fun addStay(trip: Trip, id: String, stay: Stay, name: String, countryCode: String?, afterStopId: String?) {
        Api.send("POST", "/api/trips/${trip.remoteId}/stops", JSONObject().apply {
            put("id", id); put("name", name.take(120)); put("nights", stay.nights)
            put("latitude", stay.lat); put("longitude", stay.lon)
            countryCode?.let { put("countryCode", it) }
            afterStopId?.let { put("afterStopId", it) }
        })
    }

    // ---- Where the way there starts and the way back ends ------------------------------------

    /** The place you leave from or come back to, over land: its spot counts the kilometres, its name is kept in the notes. */
    suspend fun setLegPlace(trip: Trip, stopId: String, place: Remote.Place) {
        Api.send("PATCH", "/api/trips/${trip.remoteId}/stops/$stopId", JSONObject().apply {
            put("latitude", place.at.second); put("longitude", place.at.first)
            place.countryCode?.let { put("countryCode", it) }
            put("notes", place.name.take(120))
        })
    }
}

/** Short dates as the web writes them: "12 t/m 14 aug", "30 aug t/m 2 sep", one date when it is one day. */
private val ShortMonths = listOf("jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec")

fun shortRange(from: LocalDate, to: LocalDate, year: Boolean = false): String {
    val end = "${to.dayOfMonth} ${ShortMonths[to.monthValue - 1]}" + if (year) " ${to.year}" else ""
    return when {
        from == to -> end
        from.month == to.month && from.year == to.year -> "${from.dayOfMonth} t/m $end"
        else -> "${from.dayOfMonth} ${ShortMonths[from.monthValue - 1]} t/m $end"
    }
}

fun shortDay(d: LocalDate, year: Boolean = true): String = "${d.dayOfMonth} ${ShortMonths[d.monthValue - 1]}" + if (year) " ${d.year}" else ""

fun parseDay(s: String?): LocalDate? = s?.take(10)?.let { runCatching { LocalDate.parse(it) }.getOrNull() }

/** "1 reactie", "3 reacties": never "1 reacties". */
fun plural(n: Int, one: String, many: String) = "$n ${if (n == 1) one else many}"
