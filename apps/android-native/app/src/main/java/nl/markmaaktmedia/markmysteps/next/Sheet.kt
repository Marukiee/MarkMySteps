package nl.markmaaktmedia.markmysteps.next

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/** What a sheet's content can do: close the sheet the same way a swipe or back does. */
interface AppSheetScope : ColumnScope {
    fun close()
}

/**
 * The motion of PixelPlayer's Connect device panel, exactly: the expressive scheme, but closing with a calm
 * 380 ms slide instead of the quick effects motion (made for small fades, it made the whole sheet jump away).
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
private object PanelMotion : MotionScheme by MotionScheme.expressive() {
    override fun <T> fastEffectsSpec(): androidx.compose.animation.core.FiniteAnimationSpec<T> =
        androidx.compose.animation.core.tween(380, easing = androidx.compose.animation.core.FastOutSlowInEasing)
}

/**
 * The one bottom sheet of the whole app: Material's own sheet with the motion of PixelPlayer's Connect device
 * panel, so it goes up and down exactly as that one does. Dragging, throwing it down, a tap beside it and the
 * back gesture are Material's own. It opens fully at once, so one back closes it.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun AppSheet(onDismiss: () -> Unit, content: @Composable AppSheetScope.() -> Unit) {
    val cs = MaterialTheme.colorScheme
    MaterialTheme(colorScheme = cs, typography = MaterialTheme.typography, shapes = MaterialTheme.shapes, motionScheme = PanelMotion) {
        val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        val scope = rememberCoroutineScope()
        var closing by remember { mutableStateOf(false) }
        // Closing from inside (a choice made) slides it away the same way a swipe does, then it is gone.
        val close: () -> Unit = {
            if (!closing) {
                closing = true
                scope.launch { state.hide() }.invokeOnCompletion { onDismiss() }
            }
        }
        ModalBottomSheet(
            onDismissRequest = onDismiss,
            sheetState = state,
            shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
            containerColor = cs.surfaceContainerLow,
            tonalElevation = 0.dp,
        ) {
            Column(Modifier.imePadding()) {
                val inner = this
                val sheetScope = remember(inner) {
                    object : AppSheetScope, ColumnScope by inner {
                        override fun close() = close()
                    }
                }
                sheetScope.content()
            }
        }
    }
}
