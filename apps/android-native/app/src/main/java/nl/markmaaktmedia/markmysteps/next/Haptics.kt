package nl.markmaaktmedia.markmysteps.next

import android.view.View
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalView
import androidx.core.view.HapticFeedbackConstantsCompat
import androidx.core.view.ViewCompat

/**
 * The small felt details of the app, one name per moment, so the same kind of moment always feels the same.
 * Through the view's own haptics: they follow the phone's touch feedback setting, and core falls back to an
 * older constant where a phone does not know a newer one (toggles and segment ticks came in Android 14).
 * Sparingly: one per gesture, never on every frame of a scroll or drag.
 */
enum class Haptic(val constant: Int) {
    /** A light tick under the finger: a card or button that opens something, a menu opening. */
    Tap(HapticFeedbackConstantsCompat.CONTEXT_CLICK),
    /** A switch turned on. */
    ToggleOn(HapticFeedbackConstantsCompat.TOGGLE_ON),
    /** A switch turned off. */
    ToggleOff(HapticFeedbackConstantsCompat.TOGGLE_OFF),
    /** Another choice in a row of choices, another tab, another trip picked. */
    Tick(HapticFeedbackConstantsCompat.SEGMENT_TICK),
    /** One step on a counter, like a dial clicking round. */
    Step(HapticFeedbackConstantsCompat.CLOCK_TICK),
    /** Ticks that come fast, like days passing under a dragging finger. */
    DragTick(HapticFeedbackConstantsCompat.SEGMENT_FREQUENT_TICK),
    /** Something went through: copied, added. */
    Confirm(HapticFeedbackConstantsCompat.CONFIRM),
    /** Could not: a save that failed, the end of a counter, something that is not possible right now. */
    Reject(HapticFeedbackConstantsCompat.REJECT),
    /** A gesture went far enough to act when let go. */
    ThresholdOn(HapticFeedbackConstantsCompat.GESTURE_THRESHOLD_ACTIVATE),
    /** Pulled back again: letting go now does nothing. */
    ThresholdOff(HapticFeedbackConstantsCompat.GESTURE_THRESHOLD_DEACTIVATE),
    /** A long press that picks something up. */
    LongPress(HapticFeedbackConstantsCompat.LONG_PRESS),
    /** A gesture finished and did its thing. */
    GestureEnd(HapticFeedbackConstantsCompat.GESTURE_END),
}

/** Plays [moment] on this view; for code outside composition, such as a gesture handler. */
fun View.haptic(moment: Haptic) {
    ViewCompat.performHapticFeedback(this, moment.constant)
}

/** Plays haptics on the view this is composed in. Take it outside a popup or dialog that may close first. */
class Haptics(private val view: View) {
    operator fun invoke(moment: Haptic) = view.haptic(moment)
    fun toggle(on: Boolean) = view.haptic(if (on) Haptic.ToggleOn else Haptic.ToggleOff)
    /**
     * Something folding out or back in (the mode pill): a firm tick, two light ones 14 ms apart that the hand feels
     * as one. Measured on the pill that Mark liked when it unfolds; folding in now feels the same.
     */
    fun unfold() {
        view.haptic(Haptic.Tap)
        view.postDelayed({ view.haptic(Haptic.Tap) }, 14)
    }
}

@Composable
fun rememberHaptics(): Haptics {
    val view = LocalView.current
    return remember(view) { Haptics(view) }
}

/**
 * Plays [moment] when [text] turns up, such as Reject for a save that failed or Confirm for one that went
 * through; not when a page opens with it already there, and not again for the same text.
 */
@Composable
fun HapticOn(text: String?, moment: Haptic) {
    val haptics = rememberHaptics()
    val seen = remember { arrayOf(text) }
    LaunchedEffect(text) {
        if (text != null && text != seen[0]) haptics(moment)
        seen[0] = text
    }
}
