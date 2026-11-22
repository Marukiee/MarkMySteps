package nl.markmaaktmedia.markmysteps.next

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
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
fun AppMenu(expanded: Boolean, onDismiss: () -> Unit, groups: List<List<MenuEntry>>) {
    val cs = MaterialTheme.colorScheme
    val shown = groups.filter { it.isNotEmpty() }
    DropdownMenuPopup(expanded = expanded, onDismissRequest = onDismiss) {
        val text = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 15.sp)
        val edge = BorderStroke(1.dp, cs.outlineVariant.copy(alpha = 0.55f))
        shown.forEachIndexed { g, entries ->
            if (g > 0) Spacer(Modifier.height(MenuDefaults.GroupSpacing))
            DropdownMenuGroup(
                shapes = MenuDefaults.groupShape(g, shown.size),
                containerColor = cs.surfaceContainerHigh,
                tonalElevation = 0.dp,
                shadowElevation = 0.dp,
                border = edge,
            ) {
                entries.forEachIndexed { i, e ->
                    val on = e.selected == true
                    val tint = when { e.danger -> cs.error; on -> cs.onTertiaryContainer; else -> cs.onSurface }
                    DropdownMenuItem(
                        selected = on,
                        onClick = { onDismiss(); e.onClick() },
                        text = { Text(e.label, style = text, color = tint) },
                        shapes = MenuDefaults.itemShape(i, entries.size),
                        leadingIcon = { LineIcon(e.icon, tint, size = 20.dp) },
                        trailingIcon = if (on) ({ LineIcon(Glyphs.check, tint, size = 18.dp, stroke = 2.4f) }) else null,
                    )
                }
            }
        }
    }
}
