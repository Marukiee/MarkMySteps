package nl.markmaaktmedia.markmysteps.next

import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs
import kotlin.math.ln

class BookLayoutTest {
    private val mixes = listOf(
        listOf(0.75f), listOf(1.33f), listOf(2.8f), listOf(0.5625f),
        listOf(0.75f, 0.75f), listOf(1.33f, 1.33f), listOf(1.33f, 0.75f, 1.33f),
        listOf(0.56f, 1.78f, 1.0f, 0.75f), listOf(2.8f, 0.75f), listOf(1.78f, 1.78f, 1.78f, 1.78f),
        listOf(0.75f, 0.75f, 0.75f, 0.75f), listOf(1.0f, 2.8f, 0.5625f),
    )
    private val boxes = listOf(210f / 297f, 9f / 16f, 4f / 5f, 1f, 1.5f)

    @Test
    fun slotsStayInsideApartAndCloseToTheirShape() {
        for (box in boxes) for (mix in mixes) {
            val l = arrange(mix, box)
            assertTrue("$mix $box empty", l.slots.size == mix.size)
            for (s in l.slots) {
                assertTrue("$mix $box nan $s", !s.x.isNaN() && !s.y.isNaN() && s.w > 0f && s.h > 0f)
                assertTrue("$mix $box outside $s", s.x >= -1e-4f && s.y >= -1e-4f && s.x + s.w <= 1.0001f && s.y + s.h <= 1.0001f)
                val shown = s.w / s.h * box
                val photo = mix[s.index]
                val crop = 1f - minOf(shown, photo) / maxOf(shown, photo)
                assertTrue("$mix $box crop $crop $s", crop <= 0.23f)
            }
            for (a in l.slots) for (b in l.slots) if (a !== b) {
                val ox = minOf(a.x + a.w, b.x + b.w) - maxOf(a.x, b.x)
                val oy = minOf(a.y + a.h, b.y + b.h) - maxOf(a.y, b.y)
                assertTrue("$mix $box overlap $a $b", ox <= 1e-4f || oy <= 1e-4f)
            }
            val area = l.slots.sumOf { (it.w * it.h).toDouble() }
            println("box=%.2f %s -> fill %.2f score %.2f %s".format(box, mix, area, l.score, l.slots.joinToString(" ") { "[%.2f,%.2f %.2fx%.2f]".format(it.x, it.y, it.w, it.h) }))
        }
    }

    @Test
    fun paginateUsesEveryPhotoOnce() {
        val photos = List(37) { listOf(0.75f, 1.33f, 1.33f, 1.78f, 0.5625f, 2.8f, 1f)[(it * 7 + it / 3) % 7] }
        val pages = paginate(photos.indices.toList(), { photos[it] }, 210f / 297f)
        assertTrue(pages.flatMap { it.photos } == photos.indices.toList())
        println(pages.joinToString(" | ") { p -> p.photos.joinToString(",") { "%.2f".format(photos[it]) } })
    }

    @Test
    fun pagesHoldTheChosenNumber() {
        val photos = List(60) { listOf(0.75f, 1.33f, 1.33f, 1.78f, 0.5625f, 2.8f, 1f)[(it * 7 + it / 3) % 7] }
        for (per in 1..MAX_PER_PAGE) {
            val pages = paginate(photos.indices.toList(), { photos[it] }, 210f / 297f, per)
            assertTrue(pages.flatMap { it.photos } == photos.indices.toList())
            val sizes = pages.map { it.photos.size }
            println("per=$per pages=${pages.size} sizes=$sizes")
            // Nearly every page holds the chosen number, none more than one off.
            assertTrue("per=$per $sizes", sizes.all { abs(it - per) <= 1 })
            // And the book is about as short as the number promises: 60 at 8 a page is 8 pages, not 10.
            assertTrue("per=$per $sizes", pages.size <= (photos.size + per - 1) / per + 1)
        }
    }

    @Test
    fun aDayNeverLeavesOnePhotoBehind() {
        val shapes = listOf(0.75f, 1.33f, 1.33f, 0.75f, 1.78f, 1.33f, 0.75f, 1f, 1.33f)
        for (per in 2..MAX_PER_PAGE) for (n in 1..shapes.size) {
            val photos = shapes.take(n)
            val (head, rest) = chapter(photos.indices.toList(), { photos[it] }, 0.86f, 0.69f, per)
            val sizes = listOf(head.photos.size) + rest.map { it.photos.size }
            assertTrue("per=$per n=$n $sizes", (listOf(head) + rest).flatMap { it.photos } == photos.indices.toList())
            // No photo left alone on a page after the heading (the heading page itself may hold one big photo under its title).
            assertTrue("per=$per n=$n $sizes", rest.none { it.photos.size == 1 })
            println("per=$per n=$n $sizes")
        }
    }
}
