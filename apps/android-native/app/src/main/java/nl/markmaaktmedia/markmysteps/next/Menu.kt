package nl.markmaaktmedia.markmysteps.next

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
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
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun AppMenu(expanded: Boolean, onDismiss: () -> Unit, groups: List<List<MenuEntry>>, anchorHeight: androidx.compose.ui.unit.Dp = 40.dp) {
    val cs = MaterialTheme.colorScheme
    val shown = groups.filter { it.isNotEmpty() }
    // It opens over the button it came from: its top on the button's top and its right edge on the button's
    // right edge, moved up only as far as needed to stay on screen. (The material popup shifted itself by the
    // room below, so a fixed offset landed differently on every card.)
    val visible = androidx.compose.runtime.remember { androidx.compose.animation.core.MutableTransitionState(false) }
    visible.targetState = expanded
    if (!visible.currentState && !visible.targetState) return
    val margin = with(androidx.compose.ui.platform.LocalDensity.current) { 12.dp.roundToPx() }
    val position = androidx.compose.runtime.remember(margin) {
        object : androidx.compose.ui.window.PopupPositionProvider {
            override fun calculatePosition(anchorBounds: androidx.compose.ui.unit.IntRect, windowSize: androidx.compose.ui.unit.IntSize, layoutDirection: androidx.compose.ui.unit.LayoutDirection, popupContentSize: androidx.compose.ui.unit.IntSize): androidx.compose.ui.unit.IntOffset {
                val x = (anchorBounds.right - popupContentSize.width).coerceIn(margin, maxOf(margin, windowSize.width - popupContentSize.width - margin))
                val y = anchorBounds.top.coerceIn(margin, maxOf(margin, windowSize.height - popupContentSize.height - margin))
                return androidx.compose.ui.unit.IntOffset(x, y)
            }
        }
    }
    val motion = MaterialTheme.motionScheme
    androidx.compose.ui.window.Popup(popupPositionProvider = position, onDismissRequest = onDismiss, properties = androidx.compose.ui.window.PopupProperties(focusable = true)) {
      androidx.compose.animation.AnimatedVisibility(
        visible,
        enter = androidx.compose.animation.scaleIn(motion.fastSpatialSpec(), initialScale = 0.85f, transformOrigin = androidx.compose.ui.graphics.TransformOrigin(1f, 0f)) + androidx.compose.animation.fadeIn(motion.fastEffectsSpec()),
        exit = androidx.compose.animation.scaleOut(motion.fastSpatialSpec(), targetScale = 0.9f, transformOrigin = androidx.compose.ui.graphics.TransformOrigin(1f, 0f)) + androidx.compose.animation.fadeOut(motion.fastEffectsSpec()),
      ) {
      androidx.compose.foundation.layout.Column {
        val text = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 15.sp)
        val edge = BorderStroke(1.dp, cs.outlineVariant.copy(alpha = 0.55f))
        shown.forEachIndexed { g, entries ->
            if (g > 0) Spacer(Modifier.height(MenuDefaults.GroupSpacing))
            DropdownMenuGroup(
                shapes = MenuDefaults.groupShape(g, shown.size),
                // Room to breathe: the choices side by side never squeeze.
                modifier = Modifier.widthIn(min = 248.dp),
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
                        // On the same edges as the lines under it (each line keeps a small inset inside its group).
                        // The same gap above and below it as between the lines under it.
                        Modifier.fillMaxWidth().padding(start = 4.dp, end = 4.dp, bottom = 2.dp).offset(y = (-1.5).dp),
                        horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(androidx.compose.material3.ButtonGroupDefaults.ConnectedSpaceBetween),
                    ) {
                        inlines.forEachIndexed { i, e ->
                            val on = e.selected == true
                            androidx.compose.material3.ToggleButton(
                                checked = on,
                                onCheckedChange = { onDismiss(); e.onClick() },
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
                        onClick = { onDismiss(); e.onClick() },
                        text = { Text(e.label, style = text, color = tint) },
                        shapes = MenuDefaults.itemShape(i, lines.size),
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
