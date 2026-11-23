package nl.markmaaktmedia.markmysteps.next

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/*
 * Page layout for the photo book and the summary, without any Compose in it:
 * photos in, rectangles out. Every arrangement keeps each photo close to its
 * own shape. A page tries every way to cut its photos into rows, and into
 * columns, works out how much of the page that fills and how much each photo
 * would have to be cropped, and keeps the best. A portrait photo therefore
 * ends up beside another portrait or stacked next to two landscapes, and a
 * panorama gets a row to itself, instead of everything being forced into the
 * same squares.
 */

/** One photo on a page, as fractions of the page's inner box (0 to 1 both ways). */
data class Slot(val index: Int, val x: Float, val y: Float, val w: Float, val h: Float)

data class PageLayout(val slots: List<Slot>, val score: Float)

/** How far a photo may be cropped, per side pair, before a layout gets penalised hard. */
private const val SOFT_CROP = 0.10f
private const val MAX_CROP = 0.22f

/**
 * Arranges photos with these width/height [aspects] in a box of [boxAspect]
 * (width/height), with [gap] between them as a fraction of the box width.
 */
fun arrange(aspects: List<Float>, boxAspect: Float, gap: Float = 0.018f): PageLayout {
    require(aspects.isNotEmpty())
    var best: PageLayout? = null
    for (cut in compositions(aspects.size)) {
        val rows = lines(aspects, cut, boxAspect, gap, vertical = false)
        if (best == null || rows.score > best.score) best = rows
        if (cut.size > 1 || aspects.size > 1) {
            val cols = lines(aspects, cut, boxAspect, gap, vertical = true)
            if (cols.score > best.score) best = cols
        }
    }
    return best!!
}

/** Every way to cut n items, in order, into consecutive groups: [2, 1] is two then one. */
private fun compositions(n: Int): List<List<Int>> {
    if (n == 0) return listOf(emptyList())
    val out = mutableListOf<List<Int>>()
    for (first in 1..n) for (rest in compositions(n - first)) out += listOf(first) + rest
    return out
}

/**
 * Lays the photos out as rows (or, [vertical], as columns: the same sum with
 * width and height swapped). Each row is as tall as it must be for its photos
 * to fill the width at their own shape; then the rows are stretched or
 * squeezed together to fill the height, which crops every photo by the same
 * small amount, and whatever cropping cannot cover is left as margin.
 */
private fun lines(aspects: List<Float>, cut: List<Int>, boxAspect: Float, gap: Float, vertical: Boolean): PageLayout {
    // Work in a box one unit wide; for columns, turn everything a quarter.
    val a = if (vertical) aspects.map { 1f / it } else aspects
    val boxW = 1f
    val boxH = if (vertical) boxAspect else 1f / boxAspect
    val g = if (vertical) gap * boxAspect else gap

    var start = 0
    val groups = cut.map { n -> (start until start + n).also { start += n } }
    val natural = groups.map { idx -> (boxW - g * (idx.count() - 1)) / idx.sumOf { a[it].toDouble() }.toFloat() }
    val gaps = g * (groups.size - 1)
    val naturalH = natural.sum()
    val room = boxH - gaps
    if (room <= 0f) return PageLayout(emptyList(), -99f)

    // s > 1: rows get taller than their photos' shape, so photos lose a bit of width.
    // s < 1: rows get shorter, so photos lose a bit of height. Past MAX_CROP the
    // rest stays as margin: above and below, or (too tall) at the sides.
    val s = room / naturalH
    val crop = if (s > 1f) 1f - 1f / s else 1f - s
    val stretch: Float
    val narrow: Float
    when {
        crop <= MAX_CROP -> { stretch = s; narrow = 1f }
        s > 1f -> { stretch = 1f / (1f - MAX_CROP); narrow = 1f }
        else -> { stretch = 1f - MAX_CROP; narrow = room / (naturalH * stretch) }
    }
    val shownCrop = min(crop, MAX_CROP)
    val heights = natural.map { it * stretch * narrow }
    val blockW = boxW * narrow
    val blockH = heights.sum() + gaps
    val used = (blockW / boxW) * (blockH / boxH)
    val offX = (boxW - blockW) / 2f
    val offY = (boxH - blockH) / 2f

    val slots = mutableListOf<Slot>()
    var y = offY
    groups.forEachIndexed { r, idx ->
        val h = heights[r]
        val sum = idx.sumOf { a[it].toDouble() }.toFloat()
        val inner = blockW - g * (idx.count() - 1)
        var x = offX
        for (i in idx) {
            val w = inner * a[i] / sum
            slots += if (vertical) Slot(i, y / boxH, x / boxW, h / boxH, w / boxW) else Slot(i, x / boxW, y / boxH, w / boxW, h / boxH)
            x += w + g
        }
        y += h + g
    }

    // Scoring: fill the page, crop little, keep every photo a decent size, and
    // keep photos in the same row about equally important.
    val smallest = slots.minOf { it.w * it.h }
    val tiny = if (smallest < 0.07f) (0.07f - smallest) * 14f else 0f
    val cropPenalty = if (shownCrop <= SOFT_CROP) shownCrop * 0.6f else SOFT_CROP * 0.6f + (shownCrop - SOFT_CROP) * 3f
    val balance = groups.sumOf { idx ->
        val ws = idx.map { a[it] }
        (ws.max() / ws.min() - 1f).coerceAtMost(4f).toDouble() * 0.015
    }.toFloat()
    val fill = used.coerceAtMost(1f).sq()
    return PageLayout(slots.sortedBy { it.index }, fill - cropPenalty - tiny - balance)
}

/** A page of the book: which photos go on it, and where. */
data class BookPage<T>(val photos: List<T>, val layout: PageLayout)

/**
 * How many photos a book page holds unless the reader picks another number:
 * six, about what the web's book always held, so a book stays a book and not
 * a stack of pages with two photos each.
 */
const val DEFAULT_PER_PAGE = 6
const val MAX_PER_PAGE = 8

/** What a page costs for being off the chosen number, squared: two pages one off beat one page two off. */
private const val OFF_TARGET = 0.6f

/**
 * Splits photos (in the order they were taken) into pages of about [perPage]
 * photos, so the pages together score best: a dynamic programme over where
 * each page ends. A page may take one more or fewer when the shapes fit far
 * better that way, but every photo off the chosen number costs something.
 *
 * Every page costs what it falls short of a perfect page (1 minus its score),
 * so the sum never rewards simply having more pages. Adding up the scores
 * themselves did: two pages of two always beat one page of four, which is why
 * the book never went past three photos a page.
 */
fun <T> paginate(photos: List<T>, aspect: (T) -> Float, boxAspect: Float, perPage: Int = DEFAULT_PER_PAGE): List<BookPage<T>> =
    plan(photos, aspect, boxAspect, perPage).first

/**
 * What one page costs: what it falls short of a perfect page, plus how far it
 * is off the chosen number, plus a little more for a photo alone on a page
 * when the reader asked for more than one.
 */
private fun pageCost(layout: PageLayout, k: Int, target: Int): Float =
    0.5f * (1f - layout.score) + OFF_TARGET * (k - target).sq() + if (k == 1 && target > 1) OFF_TARGET else 0f

/** The most photos a page may take: one more than chosen, except that one a page never doubles up. */
private fun mostFor(target: Int) = if (target <= 1) 1 else target + 1

/** [paginate], with what the pages cost together. */
private fun <T> plan(photos: List<T>, aspect: (T) -> Float, boxAspect: Float, perPage: Int): Pair<List<BookPage<T>>, Float> {
    if (photos.isEmpty()) return emptyList<BookPage<T>>() to 0f
    val target = perPage.coerceAtLeast(1)
    val n = photos.size
    val best = FloatArray(n + 1) { Float.POSITIVE_INFINITY }
    val from = IntArray(n + 1)
    val cache = HashMap<Long, PageLayout>()
    best[0] = 0f
    val most = mostFor(target)
    for (end in 1..n) for (k in 1..min(most, end)) {
        val begin = end - k
        if (best[begin] == Float.POSITIVE_INFINITY) continue
        val layout = cache.getOrPut(begin.toLong() * 1000 + end) { arrange(photos.subList(begin, end).map(aspect), boxAspect) }
        val v = best[begin] + pageCost(layout, k, target)
        if (v < best[end]) {
            best[end] = v
            from[end] = begin
        }
    }
    val pages = mutableListOf<BookPage<T>>()
    var end = n
    while (end > 0) {
        val begin = from[end]
        pages += BookPage(photos.subList(begin, end), cache[begin.toLong() * 1000 + end]!!)
        end = begin
    }
    return pages.reversed() to best[n]
}

/**
 * A day without an opener: a heading page with the first photos, then the
 * rest in pages. The heading's box is shorter, so it aims a little under
 * [perPage], but how many it takes is chosen together with the pages after
 * it: six photos at six a page is one full heading page, not five and then a
 * page with one photo left over.
 */
fun <T> chapter(photos: List<T>, aspect: (T) -> Float, headAspect: Float, bodyAspect: Float, perPage: Int = DEFAULT_PER_PAGE): Pair<BookPage<T>, List<BookPage<T>>> {
    require(photos.isNotEmpty())
    val target = perPage.coerceAtLeast(1)
    val headTarget = kotlin.math.round(target * 0.83f).toInt().coerceAtLeast(1)
    var best: Triple<BookPage<T>, List<BookPage<T>>, Float>? = null
    for (k in 1..min(mostFor(target), photos.size)) {
        val head = arrange(photos.take(k).map(aspect), headAspect)
        val (rest, restCost) = plan(photos.drop(k), aspect, bodyAspect, target)
        val cost = pageCost(head, k, headTarget) + restCost
        if (best == null || cost < best.third) best = Triple(BookPage(photos.take(k), head), rest, cost)
    }
    return best!!.first to best.second
}

/** How well a photo fills a frame of [frame] aspect when cropped to it: 1 is a perfect fit. */
fun fitTo(photo: Float, frame: Float): Float = min(photo, frame) / max(photo, frame)

/** Distance between two aspects on a log scale, so 2:1 and 1:2 are equally far from square. */
fun aspectDistance(a: Float, b: Float): Float = abs(kotlin.math.ln(a / b))

internal fun Float.sq() = this * this
internal fun Int.sq() = (this * this).toFloat()
internal fun hypot2(a: Float, b: Float) = sqrt(a * a + b * b)
