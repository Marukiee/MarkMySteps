package nl.markmaaktmedia.markmysteps.next

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp

/**
 * Keeps a field well clear of the keyboard. On its own, a focused field only scrolls until its edge touches the keyboard (the
 * search in Mensen en delen sat half behind it). Once the keyboard has finished coming up, this scrolls the page or panel so the field
 * stands above it with [room] to spare under it: some air for a plain field, the first suggestions for a search.
 *
 * Put it on the field's box (the rounded row), so the whole box counts, not only the line of text in it.
 */
@OptIn(ExperimentalFoundationApi::class)
fun Modifier.clearOfKeyboard(room: Dp = 24.dp): Modifier = composed {
    val requester = remember { BringIntoViewRequester() }
    var focused by remember { mutableStateOf(false) }
    var size by remember { mutableStateOf(IntSize.Zero) }
    val density = LocalDensity.current
    val keyboard = WindowInsets.ime.getBottom(density)
    LaunchedEffect(focused, keyboard) {
        if (!focused || keyboard == 0) return@LaunchedEffect
        // Waits for the keyboard to stand still: every frame of its animation restarts this.
        kotlinx.coroutines.delay(90)
        val extra = with(density) { room.toPx() }
        requester.bringIntoView(Rect(0f, 0f, size.width.toFloat(), size.height + extra))
    }
    this.bringIntoViewRequester(requester).onSizeChanged { size = it }.onFocusChanged { focused = it.hasFocus }
}
