package nl.markmaaktmedia.markmysteps.next

import android.graphics.Bitmap
import android.util.LruCache
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Canvas as GCanvas
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.CanvasDrawScope
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import java.time.Duration
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import kotlin.random.Random

/*
 * Where the photos come from. On the server: GET /api/media/:id/thumbnail,
 * with size=thumbnail for the small grid rendition (what PhotoLook reads),
 * no size for the preview of about 1440 pixels (what the pages show), and
 * size=original for the file as it was taken: the only one that still has an
 * Ultra HDR gain map. In the demo: drawn landscapes, each cut differently
 * from its scene so no two look alike unless they are meant to (a burst).
 */

enum class PhotoSize(val query: String?) { Thumbnail("thumbnail"), Preview(null), Original("original") }

/** Loads one rendition; null when it failed. Implemented over the API in Remote, after the login. */
fun interface PhotoLoader {
    suspend fun load(id: String, size: PhotoSize): Bitmap?
}

val LocalPhotoLoader = staticCompositionLocalOf<PhotoLoader?> { null }

private val memory = object : LruCache<String, Bitmap>(64 * 1024 * 1024) {
    override fun sizeOf(key: String, value: Bitmap) = value.allocationByteCount
}

/**
 * A photo, filling its box (cropped to it; the layouts keep that crop small).
 * The average colour shows at once, the photo fades in over it.
 */
@Composable
fun PhotoView(photo: TripPhoto, modifier: Modifier = Modifier, size: PhotoSize = PhotoSize.Preview, placeholder: Color? = null) {
    val loader = LocalPhotoLoader.current
    val key = "${photo.id}/${size.name}"
    var bitmap by remember(key) { mutableStateOf<ImageBitmap?>(memory.get(key)?.asImageBitmap()) }
    if (photo.scene == null && bitmap == null && loader != null) {
        LaunchedEffect(key) {
            // Fall back to the smaller rendition first so something shows quickly.
            if (size != PhotoSize.Thumbnail) memory.get("${photo.id}/${PhotoSize.Thumbnail.name}")?.let { bitmap = it.asImageBitmap() }
            val b = loader.load(photo.id, size)
            if (b != null) {
                memory.put(key, b)
                bitmap = b.asImageBitmap()
            }
        }
    }
    val shown by animateFloatAsState(if (photo.scene != null || bitmap != null) 1f else 0f, MaterialTheme.motionScheme.slowEffectsSpec(), label = "photo")
    Box(modifier.clipToBounds().background(placeholder ?: MaterialTheme.colorScheme.surfaceContainerHighest)) {
        val scene = photo.scene
        if (scene != null) {
            Canvas(Modifier.fillMaxSize()) { drawDemo(photo) }
        } else bitmap?.let {
            Image(it, null, Modifier.fillMaxSize().graphicsLayer { alpha = shown }, contentScale = ContentScale.Crop)
        }
    }
}

/** The demo photo: its scene, cut and mirrored by the photo's own numbers. */
fun DrawScope.drawDemo(photo: TripPhoto) {
    val scene = photo.scene ?: return
    val r = Random(photo.id.hashCode())
    val zoom = 1.15f + r.nextFloat() * 0.5f
    val ox = r.nextFloat() * (zoom - 1f)
    val oy = r.nextFloat() * (zoom - 1f)
    // A burst shares its first frame's numbers, give or take a hair.
    val jitter = if (photo.id.contains("~")) (photo.id.substringAfter("~").toInt() * 0.006f) else 0f
    clipRect {
        withTransform({
            if (photo.mirrored) scale(-1f, 1f, pivot = center)
            translate(-(ox + jitter) * size.width, -oy * size.height)
            scale(zoom, zoom, pivot = androidx.compose.ui.geometry.Offset.Zero)
        }) { drawScene(scene) }
    }
}

private fun renderDemo(photo: TripPhoto, w: Int, h: Int): Bitmap {
    val image = ImageBitmap(w, h)
    CanvasDrawScope().draw(Density(1f), LayoutDirection.Ltr, GCanvas(image), Size(w.toFloat(), h.toFloat())) { drawDemo(photo) }
    return image.asAndroidBitmap()
}

/** Progress while the thumbnails are being read. */
data class Reading(val done: Int, val total: Int)

/**
 * Reads every photo's thumbnail (six at a time, gently, so the server's limit
 * of 600 a minute is never close) and returns what each looks like and its
 * shape. A thumbnail that fails twice is left out: that photo is broken or
 * gone. Videos are read too, for days that only have videos.
 */
suspend fun readLooks(
    media: List<TripPhoto>,
    loader: PhotoLoader?,
    progress: (Reading) -> Unit,
): Pair<Map<String, Look>, Map<String, Float>> = coroutineScope {
    val looks = java.util.concurrent.ConcurrentHashMap<String, Look>()
    val aspects = java.util.concurrent.ConcurrentHashMap<String, Float>()
    val gate = Semaphore(6)
    var done = 0
    media.map { p ->
        async(Dispatchers.Default) {
            gate.withPermit {
                val bitmap: Bitmap? = when {
                    p.scene != null -> if (p.id.endsWith("broken")) null else {
                        val a = p.aspect ?: 1f
                        renderDemo(p, if (a >= 1f) 96 else (96 * a).toInt(), if (a >= 1f) (96 / a).toInt() else 96)
                    }
                    loader != null -> loader.load(p.id, PhotoSize.Thumbnail) ?: loader.load(p.id, PhotoSize.Thumbnail)
                    else -> null
                }
                if (bitmap != null) {
                    if (p.scene == null) memory.put("${p.id}/${PhotoSize.Thumbnail.name}", bitmap)
                    val soft = if (bitmap.config == Bitmap.Config.HARDWARE) bitmap.copy(Bitmap.Config.ARGB_8888, false) else bitmap
                    var look = Look.of(soft)
                    // Demo: some frames are shaken or too dark, as real ones are.
                    if (p.scene != null) {
                        val r = Random(p.id.hashCode() * 31)
                        look = look.copy(
                            sharp = look.sharp * (0.35f + 0.65f * r.nextFloat()),
                            exposure = look.exposure * (0.55f + 0.45f * r.nextFloat()),
                        )
                    }
                    looks[p.id] = look
                    aspects[p.id] = bitmap.width.toFloat() / bitmap.height
                }
                withContext(Dispatchers.Main) { progress(Reading(++done, media.size)) }
            }
        }
    }.awaitAll()
    looks to aspects
}

// --- Demo trips' photos ---

private val shapes = listOf(4f / 3f, 4f / 3f, 4f / 3f, 3f / 4f, 3f / 4f, 3f / 4f, 16f / 9f, 9f / 16f, 1f, 2.8f)

/**
 * A believable camera roll for a demo trip: a few to a couple of hundred
 * photos a day in all the shapes a phone makes, bursts of the same view, the
 * odd video, one photo that will not load and one screenshot.
 */
fun demoMedia(trip: Trip): Pair<List<TripPhoto>, LocalDate> {
    val r = Random(trip.id.hashCode())
    val start = demoStart(trip)
    val out = mutableListOf<TripPhoto>()
    val scenes = Scene.entries
    val zone = ZoneId.systemDefault()
    var day = 0
    trip.stops.forEachIndexed { si, stop ->
        val sceneBase = (si * 3 + trip.id.length) % scenes.size
        repeat(stop.nights.coerceAtLeast(1)) {
            val date = start.plusDays(day.toLong())
            // One heavy day per trip, as on the day of the big hike.
            val count = if (day == 2) 160 else if (r.nextFloat() < 0.15f) 2 else 6 + r.nextInt(30)
            var t = date.atTime(LocalTime.of(8, 0)).atZone(zone).toInstant()
            var n = 0
            while (n < count) {
                t = t.plus(Duration.ofSeconds((60 + r.nextInt(12 * 3600 / count.coerceAtLeast(1))).toLong()))
                val id = "${trip.id}-$day-$n"
                val shape = shapes[r.nextInt(shapes.size)]
                val scene = scenes[(sceneBase + r.nextInt(3)) % scenes.size]
                val at = stop.at.first + (r.nextDouble() - 0.5) * 0.3 to stop.at.second + (r.nextDouble() - 0.5) * 0.2
                val video = r.nextFloat() < 0.06f
                out += TripPhoto(id, "mark", t, shape, video, at, scene, r.nextBoolean())
                n++
                // A burst: the same view three or four times within seconds.
                if (!video && r.nextFloat() < 0.12f) repeat(2 + r.nextInt(3)) { k ->
                    out += TripPhoto("$id~${k + 1}", "mark", t.plusSeconds(k + 1L), shape, false, at, scene, out.last().mirrored)
                    n++
                }
            }
            day++
        }
    }
    if (out.size > 10) {
        out[7] = out[7].copy(id = out[7].id + "broken")
        out[9] = out[9].copy(aspect = 9f / 19.5f, at = null)
    }
    return out.sortedBy { it.takenAt } to start
}

private val monthNumbers = listOf("jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec")

/** "7 t/m 26 aug 2026" to the 7th of August 2026. */
fun demoStart(trip: Trip): LocalDate {
    val parts = trip.dates.split(" ")
    val day = parts.firstOrNull()?.toIntOrNull() ?: 1
    val month = parts.firstNotNullOfOrNull { p -> monthNumbers.indexOf(p.take(3)).takeIf { it >= 0 } } ?: 0
    return LocalDate.of(trip.year.toIntOrNull() ?: 2026, month + 1, day)
}
