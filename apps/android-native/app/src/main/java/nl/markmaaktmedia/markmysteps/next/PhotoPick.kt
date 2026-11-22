package nl.markmaaktmedia.markmysteps.next

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/*
 * Which photos go into the book and the summary. The trip's media come in as
 * they are on the server (MediaItem: id, kind, when, where, and the size with
 * the EXIF turn applied when known); what each photo looks like comes from its
 * thumbnail (PhotoLook.kt). Then:
 *
 *  1. Out: videos (a print cannot play them; a day with only videos keeps one
 *     still), photos that failed to load, and screenshots (phone-screen shape
 *     and no place).
 *  2. Near-duplicates fold together: a burst, or the same view taken twice a
 *     few minutes apart, keeps only its best frame.
 *  3. Every day with photos gets a share that grows with the square root of
 *     how many it has, so a day with 200 photos gets more pages than a day
 *     with 5, but not forty times as many.
 *  4. Within a day the best photos go first, but each pick makes photos taken
 *     close in time or place to it less likely, so one viewpoint never fills
 *     a day.
 */

/** One photo or video of the trip, as GET /api/trips/:id/media hands it over. */
data class TripPhoto(
    val id: String,
    /** Whose photo: a burst only folds within one traveller's photos. */
    val userId: String = "",
    val takenAt: Instant,
    /** Width over height with the EXIF turn applied; null when the server does not know yet. */
    val aspect: Float?,
    val video: Boolean = false,
    val at: LonLat? = null,
    /** Demo only: the drawn landscape that stands in for the photo. */
    val scene: Scene? = null,
    val mirrored: Boolean = false,
)

/** A photo once its thumbnail has been looked at. */
data class Rated(val photo: TripPhoto, val look: Look, val aspect: Float, val stop: Int?) {
    val score: Float get() = look.beauty + (if (photo.at != null) 0.04f else 0f)
    /** For a poster, a cover or a chapter opener: places over close-ups of faces. */
    val showScore: Float get() = score - 0.35f * (look.face - 0.35f).coerceAtLeast(0f) / 0.65f
}

data class BookDay(
    val date: LocalDate,
    /** 1-based day of the trip. */
    val number: Int,
    val place: String?,
    val flag: String?,
    val photos: List<Rated>,
    val hero: Rated?,
    /** How many photos the day had before picking, for "12 van 84". */
    val total: Int,
)

data class Picked(
    val days: List<BookDay>,
    val cover: Rated?,
    /** The best few of the whole trip, spread over the stops, for the summary. */
    val highlights: List<Rated>,
    val photoCount: Int,
    val videoCount: Int,
    val folded: Int,
)

private fun isScreenshot(p: TripPhoto, aspect: Float): Boolean =
    p.at == null && (aspect < 0.5f || aspect > 2.05f) && aspect in 0.4f..2.4f

/**
 * The zone a photo was taken in. The server stores the true moment (UTC), so
 * the local day and clock come from the place: the country of the nearest
 * stop gives the zone (the one closest to the photo's longitude where a
 * country has several), and without stops the longitude alone. An evening
 * photo in Marrakesh then stays on its own day instead of moving to the next
 * one on Dutch time.
 */
fun zoneAt(where: LonLat?, stops: List<Stop>, at: Instant? = null): ZoneId {
    // With a place, the nearest stop; without one, the stop whose nights hold the photo's date.
    val near = if (where != null) stops.minByOrNull { angle(it.at, where) }?.takeIf { angle(it.at, where) < 8.0 }
    else at?.let { t ->
        val day = t.atOffset(java.time.ZoneOffset.UTC).toLocalDate()
        stops.firstOrNull { s -> s.start != null && !day.isBefore(s.start) && day.isBefore(s.start.plusDays(s.nights.coerceAtLeast(1).toLong())) }
    }
    val code = near?.flag?.let(::countryOf)
    if (code != null) countryZone(code, where?.first ?: near.at.first)?.let { return it }
    if (where == null || abs(where.first - HomeAirport.first) < 22) return ZoneId.systemDefault()
    return java.time.ZoneOffset.ofHours((where.first / 15.0).roundToInt().coerceIn(-12, 14))
}

/** A country's zones and their offsets, looked up once: the lookup is slow and a trip asks hundreds of times. */
private val zonesOf = java.util.concurrent.ConcurrentHashMap<String, List<Pair<String, Int>>>()
private val zoneIds = java.util.concurrent.ConcurrentHashMap<String, ZoneId>()

private fun countryZone(code: String, lon: Double): ZoneId? {
    val zones = zonesOf.getOrPut(code) {
        android.icu.util.TimeZone.getAvailableIDs(code).map { it to android.icu.util.TimeZone.getTimeZone(it).rawOffset }
    }
    if (zones.isEmpty()) return null
    val offsets = zones.map { it.second }
    // Spain has the Canaries and Portugal the Azores: there the country's usual zone counts,
    // only a country spanning several hours (the US, Russia, Brazil) goes by the longitude.
    val pick = if (offsets.max() - offsets.min() <= 2 * 3_600_000) {
        val usual = offsets.groupingBy { it }.eachCount().maxBy { it.value }.key
        zones.first { it.second == usual }.first
    } else {
        zones.minBy { abs(it.second / 3_600_000.0 - lon / 15.0) }.first
    }
    return zoneIds.getOrPut(pick) { runCatching { ZoneId.of(pick) }.getOrNull() ?: return null }
}

/** "🇲🇦" to "MA": a flag is two regional indicator letters. */
private fun countryOf(flag: String): String? {
    val cps = flag.codePoints().toArray()
    if (cps.size != 2 || cps.any { it !in 0x1F1E6..0x1F1FF }) return null
    return cps.joinToString("") { (it - 0x1F1E6 + 'A'.code).toChar().toString() }
}

fun localDay(at: Instant, where: LonLat?, stops: List<Stop> = emptyList()): LocalDate = at.atZone(zoneAt(where, stops, at)).toLocalDate()

/** Nearest stop within about 60 km, for "which place is this". */
fun nearestStop(at: LonLat?, stops: List<Stop>): Int? {
    if (at == null || stops.isEmpty()) return null
    val (i, d) = stops.mapIndexed { i, s -> i to angle(s.at, at) }.minBy { it.second }
    return if (d < 0.55) i else null
}

/**
 * Picks the book and the highlights. [looks] has a Look for every photo whose
 * thumbnail loaded; a photo without one failed and is left out.
 */
fun pickPhotos(
    media: List<TripPhoto>,
    looks: Map<String, Look>,
    aspects: Map<String, Float>,
    stops: List<Stop>,
    /** The trip's first day, so "Dag 1" is the day the trip starts even without photos. */
    start: LocalDate? = null,
    target: Int? = null,
    /** The cover chosen for the trip on the web, which wins when it is a photo of the trip. */
    coverId: String? = null,
): Picked {
    fun dayOf(p: TripPhoto) = localDay(p.takenAt, p.at, stops)
    val photos = media.filter { !it.video }
    val videos = media.filter { it.video }

    val rated = photos.mapNotNull { p ->
        val look = looks[p.id] ?: return@mapNotNull null
        val aspect = p.aspect ?: aspects[p.id] ?: return@mapNotNull null
        if (isScreenshot(p, aspect)) return@mapNotNull null
        Rated(p, look, aspect, nearestStop(p.at, stops))
    }.sortedBy { it.photo.takenAt }
    val ratedVideos = videos.mapNotNull { v ->
        val look = looks[v.id] ?: return@mapNotNull null
        Rated(v, look, v.aspect ?: aspects[v.id] ?: return@mapNotNull null, nearestStop(v.at, stops))
    }

    // --- 2. Fold near-duplicates, keeping the best of each group ---
    val keep = foldDuplicates(rated)
    val folded = rated.size - keep.size

    // --- 3. Share per day ---
    val byDay = keep.groupBy { dayOf(it.photo) }.toSortedMap()
    val videoDays = ratedVideos.groupBy { dayOf(it.photo) }
    val allDates = (byDay.keys + videoDays.keys).toSortedSet()
    if (allDates.isEmpty()) return Picked(emptyList(), null, emptyList(), photos.size, videos.size, folded)
    val first = minOf(start ?: allDates.first(), allDates.first())
    val wanted = target ?: (allDates.size * 7).coerceIn(24, 160)
    val counts = byDay.mapValues { it.value.size }
    val shares = shares(counts, wanted)

    val days = allDates.mapNotNull { date ->
        // A day with only videos keeps the best still of one, so the day is not missing.
        val list = byDay[date].orEmpty().ifEmpty { videoDays[date].orEmpty().sortedByDescending { it.score }.take(1) }
        if (list.isEmpty()) return@mapNotNull null
        val chosen = spread(list, shares[date] ?: 1).sortedBy { it.photo.takenAt }
        val placeIndex = list.mapNotNull { it.stop }.groupingBy { it }.eachCount().maxByOrNull { it.value }?.key
        val place = placeIndex?.let { stops[it] }
        val hero = chosen.maxByOrNull { it.showScore + (if (it.aspect >= 1.2f) 0.08f else 0f) }
        BookDay(
            date = date,
            number = (date.toEpochDay() - first.toEpochDay()).toInt() + 1,
            place = place?.name,
            flag = place?.flag,
            photos = chosen,
            hero = hero,
            total = list.size,
        )
    }

    // Otherwise a view rather than a face: a photo with a place, wide or of the page's own shape.
    val cover = rated.firstOrNull { it.photo.id == coverId }
        ?: keep.maxByOrNull { it.showScore + (if (it.photo.at != null) 0.05f else 0f) + (if (it.aspect in 0.68f..0.76f) 0.08f else if (it.aspect >= 1.3f) 0.1f else 0f) }
    val highlights = highlights(keep, stops.size, 12)
    return Picked(days, cover, highlights, photos.size, videos.size, folded)
}

/**
 * Groups photos taken in quick succession that look alike. Within 4 seconds
 * is one burst whatever it looks like; up to 10 minutes apart they must also
 * look the same (fingerprints at most 10 bits apart).
 */
private fun foldDuplicates(sorted: List<Rated>): List<Rated> {
    val out = mutableListOf<Rated>()
    val groups = mutableListOf<MutableList<Rated>>()
    for (r in sorted) {
        val t = r.photo.takenAt.toEpochMilli()
        val home = groups.asReversed().take(6).firstOrNull { g ->
            g.any { o ->
                val dt = abs(t - o.photo.takenAt.toEpochMilli())
                (dt < 4_000 && r.photo.userId == o.photo.userId) || (dt < 600_000 && r.look.distance(o.look) <= 10)
            }
        }
        if (home != null) home += r else groups += mutableListOf(r)
    }
    groups.forEach { g -> out += g.maxBy { it.score } }
    return out.sortedBy { it.photo.takenAt }
}

/** Shares proportional to the square root of each day's count, adding up to about [wanted]. */
private fun <K> shares(counts: Map<K, Int>, wanted: Int): Map<K, Int> {
    if (counts.isEmpty()) return emptyMap()
    fun at(k: Double) = counts.mapValues { (_, n) -> (k * sqrt(n.toDouble())).roundToInt().coerceIn(1, min(n, 14)) }
    var lo = 0.0
    var hi = 20.0
    repeat(30) {
        val mid = (lo + hi) / 2
        if (at(mid).values.sum() < wanted) lo = mid else hi = mid
    }
    return at(hi)
}

/**
 * The best [n] of a day, spread out: each pick lowers the value of photos
 * taken within an hour or so of it, and of photos taken at the same spot.
 */
private fun spread(list: List<Rated>, n: Int): List<Rated> {
    if (list.size <= n) return list
    val chosen = mutableListOf<Rated>()
    val left = list.toMutableList()
    val span = (list.last().photo.takenAt.toEpochMilli() - list.first().photo.takenAt.toEpochMilli()).coerceAtLeast(1)
    // The time scale follows the day: photos spread over 12 hours push each other away less than over 2.
    val scale = (span / (n + 1.0)).coerceIn(10 * 60_000.0, 90 * 60_000.0)
    while (chosen.size < n && left.isNotEmpty()) {
        val next = left.maxBy { r ->
            val crowd = chosen.sumOf { c ->
                val dt = abs(r.photo.takenAt.toEpochMilli() - c.photo.takenAt.toEpochMilli()) / scale
                val near = if (r.photo.at != null && c.photo.at != null) exp(-angle(r.photo.at, c.photo.at) / 0.004) else 0.0
                exp(-dt) * 0.7 + near * 0.3
            }
            r.score - 0.22f * crowd.toFloat()
        }
        chosen += next
        left -= next
    }
    return chosen
}

/** The summary's few: the best of each stop first, then the best of the rest, still spread out. */
private fun highlights(keep: List<Rated>, stops: Int, n: Int): List<Rated> {
    val out = mutableListOf<Rated>()
    keep.filter { it.stop != null }.groupBy { it.stop }.values
        .map { g -> g.maxBy { it.showScore } }
        .sortedByDescending { it.showScore }
        .take(max(1, n - 3))
        .forEach { out += it }
    val rest = spread(keep.filter { it !in out }.sortedBy { it.photo.takenAt }, n - out.size)
    out += rest
    return out.sortedBy { it.photo.takenAt }.take(n)
}
