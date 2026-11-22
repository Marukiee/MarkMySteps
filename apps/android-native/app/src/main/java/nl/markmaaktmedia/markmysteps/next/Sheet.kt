package nl.markmaaktmedia.markmysteps.next

import androidx.activity.compose.PredictiveBackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

private val Emphasized = CubicBezierEasing(0.2f, 0f, 0f, 1f)

/**
 * The one bottom sheet of the whole app. It opens fully at once (one back closes it), and the back gesture
 * works as on a page: the sheet follows the finger down and shrinks a little, so near the end of the gesture
 * it is nearly gone and the page shows through; letting go finishes the way out at the same pace, pulling
 * back brings it home. The material sheet only shrank a little and then vanished in one step.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppSheet(onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    val cs = MaterialTheme.colorScheme
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val back = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        modifier = Modifier.statusBarsPadding(),
        sheetState = state,
        // The sheet's own surface is drawn below, so it can move with the back gesture.
        containerColor = Color.Transparent,
        tonalElevation = 0.dp,
        dragHandle = null,
        // The insets are padded inside the sheet's own surface, so its colour runs down behind the gesture bar.
        contentWindowInsets = { androidx.compose.foundation.layout.WindowInsets(0, 0, 0, 0) },
        scrimColor = BottomSheetDefaults.ScrimColor.copy(alpha = BottomSheetDefaults.ScrimColor.alpha * (1f - back.value)),
    ) {
        PredictiveBackHandler { events ->
            try {
                events.collect { e -> back.snapTo(e.progress) }
                back.animateTo(1f, tween((300 * (1f - back.value)).toInt().coerceAtLeast(120), easing = Emphasized))
                onDismiss()
            } catch (e: kotlin.coroutines.cancellation.CancellationException) {
                scope.launch { back.animateTo(0f, tween(250, easing = Emphasized)) }
                throw e
            }
        }
        Column(
            Modifier.fillMaxWidth()
                .graphicsLayer {
                    val k = back.value
                    // Down most of its height with the finger, a little smaller, fading only at the very end.
                    translationY = size.height * 0.92f * Emphasized.transform(k)
                    val s = 1f - 0.06f * k
                    scaleX = s; scaleY = s
                    transformOrigin = TransformOrigin(0.5f, 1f)
                    alpha = 1f - ((k - 0.75f) / 0.25f).coerceIn(0f, 1f)
                }
                .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                .background(cs.surfaceContainerLow),
        ) {
            Box(Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 12.dp), contentAlignment = Alignment.Center) {
                Box(Modifier.size(width = 36.dp, height = 4.dp).clip(CircleShape).background(cs.onSurfaceVariant.copy(alpha = 0.4f)))
            }
            Column(Modifier.imePadding()) { content() }
            androidx.compose.foundation.layout.Spacer(Modifier.windowInsetsBottomHeight(androidx.compose.foundation.layout.WindowInsets.navigationBars))
        }
    }
}
