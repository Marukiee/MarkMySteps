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
}
