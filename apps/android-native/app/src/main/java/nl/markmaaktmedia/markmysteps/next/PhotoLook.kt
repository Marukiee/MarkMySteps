package nl.markmaaktmedia.markmysteps.next

import android.graphics.Bitmap
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/*
 * What a photo looks like, read from its smallest thumbnail: is it sharp, is
 * it well lit, does it have colour, and a fingerprint (a difference hash) to
 * spot near-duplicates such as a burst of the same view. Nothing here needs
 * the original, so it works on a few hundred photos in a second or two and
 * nothing is sent anywhere.
 */
data class Look(
    /** 0 to 1: how much fine detail there is (blurry and shaken photos score low). */
    val sharp: Float,
    /** 0 to 1: 1 when the light is fine, lower when it is very dark or blown out. */
    val exposure: Float,
    /** 0 to 1: how colourful (a grey sky over grey water scores low). */
    val colour: Float,
    /** 64-bit difference hash: photos a few bits apart look the same. */
    val hash: Long,
    /** Average colour, for the placeholder while the photo loads. */
    val average: Int,
) {
    /** One number for "how good does this look", 0 to 1. */
    val beauty: Float get() = 0.45f * sharp + 0.30f * exposure + 0.25f * colour

    companion object {
        fun of(bitmap: Bitmap): Look {
            val small = Bitmap.createScaledBitmap(bitmap, 64, 64, true)
            val px = IntArray(64 * 64)
            small.getPixels(px, 0, 64, 0, 0, 64, 64)
            if (small !== bitmap) small.recycle()

            val gray = FloatArray(px.size)
            var sumR = 0L
            var sumG = 0L
            var sumB = 0L
            var dark = 0
            var blown = 0
            var rg = 0.0
            var yb = 0.0
            var rg2 = 0.0
            var yb2 = 0.0
            for (i in px.indices) {
                val c = px[i]
                val r = (c shr 16) and 255
                val g = (c shr 8) and 255
                val b = c and 255
                sumR += r; sumG += g; sumB += b
                val y = 0.299f * r + 0.587f * g + 0.114f * b
                gray[i] = y
                if (y < 18) dark++
                if (y > 248) blown++
                // Hasler and Süsstrunk's colourfulness.
                val a = (r - g).toDouble()
                val bb = (0.5 * (r + g) - b)
                rg += a; yb += bb; rg2 += a * a; yb2 += bb * bb
            }
            val n = px.size.toDouble()
            val sdRg = sqrt(max(0.0, rg2 / n - (rg / n) * (rg / n)))
            val sdYb = sqrt(max(0.0, yb2 / n - (yb / n) * (yb / n)))
            val meanRg = abs(rg / n)
            val meanYb = abs(yb / n)
            val colourfulness = sqrt(sdRg * sdRg + sdYb * sdYb) + 0.3 * sqrt(meanRg * meanRg + meanYb * meanYb)

            // Sharpness: variance of the Laplacian over the inner pixels.
            var lapSum = 0.0
            var lapSq = 0.0
            var count = 0
            for (y in 1 until 63) for (x in 1 until 63) {
                val i = y * 64 + x
                val l = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - 64] - gray[i + 64]
                lapSum += l; lapSq += l * l; count++
            }
            val lapVar = lapSq / count - (lapSum / count) * (lapSum / count)

            val mean = gray.average()
            val clipped = (dark + blown) / n
            val exposure = (1.0 - abs(mean - 118.0) / 118.0).coerceIn(0.0, 1.0) * (1.0 - clipped * 1.6).coerceIn(0.0, 1.0)

            return Look(
                sharp = (lapVar / 900.0).coerceIn(0.0, 1.0).let { sqrt(it) }.toFloat(),
                exposure = (0.25 + 0.75 * exposure).toFloat(),
                colour = (colourfulness / 90.0).coerceIn(0.0, 1.0).toFloat(),
                hash = dHash(gray),
                average = (0xFF shl 24) or ((sumR / n).toInt() shl 16) or ((sumG / n).toInt() shl 8) or (sumB / n).toInt(),
            )
        }

        /** Difference hash on a 9 by 8 shrink of the 64 by 64 grey image. */
        private fun dHash(gray: FloatArray): Long {
            val cells = FloatArray(9 * 8)
            for (cy in 0 until 8) for (cx in 0 until 9) {
                var s = 0f
                var c = 0
                val x0 = cx * 64 / 9
                val x1 = min(64, (cx + 1) * 64 / 9)
                for (y in cy * 8 until cy * 8 + 8) for (x in x0 until max(x0 + 1, x1)) {
                    s += gray[y * 64 + x]; c++
                }
                cells[cy * 9 + cx] = s / c
            }
            var h = 0L
            var bit = 0
            for (cy in 0 until 8) for (cx in 0 until 8) {
                if (cells[cy * 9 + cx] > cells[cy * 9 + cx + 1]) h = h or (1L shl bit)
                bit++
            }
            return h
        }
    }
}

/** How many of the 64 fingerprint bits differ: under about 12 is the same picture. */
fun Look.distance(other: Look): Int = java.lang.Long.bitCount(hash xor other.hash)
