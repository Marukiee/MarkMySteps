package nl.markmaaktmedia.markmysteps.next

import androidx.activity.compose.PredictiveBackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.launch

private val EmphasizedDecelerate = CubicBezierEasing(0.05f, 0.7f, 0.1f, 1f)
private val EmphasizedAccelerate = CubicBezierEasing(0.3f, 0f, 0.8f, 0.15f)
private val Emphasized = CubicBezierEasing(0.2f, 0f, 0f, 1f)

/** What a sheet's content can do: close the sheet the same calm way a swipe or back does. */
interface AppSheetScope : ColumnScope {
    fun close()
}

/**
 * The one bottom sheet of the whole app, drawn by the app itself so every way out moves the same way and at
 * the same calm pace (the material sheet left a tap outside or a swipe far too quick):
 *  - it rises in over 400 ms and leaves over 300 ms on the emphasized curves;
 *  - the back gesture moves it down with the finger, a little smaller, so near the end it is nearly gone;
 *    letting go finishes the way out, pulling back brings it home;
 *  - dragging it down (from the handle, or from the content once that is at its top) moves it, and letting
 *    go past a quarter of its height or with a quick flick closes it;
 *  - a tap on the dimmed page above closes it.
 * It opens fully at once, so one back closes it.
 */
@Composable
fun AppSheet(onDismiss: () -> Unit, content: @Composable AppSheetScope.() -> Unit) {
    val cs = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    // 0 = in place, 1 = fully down out of sight.
    val down = remember { Animatable(1f) }
    var back by remember { mutableFloatStateOf(0f) }
    var height by remember { mutableFloatStateOf(1f) }
    var closing by remember { mutableStateOf(false) }
    // In: under 0.4 s on the emphasized decelerate curve, so it is moving at once and settles calmly at the
    // top (a spring from standstill got going too slowly).
    LaunchedEffect(Unit) { down.animateTo(0f, tween(380, easing = EmphasizedDecelerate)) }
    // Out: thrown hard it leaves at the speed of the throw; let go slowly (or by back or a tap) it glides out.
    fun closeAt(velocity: Float) {
        if (closing) return
        closing = true
        scope.launch {
            val left = (1f - down.value) * height
            val ms = if (velocity > 400f) (left / velocity * 1000f * 1.15f).toInt().coerceIn(90, 300)
            else (320 * (1f - down.value)).toInt().coerceAtLeast(180)
            val easing = if (velocity > 400f) androidx.compose.animation.core.LinearOutSlowInEasing else EmphasizedAccelerate
            down.animateTo(1f, tween(ms, easing = easing))
            onDismiss()
        }
    }
    val close: () -> Unit = { closeAt(0f) }
    fun settle(velocity: Float) {
        if (down.value > 0.3f || velocity > 1200f) closeAt(velocity)
        else scope.launch { down.animateTo(0f, androidx.compose.animation.core.spring(dampingRatio = 1f, stiffness = 600f), initialVelocity = velocity / height) }
    }
    val nested = remember {
        object : NestedScrollConnection {
            // Pulling the sheet back up first, before the content scrolls.
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                if (available.y < 0 && down.value > 0f && source == NestedScrollSource.UserInput) {
                    val next = (down.value + available.y / height).coerceIn(0f, 1f)
                    scope.launch { down.snapTo(next) }
                    return Offset(0f, available.y)
                }
                return Offset.Zero
            }
            // Pulling down once the content is at its top moves the sheet.
            override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
                if (available.y > 0 && source == NestedScrollSource.UserInput) {
                    val next = (down.value + available.y / height).coerceIn(0f, 1f)
                    scope.launch { down.snapTo(next) }
                    return Offset(0f, available.y)
                }
                return Offset.Zero
            }
            override suspend fun onPreFling(available: Velocity): Velocity {
                if (down.value > 0f) { settle(available.y); return available }
                return Velocity.Zero
            }
        }
    }
    Dialog(onDismissRequest = close, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        PredictiveBackHandler { events ->
            try {
                // Follows the finger on the emphasized curve: quick at first, then calmer, nearly gone at the end.
                events.collect { e -> back = e.progress; down.snapTo(Emphasized.transform(e.progress) * 0.85f) }
                back = 0f
                close()
            } catch (e: kotlin.coroutines.cancellation.CancellationException) {
                back = 0f
                scope.launch { down.animateTo(0f, tween(260, easing = Emphasized)) }
                throw e
            }
        }
        Box(Modifier.fillMaxSize()) {
            // The page above, dimmed, fading with the sheet; a tap on it closes the sheet.
            Box(
                Modifier.fillMaxSize().graphicsLayer { alpha = 1f - down.value }.background(Color.Black.copy(alpha = 0.32f))
                    .clickable(remember { MutableInteractionSource() }, indication = null) { close() },
            )
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().statusBarsPadding().padding(top = 24.dp)
                    .onSizeChanged { height = it.height.toFloat().coerceAtLeast(1f) }
                    .graphicsLayer {
                        translationY = size.height * down.value
                        val s = 1f - 0.06f * back
                        scaleX = s; scaleY = s
                        transformOrigin = TransformOrigin(0.5f, 1f)
                    }
                    .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                    .background(cs.surfaceContainerLow)
                    .clickable(remember { MutableInteractionSource() }, indication = null) {}
                    .nestedScroll(nested),
            ) {
                // The handle: a drag here always moves the sheet.
                Box(
                    Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 12.dp)
                        .draggable(
                            rememberDraggableState { dy -> scope.launch { down.snapTo((down.value + dy / height).coerceIn(0f, 1f)) } },
                            Orientation.Vertical,
                            onDragStopped = { v -> settle(v) },
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Box(Modifier.size(width = 36.dp, height = 4.dp).clip(CircleShape).background(cs.onSurfaceVariant.copy(alpha = 0.4f)))
                }
                Column(Modifier.imePadding()) {
                    val inner = this
                    val sheetScope = remember(inner) {
                        object : AppSheetScope, ColumnScope by inner {
                            override fun close() = close()
                        }
                    }
                    sheetScope.content()
                }
                Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
            }
        }
    }
}
