package nl.markmaaktmedia.markmysteps.next

import java.time.LocalDate
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * The places of a trip as tiles above the timeline, chosen by where the photos were taken rather than by date.
 *
 * By date, a stop you only passed through (Gränna on the way to Stockholm, no night there) never had a photo: its
 * day belonged to the stop after it. And a city you photographed without it being a stop (Stockholm from
 * Saltsjöbaden) had no tile at all. So: a stop wears the first photo taken at it, wherever that falls in the trip;
 * photos taken away from every stop are gathered into places of their own, named after where they were taken.
 */
object TripPlaces {
    /** A photo this close to a stop was taken at it. */
    private const val AT_KM = 8.0
    /** Further out, still the stop's surroundings when nothing closer was taken (as the web's STOP_NEAR_KM). */
    private const val AROUND_KM = 30.0
    /** Photos this close together, away from the stops, are one place. */
    private const val GROUP_KM = 10.0
    /** A place of its own needs at least this many photos: a few shots from the road are not a visit. */
    private const val GROUP_MIN = 4

    data class Tile(
        val name: String,
        val flag: String?,
        /** The photos to show, the first that loads wins. */
        val photos: List<Media>,
        /** The day to jump to on a tap. */
        val day: LocalDate?,
        /** Order in the trip: the index of its first photo, else where the stop sits. */
        val order: Int,
    )

    /** A spot away from every stop where enough photos were taken to count as a place; named later. */
    data class Extra(val at: LonLat, val photos: List<Media>, val order: Int)

    // The names of the extra places, kept on the phone, so the row opens with them instead of growing a moment later.
    private var prefs: android.content.SharedPreferences? = null
    fun init(context: android.content.Context) { prefs = context.getSharedPreferences("mms.next.places", android.content.Context.MODE_PRIVATE) }
    private fun key(at: LonLat) = "%.2f,%.2f".format(java.util.Locale.ROOT, at.second, at.first)
    /** The city's name already known for a spot ("" for nowhere), without asking. */
    fun knownName(at: LonLat): String? = prefs?.getString(key(at), null)
    /** The city's name for a spot (Photon, as the viewer's place line), null when the lookup failed. */
    suspend fun name(at: LonLat): String? {
        knownName(at)?.let { return it }
        val full = runCatching { ViewerApi.placeName(at.second, at.first) }.getOrElse { return null }
        val city = full?.substringBefore(", ")?.trim().orEmpty()
        prefs?.edit()?.putString(key(at), city)?.apply()
        return city
    }

    fun km(a: LonLat, b: LonLat): Double {
        val r = Math.PI / 180
        val dLat = (b.second - a.second) * r
        val dLon = (b.first - a.first) * r
        val h = sin(dLat / 2).pow(2) + cos(a.second * r) * cos(b.second * r) * sin(dLon / 2).pow(2)
        return 2 * 6371 * asin(sqrt(h))
    }

    private fun Media.at(): LonLat? = if (lat != null && lon != null) lon to lat else null

    /** The stops (and day trips you photographed) with the photo that shows each, in trip order. */
    fun stops(trip: Trip, media: List<Media>, stopOn: (LocalDate) -> Stop?): List<Tile> {
        val stills = media.withIndex().filter { !it.value.video }
        val located = stills.filter { it.value.at() != null }
        fun faces(at: LonLat?, name: String, dates: (LocalDate) -> Boolean): List<IndexedValue<Media>> {
            if (at != null) {
                // Taken at it: the first ones, so the tile shows the place as you found it.
                val near = located.filter { km(it.value.at()!!, at) <= AT_KM }
                if (near.isNotEmpty()) return near
                val around = located.map { it to km(it.value.at()!!, at) }.filter { it.second <= AROUND_KM }.sortedBy { it.second }.map { it.first }
                if (around.isNotEmpty()) return around
            }
            // Only photos that do not know where they were taken still go by the day.
            return stills.filter { it.value.at() == null && dates(it.value.takenAt) && stopOn(it.value.takenAt)?.name == name }
        }
        val out = mutableListOf<Tile>()
        trip.stops.distinctBy { it.name }.forEachIndexed { i, stop ->
            val picks = faces(stop.at, stop.name) { true }
            out += Tile(stop.name, stop.flag, picks.take(8).map { it.value }, picks.firstOrNull()?.value?.takenAt ?: stop.start, picks.firstOrNull()?.index ?: (i * 100_000))
            // A day trip earns a tile by a photo actually taken there.
            stop.dayTrips.forEach { d ->
                val at = d.at ?: return@forEach
                if (out.any { it.name == d.name }) return@forEach
                val near = located.filter { km(it.value.at()!!, at) <= AT_KM }
                if (near.isNotEmpty()) out += Tile(d.name, d.flag, near.take(8).map { it.value }, near.first().value.takenAt, near.first().index)
            }
        }
        return out
    }

    /** Places where photos were taken away from every stop and day trip, in the order you were there. */
    fun extras(trip: Trip, media: List<Media>): List<Extra> {
        val known = trip.stops.flatMap { s -> listOf(s.at) + s.dayTrips.mapNotNull { it.at } }
        val away = media.withIndex().filter { (_, m) -> !m.video && m.at() != null && known.none { km(it, m.at()!!) <= AT_KM } }
        val groups = mutableListOf<MutableList<IndexedValue<Media>>>()
        away.forEach { p ->
            val g = groups.firstOrNull { km(it.first().value.at()!!, p.value.at()!!) <= GROUP_KM }
            if (g != null) g += p else groups += mutableListOf(p)
        }
        return groups.filter { it.size >= GROUP_MIN }.map { g -> Extra(g.first().value.at()!!, g.map { it.value }, g.first().index) }
    }
}
