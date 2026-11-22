package nl.markmaaktmedia.markmysteps.next

import android.app.Activity
import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.lang.ref.WeakReference
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt
import java.time.format.TextStyle as DateStyle

/*
 * A trip's photos full screen, swiped through one by one. Each opens on the
 * picture its tile already showed and then gets the preview and the original,
 * the only rendition that still carries an HDR gain map (Immich's smaller ones
 * drop it). While such a photo is on screen the window goes into HDR mode, so
 * it shows as bright as on the phone that took it; it goes back to normal when
 * the viewer closes.
 */

/** Where each timeline photo sits on screen and what it shows, so the viewer can grow from it and go back into it (as Keeper does). */
class TileBounds {
    val tiles = HashMap<String, LayoutCoordinates>()
    // Weak: the tiles hold their pictures; this only remembers which one each showed.
    private val images = HashMap<String, WeakReference<Bitmap>>()
    fun rect(id: String): Rect? = tiles[id]?.takeIf { it.isAttached }?.boundsInRoot()
    fun shown(id: String, bitmap: Bitmap) { if (images[id]?.get() !== bitmap) images[id] = WeakReference(bitmap) }
    fun image(id: String): Bitmap? = images[id]?.get()
}

/** From where to where the photo flies, both in screen coordinates; [to] null is the photo's own place, known once laid out. */
private class Hero(val bitmap: Bitmap, val from: Rect, val to: Rect?, val fromCorner: Float, val toCorner: Float)

/** A playing film's controls, shared between the page that plays it and the bar under the photo. */
@Stable
private class VideoHandle {
    var view: android.widget.VideoView? = null
    var player: android.media.MediaPlayer? = null
    var ready by mutableStateOf(false)
    var playing by mutableStateOf(true)
    var muted by mutableStateOf(false)
    var duration by mutableIntStateOf(0)
    var position by mutableIntStateOf(0)
    fun mute(on: Boolean) { muted = on; runCatching { player?.setVolume(if (on) 0f else 1f, if (on) 0f else 1f) } }
}

private const val DISMISS_RANGE = 0.35f
private const val CLOSE_AT = 0.15f
private const val MIN_DRAG_SCALE = 0.6f
private const val TAG = "MmsViewer"

/**
 * [startId] is the photo that was tapped; the viewer opens on exactly that one, found by its id (never by a
 * position that a second list could disagree with), and logs a check that the page shown is that photo.
 */
@Composable
fun PhotoViewer(trip: Trip, photos: List<Media>, startId: String, bounds: TileBounds = TileBounds(), onCurrent: (String?) -> Unit = {}, onClose: () -> Unit) {
    // The list as it was when tapped: a refresh of the trip underneath never shifts the pages.
    val list = remember { photos }
    val start = remember { list.indexOfFirst { it.id == startId }.coerceAtLeast(0) }
    val pager = rememberPagerState(initialPage = start) { list.size }
    val context = LocalContext.current
    val activity = context as? Activity
    val haptics = LocalHapticFeedback.current
    val motion = MaterialTheme.motionScheme
    var hdr by remember { mutableStateOf(false) }
    var chrome by remember { mutableStateOf(true) }
    val scope = rememberCoroutineScope()

    // The trip's comments and reactions, read once; your own changes show at once and go to the server behind them.
    var comments by remember { mutableStateOf<List<Remote.Comment>>(emptyList()) }
    var reactions by remember { mutableStateOf(Remote.Reactions(emptyMap(), emptyMap(), emptyMap())) }
    // The planned stops (day trips too), for "Omslag van ..." and as the place when a photo has no spot.
    var stops by remember { mutableStateOf<List<ViewerApi.StopRow>?>(null) }
    var immich by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(trip.remoteId) {
        if (trip.remoteId == null) return@LaunchedEffect
        launch { runCatching { ViewerApi.stops(trip) }.getOrNull()?.let { stops = it } }
        launch { immich = runCatching { ViewerApi.immichUrl() }.getOrNull() }
        runCatching { Remote.comments(trip) }.getOrNull()?.let { comments = it }
        runCatching { Remote.reactions(trip) }.getOrNull()?.let { reactions = it }
    }
    var sheet by remember { mutableStateOf(false) }
    // The five reactions' row; a tap anywhere on the photo folds it away again.
    var picking by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    // A short word after an action (saved, cover set), as the web's note under the top bar.
    var note by remember { mutableStateOf<String?>(null) }
    var noteSticky by remember { mutableStateOf(false) }
    LaunchedEffect(note, noteSticky) { if (note != null && !noteSticky) { delay(2600); note = null } }

    // Light status bar icons on the black viewer; the page's own come back the moment it starts closing.
    val bars = remember { activity?.window?.let { androidx.core.view.WindowCompat.getInsetsController(it, it.decorView) } }
    val barsBefore = remember { bars?.isAppearanceLightStatusBars }
    fun restoreBars() { if (barsBefore != null) bars?.isAppearanceLightStatusBars = barsBefore }
    DisposableEffect(Unit) {
        bars?.isAppearanceLightStatusBars = false
        onDispose { restoreBars() }
    }

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

    // As Keeper (and Immich): the photo grows out of its own tile into place, follows the finger when
    // dragged down while it shrinks, and flies back into its tile when let go far enough.
    val density = androidx.compose.ui.platform.LocalDensity.current
    val tileCorner = with(density) { TileRadius.toPx() }
    var drag by remember { mutableStateOf(Offset.Zero) }
    var areaHeight by remember { mutableFloatStateOf(1f) }
    var pagerRect by remember { mutableStateOf(Rect.Zero) }
    var origin by remember { mutableStateOf(Offset.Zero) }
    // What each page shows and where, so closing starts from exactly the picture on screen.
    val showing = remember { HashMap<String, Bitmap>() }
    val placed = remember { HashMap<String, LayoutCoordinates>() }
    val videos = remember { mutableStateMapOf<String, VideoHandle>() }
    // The first frame already holds the tile's own picture at the tile's place: nothing blank, nothing swapped.
    val first = list[start]
    val seed = remember { bounds.image(first.id) ?: Photos.cached("${first.id}/preview") ?: Photos.cached("${first.id}/thumbnail") }
    var hero by remember {
        val tile = bounds.rect(first.id)
        mutableStateOf(if (seed != null && tile != null) Hero(seed, tile, null, tileCorner, 0f) else null)
    }
    val grows = remember { hero != null }
    var heroT by remember { mutableFloatStateOf(0f) }
    var opening by remember { mutableStateOf(true) }
    var openT by remember { mutableFloatStateOf(0f) }
    var closing by remember { mutableStateOf(false) }
    var closeFade by remember { mutableFloatStateOf(0f) }
    // Zoomed in, a drag pans the photo; only at its normal size does dragging down put it away.
    var zoomed by remember { mutableStateOf(false) }
    var dragging by remember { mutableStateOf(false) }
    LaunchedEffect(pager.currentPage) { zoomed = false }
    fun progress() = maxOf((drag.y.coerceAtLeast(0f) / (areaHeight * DISMISS_RANGE)).coerceIn(0f, 1f), closeFade)
    fun fitted(b: Bitmap): Rect {
        val fit = minOf(pagerRect.width / b.width, pagerRect.height / b.height)
        val c = pagerRect.center
        return Rect(c.x - b.width * fit / 2f, c.y - b.height * fit / 2f, c.x + b.width * fit / 2f, c.y + b.height * fit / 2f)
    }
    // The corners round to the tile's rounding as soon as the photo is pulled, not a sliver at a time.
    val round by animateFloatAsState(if (dragging || drag.y > 1f) 1f else 0f, motion.fastSpatialSpec(), label = "round")

    LaunchedEffect(Unit) {
        // Hide the tile at once: the hero covering it is already drawn in this same first frame.
        onCurrent(first.id)
        snapshotFlow { pagerRect }.first { it.width > 0f && it.height > 0f }
        if (hero != null) {
            coroutineScope {
                launch { animate(0f, 1f, animationSpec = motion.defaultEffectsSpec()) { v, _ -> openT = v } }
                animate(0f, 1f, animationSpec = motion.defaultSpatialSpec()) { v, _ -> heroT = v }
            }
            hero = null
        } else {
            // No tile to grow from (or nothing loaded in it yet): the viewer itself comes up, never invisible.
            animate(0f, 1f, animationSpec = motion.defaultSpatialSpec()) { v, _ -> openT = v }
        }
        opening = false
        // The check Mark asked for: the page on screen is the photo that was tapped.
        val opened = list[pager.currentPage].id
        if (opened == startId) android.util.Log.i(TAG, "open ok tapped=$startId opened=$opened page=${pager.currentPage}/${list.size}")
        else {
            android.util.Log.w(TAG, "open MISMATCH tapped=$startId opened=$opened page=${pager.currentPage} start=$start")
            list.indexOfFirst { it.id == startId }.takeIf { it >= 0 }?.let { pager.scrollToPage(it) }
        }
    }
    // The tile under the photo on show stays empty, so the photo never exists twice.
    LaunchedEffect(pager.currentPage) {
        if (!opening && !closing) onCurrent(list[pager.currentPage].id)
        note = null; noteSticky = false; picking = false
    }

    fun closeNow(velocity: Velocity = Velocity.Zero) {
        if (closing || opening) return
        closing = true
        picking = false; menu = false
        restoreBars()
        val m = list[pager.currentPage]
        val bitmap = showing[m.id] ?: bounds.image(m.id) ?: Photos.cached("${m.id}/preview") ?: Photos.cached("${m.id}/thumbnail")
        val from = placed[m.id]?.takeIf { it.isAttached }?.boundsInRoot()
        val tile = bounds.rect(m.id)
        scope.launch {
            if (bitmap != null && tile != null && from != null && from.width > 0f) {
                heroT = 0f
                hero = Hero(bitmap, from, tile, tileCorner * round, tileCorner)
                coroutineScope {
                    launch { animate(closeFade, 1f, animationSpec = motion.defaultEffectsSpec()) { v, _ -> closeFade = v } }
                    // The standard scheme's spring: it lands in the tile without bouncing past it.
                    animate(0f, 1f, animationSpec = MotionScheme.standard().defaultSpatialSpec()) { v, _ -> heroT = v }
                }
            } else {
                // No tile on screen (scrolled away): the photo drops a little further while everything fades.
                coroutineScope {
                    launch { animate(closeFade, 1f, animationSpec = motion.fastEffectsSpec()) { v, _ -> closeFade = v } }
                    animate(Offset.VectorConverter, drag, drag + Offset(0f, areaHeight * 0.2f), Offset(velocity.x, velocity.y), motion.fastSpatialSpec()) { v, _ -> drag = v }
                }
            }
            onCurrent(null)
            onClose()
        }
    }
    fun springBack(velocity: Velocity) {
        scope.launch {
            animate(Offset.VectorConverter, drag, Offset.Zero, Offset(velocity.x, velocity.y), motion.defaultSpatialSpec()) { v, _ -> drag = v }
        }
    }
    val closeLatest by rememberUpdatedState<(Velocity) -> Unit> { closeNow(it) }
    // Back (button or gesture) closes the same way, back into the tile.
    // Predictive back: the photo follows the finger down and shrinks like a drag, letting go flies it home.
    androidx.activity.compose.PredictiveBackHandler(enabled = !picking) { events ->
        try {
            events.collect { e -> if (!closing && !opening) drag = Offset(0f, e.progress * areaHeight * DISMISS_RANGE * 0.8f) }
            closeLatest(Velocity.Zero)
        } catch (e: kotlin.coroutines.cancellation.CancellationException) {
            springBack(Velocity.Zero)
            throw e
        }
    }
    // Back first folds the reactions away, as on the web.
    BackHandler(enabled = picking) { picking = false }
    val backdropAlpha = { openT * (1f - (progress() * 1.8f).coerceAtMost(1f)) }

    Box(
        Modifier.fillMaxSize()
            .onGloballyPositioned { origin = it.positionInRoot() }
            .drawBehind { drawRect(Color.Black, alpha = backdropAlpha()) },
    ) {
        val tracker = remember { VelocityTracker() }
        HorizontalPager(pager, beyondViewportPageCount = 1, key = { list[it].id }, modifier = Modifier.fillMaxSize()
            .onGloballyPositioned { areaHeight = it.size.height.toFloat().coerceAtLeast(1f); pagerRect = it.boundsInRoot() }
            .pointerInput(Unit) {
                // A drag that starts downward (more down than sideways) moves the photo; sideways stays the pager's.
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                    tracker.resetTracking()
                    var pulling = false
                    var travelled = Offset.Zero
                    while (true) {
                        // Seen before the pager and the photo, so a swipe down is never taken for paging.
                        val event = awaitPointerEvent(PointerEventPass.Initial)
                        if (event.changes.size > 1) { dragging = false; return@awaitEachGesture }
                        val change = event.changes.first()
                        if (!change.pressed) break
                        val delta = change.positionChange()
                        tracker.addPosition(change.uptimeMillis, change.position)
                        if (!pulling) {
                            travelled += delta
                            if (travelled.getDistance() > viewConfiguration.touchSlop) {
                                if (travelled.y > 0f && abs(travelled.y) > abs(travelled.x) * 0.8f && !opening && !closing && !zoomed) { pulling = true; dragging = true; picking = false } else return@awaitEachGesture
                            }
                        } else {
                            change.consume()
                            drag += delta
                        }
                    }
                    dragging = false
                    if (!pulling) return@awaitEachGesture
                    val v = tracker.calculateVelocity()
                    if (drag.y > areaHeight * CLOSE_AT || (v.y > 1800f && drag.y > 40f)) closeLatest(v) else springBack(v)
                }
            }
            .graphicsLayer {
                // Hidden under the flying photo; without a tile to grow from it fades and grows in itself.
                alpha = when { hero != null -> 0f; opening -> openT.coerceIn(0f, 1f); else -> 1f - closeFade }
                val grow = if (opening && !grows) 0.92f + 0.08f * openT else 1f
                val scale = (1f - (1f - MIN_DRAG_SCALE) * progress()) * grow
                translationX = drag.x; translationY = drag.y; scaleX = scale; scaleY = scale
            }) { page ->
            val m = list[page]
            val active = page == pager.currentPage
            // Rounded to the tile's corners while pulled, divided by the shrink so they look the same size on screen.
            val corner: Density.() -> Float = { val scale = 1f - (1f - MIN_DRAG_SCALE) * progress(); tileCorner * round / scale }
            val onShown: (Bitmap, LayoutCoordinates) -> Unit = { b, c -> showing[m.id] = b; placed[m.id] = c }
            val tileSeed = bounds.image(m.id)
            if (m.video) {
                val handle = remember(m.id) { VideoHandle() }
                DisposableEffect(m.id) { videos[m.id] = handle; onDispose { videos.remove(m.id) } }
                ViewerVideo(m, handle, active = active && !opening, seed = tileSeed, onTap = { if (picking) picking = false else chrome = !chrome }, cornerPx = corner, onShown = onShown)
            } else {
                ViewerPhoto(m, seed = tileSeed, onHdr = { if (active) hdr = it }, onTap = { if (picking) picking = false else chrome = !chrome },
                    onZoomed = { if (active) zoomed = it }, cornerPx = corner, onShown = onShown)
            }
        }

        val current = list[pager.currentPage]
        // The bars come in once the photo is nearly in place and go early while it is dragged away.
        val barsOn = chrome && !opening && !closing
        val dragFade = { 1f - (progress() * 5f).coerceAtMost(1f) }

        // Top: close, which day and where, the HDR mark and the photo's options, over a dark fade so they read on any photo, zoomed too.
        AnimatedVisibility(
            barsOn, modifier = Modifier.fillMaxWidth().graphicsLayer { alpha = dragFade() },
            enter = fadeIn(motion.defaultEffectsSpec()), exit = fadeOut(motion.fastEffectsSpec()),
        ) {
            Column(Modifier.fillMaxWidth().background(Brush.verticalGradient(0f to Color.Black.copy(alpha = 0.66f), 0.65f to Color.Black.copy(alpha = 0.34f), 1f to Color.Transparent))) {
                Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
                Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp).padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    RoundButton(onClick = { closeLatest(Velocity.Zero) }) { LineIcon(listOf(P("M18 6 6 18"), P("m6 6 12 12")), Color.White, size = 22.dp, stroke = 2.2f) }
                    Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                        val nl = Locale.forLanguageTag("nl-NL")
                        Text(
                            "${current.takenAt.dayOfWeek.getDisplayName(DateStyle.FULL, nl).replaceFirstChar { it.uppercase() }} ${current.takenAt.dayOfMonth} ${current.takenAt.month.getDisplayName(DateStyle.FULL, nl)}",
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                            style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 17.sp, color = Color.White),
                        )
                        PlaceLine(current, list, pager.currentPage, stops)
                        Text(
                            "${pager.currentPage + 1} van ${list.size}",
                            style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = Color.White.copy(alpha = 0.72f)),
                        )
                    }
                    if (hdr) {
                        Text(
                            "HDR",
                            style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 12.sp, color = Color.White),
                            modifier = Modifier.padding(end = 8.dp).clip(RoundedCornerShape(8.dp)).background(Color.White.copy(alpha = 0.18f)).padding(horizontal = 8.dp, vertical = 4.dp),
                        )
                    }
                    if (trip.remoteId != null) Box {
                        RoundButton(onClick = { menu = true }) { LineIcon(Glyphs.dotsCircles, Color.White, size = 20.dp, filled = true) }
                        ViewerMenu(trip, current, stops, immich, expanded = menu, onDismiss = { menu = false }, onNote = { text, sticky -> note = text; noteSticky = sticky })
                    }
                }
                Spacer(Modifier.height(28.dp))
            }
        }

        // A short word after an action, under the top bar.
        val noteShown = remember { MutableTransitionState(false) }
        var lastNote by remember { mutableStateOf("") }
        noteShown.targetState = note != null && !closing
        if (note != null) lastNote = note!!
        AnimatedVisibility(
            noteShown, modifier = Modifier.align(Alignment.TopCenter).padding(top = 132.dp).graphicsLayer { alpha = dragFade() },
            enter = fadeIn(motion.fastEffectsSpec()) + scaleIn(motion.fastSpatialSpec(), initialScale = 0.8f),
            exit = fadeOut(motion.fastEffectsSpec()) + scaleOut(motion.fastSpatialSpec(), targetScale = 0.9f),
        ) {
            Box(Modifier.padding(top = with(density) { WindowInsets.statusBars.getTop(this).toDp() })) {
                Text(
                    lastNote,
                    style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 14.sp, color = Color.White),
                    modifier = Modifier.clip(CircleShape).background(Color.Black.copy(alpha = 0.72f)).padding(horizontal = 16.dp, vertical = 10.dp),
                )
            }
        }

        // Below: a film's controls, then how people reacted and what they said, over a soft dark fade.
        AnimatedVisibility(
            barsOn, modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().graphicsLayer { alpha = dragFade() },
            enter = fadeIn(motion.defaultEffectsSpec()), exit = fadeOut(motion.fastEffectsSpec()),
        ) {
            Column(
                Modifier.fillMaxWidth()
                    .background(Brush.verticalGradient(0f to Color.Transparent, 0.35f to Color.Black.copy(alpha = 0.34f), 1f to Color.Black.copy(alpha = 0.66f)))
                    .padding(horizontal = 16.dp).padding(top = 36.dp),
            ) {
                val handle = if (current.video) videos[current.id] else null
                if (current.video) VideoControls(handle, Modifier.padding(bottom = 12.dp))
                SocialBar(
                    mine = reactions.mine[current.id],
                    counts = reactions.counts[current.id].orEmpty(),
                    names = reactions.names[current.id].orEmpty(),
                    comments = comments.count { it.mediaId == current.id },
                    enabled = trip.remoteId != null,
                    onReact = { kind ->
                        val before = reactions
                        val target = current.id
                        reactions = withMine(reactions, target, kind)
                        scope.launch { runCatching { Remote.setReaction(trip, target, kind) }.onFailure { reactions = before } }
                    },
                    onComments = { sheet = true },
                    picking = picking, onPicking = { picking = it },
                )
                // Always above the gesture bar, never under it.
                Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
                Spacer(Modifier.height(12.dp))
            }
        }
        if (sheet) {
            CommentsSheet(
                comments = comments.filter { it.mediaId == current.id }.sortedBy { it.at },
                onDismiss = { sheet = false },
                onSend = { text ->
                    scope.launch {
                        runCatching { Remote.addComment(trip, current.id, text) }.getOrNull()?.let { comments = comments + it }
                    }
                },
                onDelete = { c ->
                    val before = comments
                    comments = comments - c
                    scope.launch { runCatching { Remote.deleteComment(trip, c.id) }.onFailure { comments = before } }
                },
            )
        }
        hero?.let { h ->
            // The photo grows or shrinks between its tile and its place, cropping itself to the tile's shape.
            val image = remember(h) { h.bitmap.asImageBitmap() }
            Image(
                image, null, contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
                    .layout { measurable, constraints ->
                        val to = h.to ?: if (pagerRect.width > 0f) fitted(h.bitmap) else h.from
                        val r = androidx.compose.ui.geometry.lerp(h.from, to, heroT)
                        val placeable = measurable.measure(Constraints.fixed(r.width.roundToInt().coerceAtLeast(1), r.height.roundToInt().coerceAtLeast(1)))
                        layout(constraints.maxWidth, constraints.maxHeight) { placeable.place((r.left - origin.x).roundToInt(), (r.top - origin.y).roundToInt()) }
                    }
                    .graphicsLayer {
                        val t = heroT.coerceIn(0f, 1f)
                        shape = RoundedCornerShape(h.fromCorner + (h.toCorner - h.fromCorner) * t); clip = true
                    },
            )
        }
    }
}

/** A round see-through button on the photo, as the close button. */
@Composable
private fun RoundButton(onClick: () -> Unit, size: androidx.compose.ui.unit.Dp = 48.dp, content: @Composable () -> Unit) {
    val haptics = LocalHapticFeedback.current
    var pressed by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (pressed) 0.9f else 1f, MaterialTheme.motionScheme.fastSpatialSpec(), label = "press")
    Box(
        Modifier.size(size).graphicsLayer { scaleX = scale; scaleY = scale }.clip(CircleShape).background(Color.White.copy(alpha = 0.18f))
            .pointerInput(Unit) {
                detectTapGestures(onPress = { pressed = true; tryAwaitRelease(); pressed = false }, onTap = { haptics.performHapticFeedback(HapticFeedbackType.ContextClick); onClick() })
            },
        contentAlignment = Alignment.Center,
    ) { content() }
}

/**
 * Where the photo was taken, under the date, as the web does it: the place its spot lies in, else the stop
 * it belongs to. The line keeps its height and its last name while the next one is looked up, and only
 * crossfades when the name really changes, so twenty photos in one town never flash it twenty times.
 */
@Composable
private fun PlaceLine(current: Media, list: List<Media>, page: Int, stops: List<ViewerApi.StopRow>?) {
    var place by remember { mutableStateOf<String?>(null) }
    // Asked again only for another photo or once the stops are known; never on a recomposition.
    LaunchedEffect(current.id, stops != null) {
        val fallback = stops?.let { ViewerApi.stopFor(current, it)?.name }
        val lat = current.lat; val lon = current.lon
        place = if (lat == null || lon == null) fallback ?: place
        else runCatching { ViewerApi.placeName(lat, lon) }.fold({ it ?: fallback }, { e -> android.util.Log.w(TAG, "place lookup failed: $e"); fallback ?: place })
        // The neighbours' names ahead of time, so paging shows them straight away.
        for (n in listOf(page + 1, page - 1)) list.getOrNull(n)?.let { m -> if (m.lat != null && m.lon != null) runCatching { ViewerApi.placeName(m.lat, m.lon) } }
    }
    Box(Modifier.fillMaxWidth().height(20.dp), contentAlignment = Alignment.CenterStart) {
        Crossfade(place, animationSpec = MaterialTheme.motionScheme.defaultEffectsSpec(), label = "place") { p ->
            if (p != null) Text(
                p, maxLines = 1, overflow = TextOverflow.Ellipsis,
                style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 14.sp, color = Color.White.copy(alpha = 0.88f)),
            )
        }
    }
}

/**
 * The ⋯ menu of a photo, the same options as the web's viewer: the trip's or a stop's cover (owner only),
 * the original saved to the phone, opened in or shared with another app, and your own photo in Immich.
 */
@Composable
private fun ViewerMenu(trip: Trip, media: Media, stops: List<ViewerApi.StopRow>?, immich: String?, expanded: Boolean, onDismiss: () -> Unit, onNote: (String?, Boolean) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val me = Data.me?.id
    val owner = trip.ownerId != null && trip.ownerId == me
    val stop = remember(media.id, stops) { stops?.let { ViewerApi.stopFor(media, it) } }
    val what = if (media.video) "Video" else "Foto"
    fun cover(label: String, block: suspend () -> Unit) {
        scope.launch {
            runCatching { block() }
                .onSuccess { onNote("$label ingesteld", false); Data.load() }
                .onFailure { onNote("Instellen lukte niet", false) }
        }
    }
    fun handOver(block: (android.net.Uri, String) -> Unit) {
        scope.launch {
            onNote("$what ophalen…", true)
            val file = ViewerApi.shared(context, media)
            if (file == null) onNote("Ophalen lukte niet", false)
            else { onNote(null, false); runCatching { block(file.first, file.second) }.onFailure { onNote("Geen app gevonden", false) } }
        }
    }
    AppMenu(expanded, onDismiss, groups = listOf(
        if (owner) listOfNotNull(
            MenuEntry("Omslag van de reis", Glyphs.photo) { cover("Omslag van de reis") { ViewerApi.setTripCover(trip, media.id) } },
            stop?.let { s -> MenuEntry("Omslag van ${s.name}", Glyphs.pin) { cover("Omslag van ${s.name}") { ViewerApi.setStopCover(trip, s.id, media.id) } } },
        ) else emptyList(),
        listOf(
            MenuEntry("$what downloaden", Glyphs.download) {
                scope.launch {
                    onNote("Downloaden…", true)
                    val uri = ViewerApi.download(context, media)
                    onNote(if (uri != null) "Opgeslagen in je galerij" else "Downloaden lukte niet", false)
                }
            },
            MenuEntry("Openen in…", Glyphs.external) { handOver { uri, type -> ViewerApi.openIn(context, uri, type) } },
            MenuEntry("Delen", Glyphs.send) { handOver { uri, type -> ViewerApi.share(context, uri, type) } },
        ),
        // Only your own photos live in your Immich; a friend's are on theirs.
        if (immich != null && media.immichAssetId != null && media.userId.isNotBlank() && media.userId == me)
            listOf(MenuEntry("Openen in Immich", Glyphs.globe) { ViewerApi.browse(context, "$immich/photos/${media.immichAssetId}") })
        else emptyList(),
    ))
}

@Composable
private fun ViewerPhoto(
    media: Media, seed: Bitmap?, onHdr: (Boolean) -> Unit, onTap: () -> Unit, onZoomed: (Boolean) -> Unit = {},
    cornerPx: Density.() -> Float = { 0f }, onShown: (Bitmap, LayoutCoordinates) -> Unit = { _, _ -> },
) {
    // Opens on what is already here (the tile's own picture), so there is never an empty frame or a spinner;
    // then the preview, then the original replaces it. Kept per photo, never carried over from another page.
    val preview = remember(media.id) { mutableStateOf(Photos.cached("${media.id}/preview") ?: seed ?: Photos.cached("${media.id}/thumbnail")) }
    val original = remember(media.id) { mutableStateOf(Photos.cached("${media.id}/original")) }
    LaunchedEffect(media.id) {
        if (preview.value == null) Photos.load(media.id, "thumbnail", now = true)?.let { if (preview.value == null) preview.value = it }
        Photos.load(media.id, "preview", now = true)?.let { preview.value = it }
        if (original.value == null) original.value = Photos.load(media.id, "original", now = true)
    }
    LaunchedEffect(original.value) {
        onHdr(Build.VERSION.SDK_INT >= 34 && original.value?.hasGainmap() == true)
    }
    var zoom by remember { mutableFloatStateOf(1f) }
    var pan by remember { mutableStateOf(Offset.Zero) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(zoom > 1.01f) { onZoomed(zoom > 1.01f) }
    val transform = rememberTransformableState { z, p, _ ->
        zoom = (zoom * z).coerceIn(1f, 6f)
        pan = if (zoom == 1f) Offset.Zero else pan + p
    }
    val motion = MaterialTheme.motionScheme
    Box(
        Modifier.fillMaxSize()
            .pointerInput(Unit) {
                // Double tap zooms 2.5x around the spot you tapped, as on the web, and back out again.
                detectTapGestures(onTap = { onTap() }, onDoubleTap = { at ->
                    val c = Offset(size.width / 2f, size.height / 2f)
                    val toZoom = if (zoom > 1f) 1f else 2.5f
                    val toPan = if (toZoom == 1f) Offset.Zero else (c - at) * (toZoom - 1f)
                    scope.launch {
                        val z0 = zoom; val p0 = pan
                        animate(0f, 1f, animationSpec = motion.defaultSpatialSpec()) { t, _ ->
                            zoom = (z0 + (toZoom - z0) * t).coerceAtLeast(1f); pan = p0 + (toPan - p0) * t
                        }
                    }
                })
            }
            .transformable(transform, canPan = { zoom > 1f }),
        contentAlignment = Alignment.Center,
    ) {
        val shown = original.value ?: preview.value
        if (shown == null) {
            // A quiet frame of the photo's own shape until its small picture is here; no spinner.
            Box(Modifier.aspectRatio(Photos.ratioOf(media)).background(Color.White.copy(alpha = 0.08f)))
        } else {
            // Sized to the photo itself, so rounding its corners rounds the picture and not the screen.
            Image(
                shown.asImageBitmap(), contentDescription = null, contentScale = ContentScale.Fit,
                modifier = Modifier.aspectRatio(shown.width.toFloat() / shown.height.coerceAtLeast(1))
                    .graphicsLayer {
                        scaleX = zoom; scaleY = zoom; translationX = pan.x; translationY = pan.y
                        shape = RoundedCornerShape(cornerPx()); clip = true
                    }
                    .onGloballyPositioned { onShown(shown, it) },
            )
        }
    }
}


private val Kinds = listOf("heart" to "❤️", "laugh" to "😂", "wow" to "😮", "love" to "😍", "clap" to "👏")
private fun emojiOf(kind: String) = Kinds.firstOrNull { it.first == kind }?.second ?: "❤️"

/** Your own pick changed on one photo: the counts follow, so the bar is right before the server answers. */
private fun withMine(r: Remote.Reactions, target: String, kind: String?): Remote.Reactions {
    val old = r.mine[target]
    val counts = r.counts[target].orEmpty().associate { it }.toMutableMap()
    if (old != null) counts[old] = (counts[old] ?: 1) - 1
    if (kind != null) counts[kind] = (counts[kind] ?: 0) + 1
    val list = counts.filterValues { it > 0 }.toList().sortedByDescending { it.second }
    val mine = r.mine.toMutableMap().apply { if (kind == null) remove(target) else put(target, kind) }
    return r.copy(counts = r.counts + (target to list), mine = mine)
}

/**
 * Your reaction with what people gave, and the comments. A tap opens the five reactions, as on the web;
 * the one you pick pops and lifts, and the button takes it over with a bounce. Your own pick again takes it back.
 */
@Composable
private fun SocialBar(
    mine: String?, counts: List<Pair<String, Int>>, names: List<Pair<String, String>>, comments: Int, enabled: Boolean,
    onReact: (String?) -> Unit, onComments: () -> Unit, picking: Boolean, onPicking: (Boolean) -> Unit,
) {
    val motion = MaterialTheme.motionScheme
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    // The one just picked, held while it lifts and the row folds away.
    var picked by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(picking) { if (picking) picked = null }
    Column {
        AnimatedVisibility(
            picking,
            enter = scaleIn(motion.fastSpatialSpec(), initialScale = 0.6f, transformOrigin = TransformOrigin(0f, 1f)) + fadeIn(motion.fastEffectsSpec()),
            exit = scaleOut(motion.fastSpatialSpec(), targetScale = 0.6f, transformOrigin = TransformOrigin(0f, 1f)) + fadeOut(motion.fastEffectsSpec()),
        ) {
            Column(Modifier.padding(bottom = 10.dp)) {
                // Who gave what, when the server says.
                if (names.isNotEmpty()) Text(
                    names.joinToString("  ·  ") { (k, n) -> "${emojiOf(k)} $n" }, maxLines = 2, overflow = TextOverflow.Ellipsis,
                    style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, lineHeight = 18.sp, color = Color.White.copy(alpha = 0.9f)),
                    modifier = Modifier.padding(start = 6.dp, bottom = 8.dp),
                )
                Row(
                    Modifier.clip(CircleShape).background(Color(0xFF2A2A2A).copy(alpha = 0.92f)).padding(horizontal = 6.dp, vertical = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Kinds.forEachIndexed { i, (kind, emoji) ->
                        ReactionChoice(
                            emoji, index = i, on = (picked ?: mine) == kind, dimmed = picked != null && picked != kind,
                            onPick = {
                                haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                                val again = mine == kind
                                picked = if (again) "" else kind
                                onReact(if (again) null else kind)
                                scope.launch { delay(340); onPicking(false) }
                            },
                        )
                    }
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            val total = counts.sumOf { it.second }
            // The button's emoji pops in with a bounce each time your pick changes.
            val pop = remember { Animatable(1f) }
            var lastMine by remember { mutableStateOf(mine) }
            LaunchedEffect(mine) {
                if (mine != lastMine) {
                    lastMine = mine
                    pop.snapTo(0.4f)
                    pop.animateTo(1f, motion.fastSpatialSpec())
                }
            }
            var pressed by remember { mutableStateOf(false) }
            val press by animateFloatAsState(if (pressed) 0.94f else 1f, motion.fastSpatialSpec(), label = "press")
            Row(
                Modifier.height(48.dp).graphicsLayer { scaleX = press; scaleY = press }.clip(CircleShape)
                    .background(if (mine != null || picking) Color.White.copy(alpha = 0.28f) else Color.White.copy(alpha = 0.18f))
                    .pointerInput(enabled) {
                        if (enabled) detectTapGestures(
                            onPress = { pressed = true; tryAwaitRelease(); pressed = false },
                            onTap = { haptics.performHapticFeedback(HapticFeedbackType.ContextClick); onPicking(!picking) },
                        )
                    }
                    .padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.size(24.dp).graphicsLayer { scaleX = pop.value; scaleY = pop.value }, contentAlignment = Alignment.Center) {
                    if (mine != null) Text(emojiOf(mine), fontSize = 20.sp)
                    else LineIcon(Glyphs.heart, Color.White, size = 22.dp, stroke = 2f)
                }
                // The others' picks as a small stack, then how many.
                counts.filter { it.first != mine }.take(3).forEach { (kind, _) -> Text(emojiOf(kind), fontSize = 16.sp, modifier = Modifier.padding(start = 4.dp)) }
                if (total > 0) Text("$total", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 16.sp, color = Color.White), modifier = Modifier.padding(start = 8.dp))
            }
            Spacer(Modifier.size(8.dp))
            Row(
                Modifier.height(48.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.18f))
                    .pointerInput(enabled) { if (enabled) detectTapGestures { haptics.performHapticFeedback(HapticFeedbackType.ContextClick); onComments() } }
                    .padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                LineIcon(Glyphs.comment, Color.White, size = 21.dp, stroke = 2f)
                Text(
                    if (comments == 0) "Reageer" else "$comments",
                    style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 16.sp, color = Color.White),
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
        }
    }
}

/** One of the five: pops in after its left neighbour, shrinks under the finger, and lifts when it is yours. */
@Composable
private fun ReactionChoice(emoji: String, index: Int, on: Boolean, dimmed: Boolean, onPick: () -> Unit) {
    val motion = MaterialTheme.motionScheme
    val enter = remember { Animatable(0.3f) }
    LaunchedEffect(Unit) { delay(index * 35L); enter.animateTo(1f, motion.fastSpatialSpec()) }
    var pressed by remember { mutableStateOf(false) }
    val press by animateFloatAsState(if (pressed) 0.82f else 1f, motion.fastSpatialSpec(), label = "press")
    val lift by animateFloatAsState(if (on) 1f else 0f, motion.fastSpatialSpec(), label = "lift")
    val fade by animateFloatAsState(if (dimmed) 0.45f else 1f, motion.fastEffectsSpec(), label = "dim")
    Box(
        Modifier.size(48.dp)
            .graphicsLayer {
                val s = enter.value * press * (1f + 0.3f * lift)
                scaleX = s; scaleY = s
                translationY = -10.dp.toPx() * lift
                alpha = fade * enter.value.coerceIn(0f, 1f)
            }
            .clip(CircleShape).background(Color.White.copy(alpha = 0.22f * lift))
            .pointerInput(Unit) { detectTapGestures(onPress = { pressed = true; tryAwaitRelease(); pressed = false }, onTap = { onPick() }) },
        contentAlignment = Alignment.Center,
    ) { Text(emoji, fontSize = 26.sp) }
}

/** A film's controls under it: play and pause, how far (drag to scrub), how long, and the sound. */
@Composable
private fun VideoControls(handle: VideoHandle?, modifier: Modifier = Modifier) {
    val ready = handle?.ready == true
    // Where the film is, read every frame while it plays (it draws every frame then anyway); paused, nothing runs.
    if (handle != null && ready && handle.playing) LaunchedEffect(handle) {
        while (true) { withFrameMillis { }; handle.view?.let { v -> runCatching { handle.position = v.currentPosition } } }
    }
    var scrub by remember { mutableStateOf<Float?>(null) }
    val total = (handle?.duration ?: 0).coerceAtLeast(0)
    val at = scrub?.let { (it * total).toInt() } ?: (handle?.position ?: 0)
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        RoundButton(onClick = {
            val h = handle ?: return@RoundButton
            h.playing = !h.playing
            if (h.playing) h.view?.start() else h.view?.pause()
        }, size = 44.dp) {
            if (handle?.playing != false) LineIcon(listOf(P("M8 5.5h2.8v13H8Z"), P("M13.2 5.5H16v13h-2.8Z")), Color.White, size = 22.dp, filled = true)
            else LineIcon(listOf(P("M8.5 5.5v13l10-6.5Z")), Color.White, size = 22.dp, filled = true)
        }
        val time = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 13.sp, color = Color.White, fontFeatureSettings = "tnum")
        Text(clock(at), style = time, modifier = Modifier.padding(start = 12.dp))
        Slider(
            value = if (total > 0) (at.toFloat() / total).coerceIn(0f, 1f) else 0f,
            onValueChange = { v -> scrub = v; handle?.view?.seekTo((v * total).toInt()) },
            onValueChangeFinished = { scrub?.let { v -> handle?.position = (v * total).toInt() }; scrub = null },
            enabled = ready && total > 0,
            colors = SliderDefaults.colors(
                thumbColor = Color.White, activeTrackColor = Color.White, inactiveTrackColor = Color.White.copy(alpha = 0.3f),
                disabledThumbColor = Color.White.copy(alpha = 0.5f), disabledActiveTrackColor = Color.White.copy(alpha = 0.5f), disabledInactiveTrackColor = Color.White.copy(alpha = 0.2f),
            ),
            modifier = Modifier.weight(1f).padding(horizontal = 10.dp),
        )
        Text(clock(total), style = time.copy(color = Color.White.copy(alpha = 0.78f)), modifier = Modifier.padding(end = 12.dp))
        RoundButton(onClick = { handle?.let { it.mute(!it.muted) } }, size = 44.dp) {
            val speaker = P("M4.5 9.5h3l4.5-3.8v12.6L7.5 14.5h-3Z")
            if (handle?.muted == true) LineIcon(listOf(speaker, P("m16 9.5 5 5"), P("m21 9.5-5 5")), Color.White, size = 22.dp, stroke = 2f)
            else LineIcon(listOf(speaker, P("M15.5 9.2a4 4 0 0 1 0 5.6"), P("M18.2 6.6a7.6 7.6 0 0 1 0 10.8")), Color.White, size = 22.dp, stroke = 2f)
        }
    }
}

private fun clock(ms: Int): String {
    val s = (ms / 1000).coerceAtLeast(0)
    return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
}

private fun ago(at: java.time.Instant): String {
    val s = java.time.Duration.between(at, java.time.Instant.now()).seconds
    return when {
        s < 60 -> "zojuist"
        s < 3600 -> "${s / 60} min"
        s < 86400 -> "${s / 3600} u"
        s < 7 * 86400 -> "${s / 86400} d"
        else -> java.time.format.DateTimeFormatter.ofPattern("d MMM", Locale.forLanguageTag("nl-NL")).withZone(java.time.ZoneId.systemDefault()).format(at)
    }
}

/** The comments on one photo in a sheet, a field to add one at the bottom that stays above the keyboard. */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun CommentsSheet(comments: List<Remote.Comment>, onDismiss: () -> Unit, onSend: (String) -> Unit, onDelete: (Remote.Comment) -> Unit) {
    val cs = MaterialTheme.colorScheme
    var text by remember { mutableStateOf("") }
    androidx.compose.material3.ModalBottomSheet(onDismissRequest = onDismiss, modifier = Modifier.statusBarsPadding(), sheetState = androidx.compose.material3.rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = cs.surfaceContainerLow) {
        Column(Modifier.fillMaxWidth().imePadding().padding(horizontal = 16.dp)) {
            Text("Reacties", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 22.sp, color = cs.onSurface), modifier = Modifier.padding(bottom = 12.dp))
            if (comments.isEmpty()) {
                Text("Nog niemand heeft gereageerd. Wees de eerste.", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 14.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(bottom = 16.dp))
            }
            Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()), verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(3.dp)) {
                comments.forEachIndexed { i, c ->
                    val shape = RoundedCornerShape(
                        topStart = if (i == 0) 22.dp else 6.dp, topEnd = if (i == 0) 22.dp else 6.dp,
                        bottomStart = if (i == comments.lastIndex) 22.dp else 6.dp, bottomEnd = if (i == comments.lastIndex) 22.dp else 6.dp,
                    )
                    Row(Modifier.fillMaxWidth().clip(shape).background(cs.surfaceContainerHigh).padding(12.dp)) {
                        Box(Modifier.size(36.dp).clip(CircleShape).background(cs.primaryContainer), contentAlignment = Alignment.Center) {
                            Text(c.author.take(1).uppercase(), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 15.sp, color = cs.onPrimaryContainer))
                        }
                        Column(Modifier.weight(1f).padding(start = 12.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(c.author, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = cs.onSurface))
                                Text("  ${ago(c.at)}", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 12.5.sp, color = cs.onSurfaceVariant))
                            }
                            Text(c.body, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(450), fontSize = 15.sp, lineHeight = 21.sp, color = cs.onSurface), modifier = Modifier.padding(top = 2.dp))
                        }
                        if (c.canDelete) {
                            Box(Modifier.size(36.dp).clip(CircleShape).pointerInput(c.id) { detectTapGestures { onDelete(c) } }, contentAlignment = Alignment.Center) {
                                LineIcon(Glyphs.trash, cs.onSurfaceVariant, size = 18.dp)
                            }
                        }
                    }
                }
            }
            Row(Modifier.padding(top = 14.dp, bottom = 16.dp).fillMaxWidth().height(52.dp).clip(CircleShape).background(cs.surfaceContainerHighest).padding(start = 18.dp, end = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) {
                    if (text.isEmpty()) Text("Schrijf een reactie", style = TextStyle(fontFamily = Inter, fontSize = 15.sp, color = cs.onSurfaceVariant))
                    androidx.compose.foundation.text.BasicTextField(
                        text, { text = it.take(1000) },
                        textStyle = TextStyle(fontFamily = Inter, fontSize = 15.sp, color = cs.onSurface),
                        cursorBrush = androidx.compose.ui.graphics.SolidColor(cs.primary),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                val ready = text.isNotBlank()
                Box(
                    Modifier.size(42.dp).clip(CircleShape).background(if (ready) cs.primary else Color.Transparent)
                        .pointerInput(ready, text) { if (ready) detectTapGestures { onSend(text.trim()); text = "" } },
                    contentAlignment = Alignment.Center,
                ) { LineIcon(Glyphs.send, if (ready) cs.onPrimary else cs.onSurfaceVariant, size = 20.dp, stroke = 2f) }
            }
        }
    }
}



/**
 * A video plays where the photo would be: the still first (the tile's own picture), then the film, looping
 * while its page is the one on show; a tap shows or hides the bars and its controls.
 */
@Composable
private fun ViewerVideo(
    media: Media, handle: VideoHandle, active: Boolean, seed: Bitmap?, onTap: () -> Unit,
    cornerPx: Density.() -> Float, onShown: (Bitmap, LayoutCoordinates) -> Unit,
) {
    val url = remember(media.id) { mutableStateOf<String?>(null) }
    val activeNow by rememberUpdatedState(active)
    LaunchedEffect(media.id) { url.value = runCatching { Remote.videoUrl(media.id) }.getOrNull() }
    // Only the film on show plays (and sounds); the ones beside it wait at their start.
    LaunchedEffect(active, handle.ready) {
        val v = handle.view ?: return@LaunchedEffect
        if (active && handle.playing) v.start() else v.pause()
    }
    Box(Modifier.fillMaxSize().pointerInput(Unit) { detectTapGestures(onTap = { onTap() }) }, contentAlignment = Alignment.Center) {
        val still = remember(media.id) { Photos.cached("${media.id}/preview") ?: seed ?: Photos.cached("${media.id}/thumbnail") }
        Box(
            Modifier.aspectRatio(Photos.ratioOf(media))
                .graphicsLayer { shape = RoundedCornerShape(cornerPx()); clip = true }
                .onGloballyPositioned { c -> still?.let { onShown(it, c) } },
        ) {
            url.value?.let { address ->
                androidx.compose.ui.viewinterop.AndroidView(
                    factory = { ctx ->
                        android.widget.VideoView(ctx).apply {
                            handle.view = this
                            setVideoURI(android.net.Uri.parse(address))
                            setOnPreparedListener { mp ->
                                mp.isLooping = true
                                handle.player = mp
                                handle.duration = mp.duration
                                handle.mute(handle.muted)
                                handle.ready = true
                                if (activeNow && handle.playing) start() else { seekTo(1); pause() }
                            }
                        }
                    },
                    onRelease = { it.stopPlayback(); handle.view = null; handle.player = null; handle.ready = false },
                    modifier = Modifier.fillMaxSize(),
                )
            }
            val stillAlpha by animateFloatAsState(if (handle.ready) 0f else 1f, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "still")
            if (still != null) Image(still.asImageBitmap(), null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize().graphicsLayer { alpha = stillAlpha })
            if (!handle.ready) LoadingIndicator(Modifier.align(Alignment.Center).size(48.dp), color = Color.White)
        }
    }
}
