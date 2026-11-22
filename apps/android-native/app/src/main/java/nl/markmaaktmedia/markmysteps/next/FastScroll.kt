package nl.markmaaktmedia.markmysteps.next

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import java.time.LocalDate
import kotlin.math.roundToInt

/** Where each day of the timeline starts on screen, and its place, for the grip's bubble. */
class TimelineMarks {
    private val days = HashMap<LocalDate, Pair<LayoutCoordinates, String?>>()
    fun put(day: LocalDate, at: LayoutCoordinates, place: String?) { days[day] = at to place }
    fun clear() = days.clear()

    /** The day whose heading last passed [line] (a y on screen), with its place. */
    fun dayAt(line: Float): Pair<LocalDate, String?>? =
        days.entries.filter { it.value.first.isAttached && it.value.first.boundsInRoot().top <= line }.maxByOrNull { it.key }?.let { it.key to it.value.second }
            ?: days.entries.filter { it.value.first.isAttached }.minByOrNull { it.key }?.let { it.key to it.value.second }
}

/** Below this the list is short enough to scroll by hand (web: 2.5 screens). */
private const val MIN_RATIO = 2.5f
/** How long the grip stays after the last movement. */
private const val IDLE_MS = 1500L

/**
 * A grip on the right edge to throw a long timeline down with, as a photo library does: it wakes while the
 * page scrolls and goes to sleep after a moment of rest. Dragging it moves the whole page at once, and a
 * bubble beside it says which day and place you are passing, so you can aim instead of scroll and check.
 * It only offers itself once the map has scrolled away and the list is long enough to need it.
 */
@Composable
fun FastScroll(scroll: ScrollState, marks: TimelineMarks, enabled: Boolean, topInset: androidx.compose.ui.unit.Dp, bottomInset: androidx.compose.ui.unit.Dp, modifier: Modifier = Modifier) {
    val cs = MaterialTheme.colorScheme
    val motion = MaterialTheme.motionScheme
    val density = LocalDensity.current
    val haptics = rememberHaptics()
    var dragging by remember { mutableStateOf(false) }
    var awake by remember { mutableStateOf(false) }
    var label by remember { mutableStateOf<Pair<LocalDate, String?>?>(null) }
    var boxTop by remember { mutableFloatStateOf(0f) }
    BoxWithConstraints(modifier.fillMaxSize().onGloballyPositioned { boxTop = it.positionInRoot().y }) {
        val viewport = constraints.maxHeight.toFloat()
        val long = scroll.maxValue > viewport * (MIN_RATIO - 1f)
        val size = with(density) { 46.dp.toPx() }
        val top = with(density) { topInset.toPx() }
        val track = (viewport - top - with(density) { bottomInset.toPx() } - size).coerceAtLeast(1f)
        // Awake while the page moves, asleep after a moment of rest; never while the finger holds it.
        LaunchedEffect(scroll.value, dragging) {
            if (dragging) { awake = true; return@LaunchedEffect }
            if (scroll.isScrollInProgress) awake = true
            delay(IDLE_MS)
            if (!dragging) awake = false
        }
        val fraction = if (scroll.maxValue > 0) scroll.value / scroll.maxValue.toFloat() else 0f
        val y = top + fraction * track
        AnimatedVisibility(
            enabled && long && (awake || dragging),
            modifier = Modifier.offset { IntOffset(0, y.roundToInt()) }.align(Alignment.TopEnd),
            enter = fadeIn(tween(200)) + slideInHorizontally(motion.fastSpatialSpec()) { with(density) { 10.dp.roundToPx() } },
            exit = fadeOut(tween(220)) + slideOutHorizontally(motion.fastSpatialSpec()) { with(density) { 14.dp.roundToPx() } },
        ) {
            Row(Modifier.padding(end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                // The day you are passing, beside the grip where your thumb is not; the place is what you look for.
                AnimatedVisibility(
                    dragging && label != null,
                    enter = fadeIn(tween(160)) + scaleIn(motion.fastSpatialSpec(), initialScale = 0.85f, transformOrigin = androidx.compose.ui.graphics.TransformOrigin(1f, 0.5f)),
                    exit = fadeOut(tween(140)) + scaleOut(motion.fastSpatialSpec(), targetScale = 0.9f, transformOrigin = androidx.compose.ui.graphics.TransformOrigin(1f, 0.5f)),
                ) {
                    val shown = label
                    Column(
                        Modifier.padding(end = 10.dp).clip(RoundedCornerShape(18.dp)).background(cs.primaryContainer).padding(horizontal = 14.dp, vertical = 8.dp),
                        horizontalAlignment = Alignment.End,
                    ) {
                        if (shown != null) {
                            Text(shortDay(shown.first), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 16.sp, color = cs.onPrimaryContainer))
                            shown.second?.let { Text(it, maxLines = 1, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 12.5.sp, color = cs.onPrimaryContainer.copy(alpha = 0.8f))) }
                        }
                    }
                }
                val grow by animateFloatAsState(if (dragging) 1.08f else 1f, motion.fastSpatialSpec(), label = "grow")
                val edge by animateColorAsState(if (dragging) cs.primary else cs.outlineVariant, motion.defaultEffectsSpec(), label = "edge")
                val ink by animateColorAsState(if (dragging) cs.primary else cs.onSurfaceVariant, motion.defaultEffectsSpec(), label = "ink")
                Box(
                    Modifier.size(46.dp).graphicsLayer { scaleX = grow; scaleY = grow }
                        .clip(CircleShape).background(cs.surfaceContainerHighest).border(1.5.dp, edge, CircleShape)
                        .pointerInput(scroll.maxValue, track) {
                            fun moveTo(fingerY: Float) {
                                // The finger is on the grip's middle: where it is on the track sets where the page is.
                                val f = ((fingerY - top - size / 2f) / track).coerceIn(0f, 1f)
                                scroll.dispatchRawDelta(f * scroll.maxValue - scroll.value)
                                val now = marks.dayAt(boxTop + top + with(density) { 40.dp.toPx() })
                                if (now?.first != label?.first) { if (label != null) haptics(Haptic.DragTick); label = now }
                            }
                            // Read live: the grip moves with the page, and this block is not restarted for that.
                            // The finger's place on the track, followed by its own movement rather than read off a grip that moves under it.
                            var finger = 0f
                            fun gripTop() = top + (scroll.value / scroll.maxValue.toFloat().coerceAtLeast(1f)) * track
                            detectVerticalDragGestures(
                                onDragStart = { _ -> dragging = true; haptics(Haptic.LongPress); finger = gripTop() + size / 2f; moveTo(finger) },
                                onDragEnd = { dragging = false; label = null },
                                onDragCancel = { dragging = false; label = null },
                                onVerticalDrag = { change, dy -> change.consume(); finger += dy; moveTo(finger) },
                            )
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        LineIcon(listOf(P("m7 14 5-5 5 5")), ink, size = 15.dp, stroke = 2.2f, modifier = Modifier.offset(y = 3.dp))
                        LineIcon(listOf(P("m7 10 5 5 5-5")), ink, size = 15.dp, stroke = 2.2f, modifier = Modifier.offset(y = (-3).dp))
                    }
                }
            }
        }
    }
}
