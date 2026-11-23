package nl.markmaaktmedia.markmysteps.next

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.provider.MediaStore
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.sp
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.OutputStream

/**
 * The photo book as a PDF, as the web's bookJob.ts: Snel (150 dpi, the previews) or Print (300 dpi, the
 * originals). It is made in the background while you use the app: the job lives at the root of the app, each
 * page is laid out off screen exactly as in the book (SheetView), recorded into a picture without ever being
 * drawn, turned into a JPEG and written into the file straight away, so only one page is in memory at a time.
 * A notification shows how far it is and opens the PDF when it is in your downloads.
 *
 * Android's PdfDocument would store each page losslessly (hundreds of megabytes for a book of photos), so the
 * file is written as the web writes it: one JPEG per page.
 *
 * Compose only lays out and draws while the app is on screen, so with the app in the background the job waits
 * and carries on when you come back.
 */
object BookJob {
    sealed interface State {
        data object Idle : State
        data class Running(val tripId: String, val title: String, val done: Int, val total: Int, val print: Boolean) : State
        data class Done(val tripId: String, val uri: Uri) : State
        data class Failed(val tripId: String) : State
    }

    var state by mutableStateOf<State>(State.Idle); private set

    internal class Work(val trip: Trip, val picked: Picked, val sheets: List<Sheet>, val accent: Color, val print: Boolean, val out: File, val name: String)
    internal var work by mutableStateOf<Work?>(null); private set

    private const val CHANNEL = "book"
    private const val NOTE = 7302

    fun busyWith(tripId: String) = (state as? State.Running)?.tripId == tripId

    /** Starts a book; false when another one is still being made. */
    fun start(context: Context, trip: Trip, picked: Picked, sheets: List<Sheet>, accent: Color, print: Boolean): Boolean {
        if (state is State.Running) return false
        val dir = File(context.cacheDir, "book").apply { mkdirs(); listFiles()?.forEach { it.delete() } }
        val safe = trip.title.replace(Regex("[^\\p{L}\\p{N} _-]"), "").trim().ifBlank { Lang.text(R.string.book_file) }
        work = Work(trip, picked, sheets, accent, print, File(dir, "book.pdf"), "$safe.pdf")
        state = State.Running(trip.id, trip.title, 0, sheets.size, print)
        notifyProgress(context, trip.title, 0, sheets.size)
        return true
    }

    fun cancel(context: Context) {
        work = null
        state = State.Idle
        context.getSystemService(NotificationManager::class.java)?.cancel(NOTE)
    }

    fun clear() { if (state !is State.Running) state = State.Idle }

    internal fun progress(context: Context, done: Int) {
        val w = work ?: return
        state = State.Running(w.trip.id, w.trip.title, done, w.sheets.size, w.print)
        notifyProgress(context, w.trip.title, done, w.sheets.size)
    }

    internal fun finished(context: Context, uri: Uri?) {
        val w = work ?: return
        work = null
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        channel(nm)
        if (uri == null) {
            state = State.Failed(w.trip.id)
            nm.notify(NOTE, android.app.Notification.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_stat_compass)
                .setContentTitle(Lang.text(R.string.book_notify_failed)).setContentText(Lang.text(R.string.book_failed)).setAutoCancel(true).build())
            return
        }
        state = State.Done(w.trip.id, uri)
        val open = PendingIntent.getActivity(
            context, 0, Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/pdf").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        nm.notify(NOTE, android.app.Notification.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_stat_compass)
            .setContentTitle(Lang.text(R.string.book_notify_done)).setContentText(Lang.text(R.string.book_notify_done_body, w.trip.title))
            .setContentIntent(open).setAutoCancel(true).build())
    }

    private fun channel(nm: NotificationManager) {
        nm.createNotificationChannel(NotificationChannel(CHANNEL, Lang.text(R.string.book_channel), NotificationManager.IMPORTANCE_LOW))
    }

    private fun notifyProgress(context: Context, title: String, done: Int, total: Int) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        channel(nm)
        val back = context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
            PendingIntent.getActivity(context, 1, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
        nm.notify(NOTE, android.app.Notification.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_stat_compass)
            .setContentTitle(Lang.text(R.string.book_notify_title, title))
            .setContentText(if (done == 0) Lang.text(R.string.book_preparing) else Lang.text(R.string.book_progress, done, total))
            .setProgress(total, done, done == 0).setOngoing(true).setOnlyAlertOnce(true).setContentIntent(back).build())
    }

    /** Into Download/MarkMySteps, where the phone's files app and any PDF reader find it. */
    internal suspend fun publish(context: Context, file: File, name: String): Uri? = withContext(Dispatchers.IO) {
        runCatching {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.MIME_TYPE, "application/pdf")
                put(MediaStore.Downloads.RELATIVE_PATH, "Download/MarkMySteps")
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val uri = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return@runCatching null
            context.contentResolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } }
            context.contentResolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
            file.delete()
            uri
        }.getOrNull()
    }
}

/**
 * A PDF written page by page, as the web's pdf.ts: each page one JPEG filling an A4 media box. Objects are
 * numbered as they come; the page tree and catalogue go last, with the cross-reference table.
 */
private class PdfWriter(private val out: OutputStream, private val dpi: Int) {
    private var length = 0L
    private val offsets = ArrayList<Long>()
    private val pages = ArrayList<Int>()

    init {
        write("%PDF-1.4\n")
        write(byteArrayOf(0x25, 0xe2.toByte(), 0xe3.toByte(), 0xcf.toByte(), 0xd3.toByte(), 0x0a))
        // 1 is the catalogue and 2 the page tree; they are written at the end, so their places are kept.
        offsets.add(0); offsets.add(0)
    }

    private fun write(s: String) = write(s.toByteArray(Charsets.ISO_8859_1))
    private fun write(b: ByteArray) { out.write(b); length += b.size }
    private fun begin(): Int { offsets.add(length); val id = offsets.size; write("$id 0 obj\n"); return id }
    private fun beginAt(id: Int) { offsets[id - 1] = length; write("$id 0 obj\n") }

    fun page(jpeg: ByteArray, width: Int, height: Int) {
        val w = width * 72f / dpi; val h = height * 72f / dpi
        val image = begin()
        write("<< /Type /XObject /Subtype /Image /Width $width /Height $height /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.size} >>\nstream\n")
        write(jpeg); write("\nendstream\nendobj\n")
        val content = "q ${"%.2f".format(java.util.Locale.ROOT, w)} 0 0 ${"%.2f".format(java.util.Locale.ROOT, h)} 0 0 cm /Im0 Do Q\n"
        val contents = begin()
        write("<< /Length ${content.length} >>\nstream\n$content endstream\nendobj\n")
        val page = begin()
        write("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${"%.2f".format(java.util.Locale.ROOT, w)} ${"%.2f".format(java.util.Locale.ROOT, h)}] /Resources << /XObject << /Im0 $image 0 R >> >> /Contents $contents 0 R >>\nendobj\n")
        pages.add(page)
    }

    fun finish(title: String) {
        beginAt(1); write("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
        beginAt(2); write("<< /Type /Pages /Count ${pages.size} /Kids [${pages.joinToString(" ") { "$it 0 R" }}] >>\nendobj\n")
        val info = begin()
        val safe = title.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)").filter { it.code in 32..126 }
        write("<< /Title ($safe) /Producer (MarkMySteps) >>\nendobj\n")
        val xref = length
        write("xref\n0 ${offsets.size + 1}\n0000000000 65535 f \n")
        offsets.forEach { write("${it.toString().padStart(10, '0')} 00000 n \n") }
        write("trailer\n<< /Size ${offsets.size + 1} /Root 1 0 R /Info $info 0 R >>\nstartxref\n$xref\n%%EOF\n")
        out.flush()
    }
}

/**
 * An original for Print, brought down to about 2400 pixels on its long side (enough for a photo on an A4 at
 * 300 dpi) and kept out of the shared caches, so a book of fifty-megapixel originals never fills the memory.
 */
private suspend fun printPhoto(id: String): Bitmap? = withContext(Dispatchers.IO) {
    runCatching {
        val data = DeviceMedia.bytes("$id/original") ?: Api.bytes("/api/media/$id/thumbnail?size=original") ?: return@runCatching null
        val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
        android.graphics.BitmapFactory.decodeByteArray(data, 0, data.size, bounds)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 2400) sample *= 2
        android.graphics.BitmapFactory.decodeByteArray(data, 0, data.size, android.graphics.BitmapFactory.Options().apply { inSampleSize = sample })
    }.getOrNull()
}

/**
 * Where the book's pages are laid out and recorded while a PDF is made: at the root of the app, so leaving
 * the book or the trip does not stop it. Nothing of it is ever drawn on screen.
 */
@Composable
fun BookJobHost() {
    val work = BookJob.work ?: return
    val context = androidx.compose.ui.platform.LocalContext.current
    var page by androidx.compose.runtime.remember(work) { mutableStateOf(0) }
    var held by androidx.compose.runtime.remember(work) { mutableStateOf<Pair<Int, Map<String, Bitmap>>?>(null) }
    val writer = androidx.compose.runtime.remember(work) { work.out.outputStream().buffered(1 shl 16).let { it to PdfWriter(it, if (work.print) 300 else 150) } }
    val dpi = if (work.print) 300 else 150
    val widthPx = Math.round(8.27f * dpi)
    val heightPx = Math.round(widthPx / PAGE_ASPECT)
    // The page is laid out 400 dp wide, and the density makes that the pixels of the paper.
    val pageDp = 400f
    val layer = rememberGraphicsLayer()
    // A printed book is on white paper: the light colours, whatever the app shows.
    val accent = legibleColor(work.trip.color, false)

    // One page at a time: its photos first at the quality asked for (so it is complete the moment it is laid out),
    // then laid out, given a moment (the globe of the route page draws its land), recorded, written.
    LaunchedEffect(work, page) {
        val sheet = work.sheets.getOrNull(page)
        try {
            if (sheet == null) {
                withContext(Dispatchers.IO) { writer.second.finish(work.trip.title); writer.first.close() }
                BookJob.finished(context, BookJob.publish(context, work.out, work.name))
                return@LaunchedEffect
            }
            val photos = when (sheet) {
                Sheet.Cover -> listOfNotNull(work.picked.cover)
                is Sheet.Opener -> listOf(sheet.photo)
                is Sheet.Photos -> sheet.photos
                else -> emptyList()
            }
            val map = HashMap<String, Bitmap>()
            for (r in photos) {
                val b = (if (work.print) printPhoto(r.photo.id) else null)
                    ?: runCatching { Photos.load(r.photo.id, "preview") }.getOrNull()
                // PhotoView looks for "<id>/Preview": the page shows exactly this one.
                if (b != null) map["${r.photo.id}/${PhotoSize.Preview.name}"] = b
            }
            held = page to map
            androidx.compose.runtime.withFrameNanos { }
            androidx.compose.runtime.withFrameNanos { }
            delay(if (sheet == Sheet.Route || sheet == Sheet.End || sheet == Sheet.Cover) 1200 else 300)
            val image = layer.toImageBitmap().asAndroidBitmap()
            withContext(Dispatchers.IO) {
                val soft = if (image.config == Bitmap.Config.HARDWARE) image.copy(Bitmap.Config.ARGB_8888, false) else image
                val jpeg = ByteArrayOutputStream().also { soft.compress(Bitmap.CompressFormat.JPEG, if (work.print) 90 else 82, it) }.toByteArray()
                writer.second.page(jpeg, soft.width.takeIf { it > 0 } ?: widthPx, soft.height.takeIf { it > 0 } ?: heightPx)
                if (soft !== image) soft.recycle()
            }
            if (BookJob.work !== work) return@LaunchedEffect
            BookJob.progress(context, page + 1)
            page++
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            android.util.Log.w("MmsBook", "page ${page + 1} failed: $e")
            runCatching { writer.first.close() }
            BookJob.finished(context, null)
        }
    }

    androidx.compose.runtime.DisposableEffect(work) { onDispose { runCatching { writer.first.close() } } }

    val (shownPage, photos) = held ?: return
    val sheet = work.sheets.getOrNull(shownPage) ?: return
    // A box of no size: the page inside it has the paper's size but is only recorded, never drawn.
    Box(Modifier.size(0.dp)) {
        CompositionLocalProvider(LocalDensity provides Density(widthPx / pageDp, 1f), LocalHeldPhotos provides photos, LocalPhotoLoader provides null) {
            MaterialExpressiveTheme(colorScheme = LightScheme) {
                Box(
                    Modifier.requiredSize(pageDp.dp, (pageDp / PAGE_ASPECT).dp)
                        .drawWithContent { layer.record { this@drawWithContent.drawContent() } }
                        .background(Color.White),
                ) {
                    SheetView(sheet, shownPage, BookContext(work.trip, work.picked, false, accent, TileBounds(), hidden = null, onPhoto = {}))
                }
            }
        }
    }
}

/** The book's save button: a menu with Snel and Print. */
@Composable
fun BookSaveButton(trip: Trip, picked: Picked, sheets: List<Sheet>, shape: androidx.compose.ui.graphics.Shape = androidx.compose.foundation.shape.CircleShape) {
    val cs = androidx.compose.material3.MaterialTheme.colorScheme
    val context = androidx.compose.ui.platform.LocalContext.current
    var menu by androidx.compose.runtime.remember { mutableStateOf(false) }
    val haptics = rememberHaptics()
    val busyOther = BookJob.state is BookJob.State.Running && !BookJob.busyWith(trip.id)
    Box {
        Box(
            Modifier.size(48.dp).clip(shape).background(cs.surfaceContainerHighest).dip { menu = true },
            contentAlignment = androidx.compose.ui.Alignment.Center,
        ) { LineIcon(Glyphs.download, cs.onSurface, size = 21.dp, stroke = 2.1f) }
        fun go(print: Boolean) {
            if (busyOther || !BookJob.start(context, trip, picked, sheets, androidx.compose.ui.graphics.Color.Unspecified, print)) haptics(Haptic.Reject)
            else haptics(Haptic.Confirm)
        }
        AppMenu(menu, { menu = false }, groups = listOf(listOf(
            MenuEntry(androidx.compose.ui.res.stringResource(R.string.book_quick) + " · " + androidx.compose.ui.res.stringResource(R.string.book_quick_hint), Glyphs.download) { go(false) },
            MenuEntry(androidx.compose.ui.res.stringResource(R.string.book_print) + " · " + androidx.compose.ui.res.stringResource(R.string.book_print_hint), BookGlyph) { go(true) },
        )), anchorHeight = 48.dp)
    }
}

/** Under the book's title: how far the PDF is, with Stoppen, or that it is in your downloads, with Openen. */
@Composable
fun BookSaveBar(trip: Trip) {
    val cs = androidx.compose.material3.MaterialTheme.colorScheme
    val context = androidx.compose.ui.platform.LocalContext.current
    val s = BookJob.state
    val mine = when (s) {
        is BookJob.State.Running -> s.tripId == trip.id
        is BookJob.State.Done -> s.tripId == trip.id
        is BookJob.State.Failed -> s.tripId == trip.id
        else -> false
    }
    var last by androidx.compose.runtime.remember { mutableStateOf<BookJob.State>(BookJob.State.Idle) }
    if (mine) last = s
    val motion = androidx.compose.material3.MaterialTheme.motionScheme
    androidx.compose.animation.AnimatedVisibility(
        mine,
        enter = androidx.compose.animation.fadeIn(motion.defaultEffectsSpec()) + androidx.compose.animation.expandVertically(motion.defaultSpatialSpec()),
        exit = androidx.compose.animation.fadeOut(motion.fastEffectsSpec()) + androidx.compose.animation.shrinkVertically(motion.fastSpatialSpec()),
    ) {
        androidx.compose.foundation.layout.Column(
            Modifier.padding(horizontal = 16.dp, vertical = 4.dp).fillMaxWidth().clip(androidx.compose.foundation.shape.RoundedCornerShape(22.dp))
                .background(cs.surfaceContainerHigh).padding(start = 16.dp, end = 8.dp, top = 10.dp, bottom = 10.dp),
        ) {
            androidx.compose.foundation.layout.Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                val text = when (val l = last) {
                    is BookJob.State.Running -> if (l.done == 0) androidx.compose.ui.res.stringResource(R.string.book_preparing) else androidx.compose.ui.res.stringResource(R.string.book_progress, l.done, l.total)
                    is BookJob.State.Done -> androidx.compose.ui.res.stringResource(R.string.book_done)
                    else -> androidx.compose.ui.res.stringResource(R.string.book_failed)
                }
                androidx.compose.material3.Text(
                    text, modifier = Modifier.weight(1f),
                    style = androidx.compose.ui.text.TextStyle(fontFamily = Outfit, fontWeight = androidx.compose.ui.text.font.FontWeight(600), fontSize = 15.sp, color = if (last is BookJob.State.Failed) cs.error else cs.onSurface),
                )
                // Pills like every other button in the app: the next step filled, the rest tonal.
                val pill = androidx.compose.ui.text.TextStyle(fontFamily = Outfit, fontWeight = androidx.compose.ui.text.font.FontWeight(600), fontSize = 14.sp)
                when (val l = last) {
                    is BookJob.State.Running -> androidx.compose.material3.FilledTonalButton(onClick = { BookJob.cancel(context) }, shapes = androidx.compose.material3.ButtonDefaults.shapes()) { androidx.compose.material3.Text(androidx.compose.ui.res.stringResource(R.string.book_cancel), style = pill) }
                    is BookJob.State.Done -> androidx.compose.material3.Button(shapes = androidx.compose.material3.ButtonDefaults.shapes(), onClick = {
                        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(l.uri, "application/pdf").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)) }
                        BookJob.clear()
                    }) { androidx.compose.material3.Text(androidx.compose.ui.res.stringResource(R.string.book_open), style = pill) }
                    else -> androidx.compose.material3.FilledTonalButton(onClick = { BookJob.clear() }, shapes = androidx.compose.material3.ButtonDefaults.shapes()) { androidx.compose.material3.Text(androidx.compose.ui.res.stringResource(R.string.common_close), style = pill) }
                }
            }
            val l = last
            if (l is BookJob.State.Running) {
                SmoothProgress(if (l.total == 0) 0f else l.done / l.total.toFloat(), Modifier.fillMaxWidth().padding(end = 8.dp, top = 2.dp))
                Hint(androidx.compose.ui.res.stringResource(R.string.book_running), Modifier.padding(top = 6.dp, end = 8.dp))
            }
        }
    }
}
