package nl.markmaaktmedia.markmysteps.next

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.offset
import androidx.compose.material3.DropdownMenuGroup
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.DropdownMenuPopup
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import kotlinx.coroutines.launch
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** One line of a menu: its name and icon, a tick when [selected] is true, red when it removes something. */
class MenuEntry(
    val label: String,
    val icon: List<Shape24>,
    val danger: Boolean = false,
    val selected: Boolean? = null,
    /** Choices of one kind (a group of only inline entries) sit side by side as connected buttons. */
    val inline: Boolean = false,
    val onClick: () -> Unit,
)

/**
 * The one ⋯ menu of the whole app, Material 3 Expressive's segmented menu: each group a rounded block with a
 * small gap to the next, the corners between items tighter than the outer ones, a chosen option filled with
 * a tick. No shadow (the app has none apart from the bottom bar): the groups stand off what is under them by
 * their own tone and a fine edge. Every entry closes the menu before it acts.
 *
 * Felt: a light tick as it opens (so the button that opens it stays quiet), and a segment tick when a new
 * choice is picked. Plain actions leave the feel to what they do.
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun AppMenu(expanded: Boolean, onDismiss: () -> Unit, groups: List<List<MenuEntry>>, anchorHeight: androidx.compose.ui.unit.Dp = 40.dp, buttonColor: Color? = null) {
    val cs = MaterialTheme.colorScheme
    val shown = groups.filter { it.isNotEmpty() }
    // Taken here, outside the popup: the popup's own view is gone by the time an entry acts.
    val haptics = rememberHaptics()
    androidx.compose.runtime.LaunchedEffect(expanded) { if (expanded) haptics(Haptic.Tap) }
    // It opens over the button it came from: its top on the button's top and its right edge on the button's
    // right edge, moved up only as far as needed to stay on screen. (The material popup shifted itself by the
    // room below, so a fixed offset landed differently on every card.)
    // It grows out of the ⋯ button itself: at the start the shape is exactly that round button, then it opens
    // from the button's corner into the menu; closing (a choice, or a tap beside it) folds it back into the
    // button. So button and menu are one movement, not a block that appears next to a circle.
    val open = androidx.compose.runtime.remember { androidx.compose.animation.core.Animatable(0f) }
    androidx.compose.runtime.LaunchedEffect(expanded) {
        if (expanded) open.animateTo(1f, androidx.compose.animation.core.tween(240, easing = androidx.compose.animation.core.CubicBezierEasing(0.2f, 0f, 0f, 1f)))
        else open.animateTo(0f, androidx.compose.animation.core.tween(220, easing = androidx.compose.animation.core.FastOutSlowInEasing))
    }
    if (!expanded && open.value <= 0f) return
    // The button it came from, as the popup is placed on it.
    var anchor by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(androidx.compose.ui.unit.IntSize.Zero) }
    val margin = with(androidx.compose.ui.platform.LocalDensity.current) { 12.dp.roundToPx() }
    val position = androidx.compose.runtime.remember(margin) {
        object : androidx.compose.ui.window.PopupPositionProvider {
            override fun calculatePosition(anchorBounds: androidx.compose.ui.unit.IntRect, windowSize: androidx.compose.ui.unit.IntSize, layoutDirection: androidx.compose.ui.unit.LayoutDirection, popupContentSize: androidx.compose.ui.unit.IntSize): androidx.compose.ui.unit.IntOffset {
                if (anchor != anchorBounds.size) anchor = anchorBounds.size
                val x = (anchorBounds.right - popupContentSize.width).coerceIn(margin, maxOf(margin, windowSize.width - popupContentSize.width - margin))
                val y = anchorBounds.top.coerceIn(margin, maxOf(margin, windowSize.height - popupContentSize.height - margin))
                return androidx.compose.ui.unit.IntOffset(x, y)
            }
        }
    }
    val motion = MaterialTheme.motionScheme
    androidx.compose.ui.window.Popup(popupPositionProvider = position, onDismissRequest = onDismiss, properties = androidx.compose.ui.window.PopupProperties(focusable = true)) {
      val density = androidx.compose.ui.platform.LocalDensity.current
      // The menu's outer corners: the inner ones (24 dp) plus the 4 dp they sit inside it, so they run alike.
      val cornerFull = with(density) { 28.dp.toPx() }
      val menuScope = androidx.compose.runtime.rememberCoroutineScope()
      androidx.compose.foundation.layout.Box(
        Modifier.graphicsLayer {
            val k = open.value
            val aw = anchor.width.toFloat().coerceAtLeast(1f); val ah = anchor.height.toFloat().coerceAtLeast(1f)
            val full = this.size
            val w = aw + (full.width - aw) * k
            val h = ah + (full.height - ah) * k
            val r = ah / 2f + (cornerFull - ah / 2f) * k
            // A rounded box from the button's top right corner, growing to the whole menu.
            shape = object : androidx.compose.ui.graphics.Shape {
                override fun createOutline(size: androidx.compose.ui.geometry.Size, layoutDirection: androidx.compose.ui.unit.LayoutDirection, density: androidx.compose.ui.unit.Density) =
                    androidx.compose.ui.graphics.Outline.Rounded(androidx.compose.ui.geometry.RoundRect(size.width - w, 0f, size.width, h, androidx.compose.ui.geometry.CornerRadius(r)))
            }
            clip = true
        },
      ) {
      androidx.compose.foundation.layout.Box(Modifier.drawWithContent {
          drawContent()
          // It starts in the button's own colour and passes into the menu's, so it plainly comes out of it.
          val tint = (1f - open.value / 0.55f).coerceIn(0f, 1f)
          if (tint > 0f) drawRect(buttonColor ?: cs.surfaceContainerHigh, alpha = tint)
      }) {
      androidx.compose.foundation.layout.Box(Modifier.graphicsLayer { alpha = ((open.value - 0.1f) / 0.6f).coerceIn(0f, 1f) }) {
      // As wide as its widest line needs, within a calm range; never the width of the screen.
      androidx.compose.foundation.layout.Column(Modifier.width(androidx.compose.foundation.layout.IntrinsicSize.Max).widthIn(min = 200.dp, max = 300.dp)) {
        val text = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 15.sp)
        val edge = BorderStroke(1.dp, cs.outlineVariant.copy(alpha = 0.55f))
        shown.forEachIndexed { g, entries ->
            if (g > 0) Spacer(Modifier.height(MenuDefaults.GroupSpacing))
            val outer = 28.dp; val tight = 10.dp
            val groupShape = androidx.compose.foundation.shape.RoundedCornerShape(
                topStart = if (g == 0) outer else tight, topEnd = if (g == 0) outer else tight,
                bottomStart = if (g == shown.lastIndex) outer else tight, bottomEnd = if (g == shown.lastIndex) outer else tight,
            )
            DropdownMenuGroup(
                shapes = androidx.compose.material3.MenuGroupShapes(groupShape, groupShape),
                // Room to breathe: the choices side by side never squeeze.
                modifier = Modifier.fillMaxWidth().widthIn(min = 248.dp),
                containerColor = cs.surfaceContainerHigh,
                tonalElevation = 0.dp,
                shadowElevation = 0.dp,
                border = edge,
            ) {
                // Choices of one kind side by side, then the plain lines, all in the same group.
                val inlines = entries.filter { it.inline }
                val lines = entries.filterNot { it.inline }
                if (inlines.isNotEmpty()) {
                    // One choice out of a few: connected buttons side by side, the chosen one filled.
                    androidx.compose.foundation.layout.Row(
                        // On the same edges as the lines under it, and the same gap above and below it as beside it
                        // and between the lines (measured on the phone: 10 px all round). The group already adds a
                        // little at its top and between items, hence the uneven numbers.
                        Modifier.fillMaxWidth().padding(start = 4.dp, end = 4.dp, top = 2.5.dp, bottom = 1.5.dp),
                        horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(androidx.compose.material3.ButtonGroupDefaults.ConnectedSpaceBetween),
                    ) {
                        inlines.forEachIndexed { i, e ->
                            val on = e.selected == true
                            androidx.compose.material3.ToggleButton(
                                checked = on,
                                // The choice shows first (the pill moves over), then the menu folds away.
                                onCheckedChange = { if (!on) haptics(Haptic.Tick); e.onClick(); menuScope.launch { kotlinx.coroutines.delay(if (on) 0 else 420); onDismiss() } },
                                modifier = Modifier.weight(1f).height(52.dp),
                                // Squarer where they meet, and the chosen one morphs into a full pill.
                                shapes = run {
                                    val outer = 24.dp; val inner = 8.dp
                                    val base = androidx.compose.foundation.shape.RoundedCornerShape(
                                        topStart = if (i == 0) outer else inner, bottomStart = if (i == 0) outer else inner,
                                        topEnd = if (i == inlines.lastIndex) outer else inner, bottomEnd = if (i == inlines.lastIndex) outer else inner,
                                    )
                                    androidx.compose.material3.ToggleButtonShapes(base, base, androidx.compose.foundation.shape.CircleShape)
                                },
                                colors = androidx.compose.material3.ToggleButtonDefaults.toggleButtonColors(
                                    containerColor = cs.surfaceContainerLow, contentColor = cs.onSurface,
                                    checkedContainerColor = cs.primary, checkedContentColor = cs.onPrimary,
                                ),
                                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 4.dp),
                            ) {
                                Text(e.label, maxLines = 1, style = text)
                            }
                        }
                    }
                }
                lines.forEachIndexed { i, e ->
                    val on = e.selected == true
                    val tint = when { e.danger -> cs.error; on -> cs.onPrimaryContainer; else -> cs.onSurface }
                    DropdownMenuItem(
                        selected = on,
                        onClick = { if (e.selected == false) haptics(Haptic.Tick); onDismiss(); e.onClick() },
                        text = { Text(e.label, style = text, color = tint) },
                        // Concentric with the menu: 24 dp where an item meets the menu's 28 dp corner, tight elsewhere.
                        shapes = run {
                            val edge = 24.dp; val tight = 6.dp
                            val top = if (g == 0 && inlines.isEmpty() && i == 0) edge else tight
                            val bottom = if (g == shown.lastIndex && i == lines.lastIndex) edge else tight
                            val shape = androidx.compose.foundation.shape.RoundedCornerShape(topStart = top, topEnd = top, bottomStart = bottom, bottomEnd = bottom)
                            androidx.compose.material3.MenuItemShapes(shape, shape)
                        },
                        leadingIcon = { LineIcon(e.icon, tint, size = 20.dp) },
                        trailingIcon = if (on) ({ LineIcon(Glyphs.check, tint, size = 18.dp, stroke = 2.4f) }) else null,
                        // The chosen one in the app's own warm accent, not the scheme's teal.
                        colors = MenuDefaults.selectableItemColors(containerColor = cs.surfaceContainerLow, selectedContainerColor = cs.primaryContainer),
                    )
                }
            }
        }
    }
      }
      }
      }
    }
}
