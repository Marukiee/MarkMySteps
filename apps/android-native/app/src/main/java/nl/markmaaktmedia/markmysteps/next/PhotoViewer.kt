package nl.markmaaktmedia.markmysteps.next

import android.app.Activity
import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import android.os.Build
import androidx.activity.compose.PredictiveBackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import java.time.format.TextStyle as DateStyle
import java.util.Locale

/*
 * A trip's photos full screen, swiped through one by one. Each opens on the
 * quick preview and then gets the original, the only rendition that still
 * carries an HDR gain map (Immich's smaller ones drop it). While such a photo
 * is on screen the window goes into HDR mode, so it shows as bright as on the
 * phone that took it; it goes back to normal when the viewer closes.
 */

@Composable
fun PhotoViewer(photos: List<Media>, start: Int, onClose: () -> Unit) {
    val pager = rememberPagerState(initialPage = start) { photos.size }
    val activity = LocalContext.current as? Activity
    var hdr by remember { mutableStateOf(false) }
    var chrome by remember { mutableStateOf(true) }
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val back = remember { Animatable(0f) }
    val appear = remember { Animatable(0f) }
    LaunchedEffect(Unit) { appear.animateTo(1f, androidx.compose.animation.core.tween(260)) }

    // HDR only while a photo with a gain map is up, and only on Android 14 and later.
    DisposableEffect(hdr) {
        val window = activity?.window
        if (window != null && Build.VERSION.SDK_INT >= 34) {
            window.colorMode = if (hdr) ActivityInfo.COLOR_MODE_HDR else ActivityInfo.COLOR_MODE_DEFAULT
            if (Build.VERSION.SDK_INT >= 35 && hdr) window.desiredHdrHeadroom = 0f
        }
        onDispose {
            if (window != null && Build.VERSION.SDK_INT >= 34) window.colorMode = ActivityInfo.COLOR_MODE_DEFAULT
        }
    }

    // Back follows the finger: the photo shrinks and the page behind shows through.
    PredictiveBackHandler { events ->
        try {
            events.collect { back.snapTo(it.progress) }
            appear.animateTo(0f, androidx.compose.animation.core.tween(180))
            onClose()
        } catch (e: kotlin.coroutines.cancellation.CancellationException) {
            scope.launch { back.animateTo(0f) }
            throw e
        }
    }

    Box(
        Modifier.fillMaxSize()
            .graphicsLayer { alpha = appear.value }
            .background(Color.Black.copy(alpha = 1f - back.value * 0.6f)),
    ) {
        HorizontalPager(pager, Modifier.fillMaxSize().graphicsLayer {
            val k = 1f - back.value * 0.12f
            scaleX = k * (0.94f + 0.06f * appear.value); scaleY = scaleX
        }) { page ->
            ViewerPhoto(photos[page], onHdr = { if (page == pager.currentPage) hdr = it }, onTap = { chrome = !chrome })
        }
        // Which day and where, and how far through the trip's photos.
        val shown by animateFloatAsState(if (chrome) 1f else 0f, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "chrome")
        Column(Modifier.fillMaxWidth().graphicsLayer { alpha = shown }.background(androidx.compose.ui.graphics.Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.55f), Color.Transparent)))) {
            Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(48.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.16f))
                        .pointerInput(Unit) { detectTapGestures { onClose() } },
                    contentAlignment = Alignment.Center,
                ) { LineIcon(listOf(P("M18 6 6 18"), P("m6 6 12 12")), Color.White, size = 22.dp, stroke = 2.2f) }
                val m = photos[pager.currentPage]
                Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                    val nl = Locale.forLanguageTag("nl-NL")
                    Text(
                        "${m.takenAt.dayOfWeek.getDisplayName(DateStyle.FULL, nl).replaceFirstChar { it.uppercase() }} ${m.takenAt.dayOfMonth} ${m.takenAt.month.getDisplayName(DateStyle.FULL, nl)}",
                        style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 17.sp, color = Color.White),
                    )
                    Text("${pager.currentPage + 1} van ${photos.size}", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = Color.White.copy(alpha = 0.75f)))
                }
                if (hdr) {
                    Text(
                        "HDR",
                        style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 12.sp, color = Color.White),
                        modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(Color.White.copy(alpha = 0.18f)).padding(horizontal = 8.dp, vertical = 4.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun ViewerPhoto(media: Media, onHdr: (Boolean) -> Unit, onTap: () -> Unit) {
    // The preview first, so there is something at once; then the original replaces it.
    val preview by produceState<Bitmap?>(Photos.cached("${media.id}/preview"), media.id) {
        if (value == null) value = Photos.load(media.id, "preview")
    }
    val original by produceState<Bitmap?>(Photos.cached("${media.id}/original"), media.id) {
        if (value == null && !media.video) value = Photos.load(media.id, "original")
    }
    LaunchedEffect(original) {
        onHdr(Build.VERSION.SDK_INT >= 34 && original?.hasGainmap() == true)
    }
    var zoom by remember { mutableFloatStateOf(1f) }
    var pan by remember { mutableStateOf(Offset.Zero) }
    val transform = rememberTransformableState { z, p, _ ->
        zoom = (zoom * z).coerceIn(1f, 5f)
        pan = if (zoom == 1f) Offset.Zero else pan + p
    }
    Box(
        Modifier.fillMaxSize()
            .pointerInput(Unit) { detectTapGestures(onTap = { onTap() }, onDoubleTap = { zoom = if (zoom > 1f) 1f else 2.5f; pan = Offset.Zero }) }
            .transformable(transform, canPan = { zoom > 1f }),
        contentAlignment = Alignment.Center,
    ) {
        val shown = original ?: preview
        if (shown == null) {
            LoadingIndicator(Modifier.size(56.dp), color = Color.White)
        } else {
            Image(
                shown.asImageBitmap(), contentDescription = null, contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize().graphicsLayer { scaleX = zoom; scaleY = zoom; translationX = pan.x; translationY = pan.y },
            )
        }
    }
}
