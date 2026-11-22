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
 * The one bottom sheet of the whole app: Material's own sheet, exactly as PixelPlayer's panels (the Connect
 * device panel), so it has the very same physics. Opening, dragging, throwing it down, a tap beside it and the
 * back gesture are all Material's own. It runs on the standard motion scheme, as PixelPlayer does: the rest of
 * this app uses the expressive one, whose springs are bouncier. It opens fully at once, so one back closes it.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun AppSheet(onDismiss: () -> Unit, content: @Composable AppSheetScope.() -> Unit) {
    val cs = MaterialTheme.colorScheme
    MaterialTheme(colorScheme = cs, typography = MaterialTheme.typography, shapes = MaterialTheme.shapes, motionScheme = MotionScheme.standard()) {
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
