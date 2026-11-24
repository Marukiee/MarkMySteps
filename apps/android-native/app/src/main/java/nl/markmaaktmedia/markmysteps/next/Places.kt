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
 * Saltsjöbaden) had no tile at all. So: a stop wears a photo taken at it, wherever that falls in the trip. Only
 * the places in the plan get a tile (stops and day trips); towns passed on the way do not (Mark).
 */
object TripPlaces {
    /** A photo this close to a stop was taken at it. */
    private const val AT_KM = 8.0
    /** Further out, still the stop's surroundings when nothing closer was taken (as the web's STOP_NEAR_KM). */
    private const val AROUND_KM = 30.0

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

    fun km(a: LonLat, b: LonLat): Double {
        val r = Math.PI / 180
        val dLat = (b.second - a.second) * r
        val dLon = (b.first - a.first) * r
        val h = sin(dLat / 2).pow(2) + cos(a.second * r) * cos(b.second * r) * sin(dLon / 2).pow(2)
        return 2 * 6371 * asin(sqrt(h))
    }

    private fun Media.at(): LonLat? = if (lat != null && lon != null) lon to lat else null

    /** A place that can wear a tile: a stop, or a day trip from one. */
    private class Spot(val name: String, val flag: String?, val at: LonLat?, val cover: String?, val start: LocalDate?, val dayTrip: Boolean, val fallbackOrder: Int)

    /**
     * The stops (and day trips you photographed) with the photo that shows each, in trip order.
     *
     * Each photo that knows where it was taken belongs to the NEAREST place, so two places close together
     * (Granada and Monachil, 8 km apart) each get their own photos instead of both wearing the first photo
     * within 8 km. Of a place's own photos the one taken closest to its heart shows it; a cover the owner picked
     * for the place in the viewer always wins.
     */
    fun stops(trip: Trip, media: List<Media>, stopOn: (LocalDate) -> Stop?): List<Tile> {
        val stills = media.withIndex().filter { !it.value.video }
        val located = stills.filter { it.value.at() != null }
        val byId = media.associateBy { it.id }
        val spots = mutableListOf<Spot>()
        trip.stops.distinctBy { it.name }.forEachIndexed { i, stop ->
            spots += Spot(stop.name, stop.flag, stop.at, stop.cover, stop.start, dayTrip = false, fallbackOrder = i * 100_000)
            stop.dayTrips.forEach { d ->
                if (d.at != null && spots.none { it.name == d.name }) spots += Spot(d.name, d.flag, d.at, d.cover, d.day, dayTrip = true, fallbackOrder = i * 100_000 + 1)
            }
        }
        // Every located photo to the nearest place within reach.
        val own = spots.indices.associateWith { mutableListOf<Pair<IndexedValue<Media>, Double>>() }
        located.forEach { p ->
            val at = p.value.at()!!
            spots.withIndex().filter { it.value.at != null }
                .map { it.index to km(at, it.value.at!!) }
                .minByOrNull { it.second }
                ?.takeIf { it.second <= AROUND_KM }
                ?.let { (i, d) -> own.getValue(i) += p to d }
        }
        val out = mutableListOf<Tile>()
        spots.forEachIndexed { i, spot ->
            val mine = own.getValue(i)
            val taken = mine.filter { it.second <= AT_KM }
            // A day trip earns a tile only by a photo actually taken there.
            if (spot.dayTrip && taken.isEmpty() && spot.cover?.let(byId::get) == null) return@forEachIndexed
            // Taken at it first, closest to its heart first; then its surroundings.
            val ranked = (taken.ifEmpty { mine }).sortedBy { it.second }.map { it.first }
            // Only photos that do not know where they were taken still go by the day.
            val picks = ranked.ifEmpty { stills.filter { it.value.at() == null && stopOn(it.value.takenAt)?.name == spot.name } }
            val chosen = spot.cover?.let(byId::get)
            val photos = (listOfNotNull(chosen) + picks.map { it.value }.filter { it.id != chosen?.id }).take(8)
            val firstThere = mine.minByOrNull { it.first.index }?.first ?: picks.minByOrNull { it.index }
            out += Tile(spot.name, spot.flag, photos, firstThere?.value?.takenAt ?: chosen?.takenAt ?: spot.start, firstThere?.index ?: spot.fallbackOrder)
        }
        return out
    }
}
