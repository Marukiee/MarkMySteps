package nl.markmaaktmedia.markmysteps.next

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ButtonGroupDefaults
import androidx.compose.material3.MaterialShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.ToggleButton
import androidx.compose.material3.ToggleButtonDefaults
import androidx.compose.material3.ripple
import androidx.compose.material3.toShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/*
 * Settings in the Material 3 Expressive proposal: the profile at the top, then
 * the groups of the web app's settings as slabs of rows (outer corners round,
 * inner ones tight), each icon in a shape of its own, real switches and a
 * connected toggle group for the theme. The texts are the short ones of the
 * web app: what a row does, its current value on the right.
 */

private fun Modifier.dip(onClick: () -> Unit = {}): Modifier = composed {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.97f else 1f, MaterialTheme.motionScheme.fastSpatialSpec(), label = "press")
    clickable(source, ripple(), onClick = onClick).graphicsLayer { scaleX = scale; scaleY = scale }
}

private fun slabShape(i: Int, n: Int): Shape {
    val big = 26.dp
    val small = 6.dp
    return RoundedCornerShape(
        topStart = if (i == 0) big else small, topEnd = if (i == 0) big else small,
        bottomStart = if (i == n - 1) big else small, bottomEnd = if (i == n - 1) big else small,
    )
}

private val IconShapes = listOf(
    MaterialShapes.Cookie9Sided, MaterialShapes.Sunny, MaterialShapes.Clover4Leaf,
    MaterialShapes.Cookie6Sided, MaterialShapes.SoftBurst, MaterialShapes.Flower,
)

private class Item(
    val icon: List<Shape24>,
    val title: String,
    val value: String? = null,
    val toggle: Boolean? = null,
)

@Composable
fun SettingsPage() {
    val cs = MaterialTheme.colorScheme
    var theme by remember { mutableIntStateOf(2) }
    var autoUpdate by remember { mutableStateOf(true) }
    var twoFactor by remember { mutableStateOf(true) }

    Column(Modifier.fillMaxSize().background(cs.background).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
        Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
        Text(
            "Instellingen",
            style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 32.sp, letterSpacing = (-0.02).em, color = cs.onBackground),
            modifier = Modifier.padding(top = 20.dp, bottom = 18.dp),
        )

        // Who is signed in, on which server.
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(30.dp)).background(cs.surfaceContainerLow).dip().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(64.dp).clip(MaterialShapes.Cookie12Sided.toShape()).background(cs.primaryContainer), contentAlignment = Alignment.Center) {
                Text("M", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 26.sp, color = cs.onPrimaryContainer))
            }
            Column(Modifier.weight(1f).padding(horizontal = 16.dp)) {
                Text("Mark", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 21.sp, color = cs.onSurface))
                Text("@mark · eigen server", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.5.sp, color = cs.onSurfaceVariant))
            }
            LineIcon(Glyphs.pencil, cs.onSurfaceVariant, size = 20.dp, stroke = 2f)
        }

        Group("Account", listOf(
            Item(Glyphs.person, "Profiel", "naam, foto"),
            Item(Glyphs.lock, "Wachtwoord"),
            Item(Glyphs.shield, "Tweestapsverificatie", toggle = twoFactor),
        ), onToggle = { twoFactor = !twoFactor })

        // The theme as one connected group, the open one filled.
        Header("Weergave")
        Column(Modifier.fillMaxWidth().clip(slabShape(0, 3)).background(cs.surfaceContainerLow).padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconTile(Glyphs.sun, 1)
                Text("Thema", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 17.sp, color = cs.onSurface), modifier = Modifier.padding(start = 14.dp))
            }
            Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(ButtonGroupDefaults.ConnectedSpaceBetween)) {
                listOf("Licht", "Donker", "Systeem").forEachIndexed { i, label ->
                    ToggleButton(
                        checked = theme == i,
                        onCheckedChange = { theme = i },
                        modifier = Modifier.weight(1f).height(44.dp),
                        shapes = when (i) {
                            0 -> ButtonGroupDefaults.connectedLeadingButtonShapes()
                            2 -> ButtonGroupDefaults.connectedTrailingButtonShapes()
                            else -> ButtonGroupDefaults.connectedMiddleButtonShapes()
                        },
                        colors = ToggleButtonDefaults.toggleButtonColors(
                            containerColor = cs.surfaceContainerHigh, contentColor = cs.onSurfaceVariant,
                            checkedContainerColor = cs.primary, checkedContentColor = cs.onPrimary,
                        ),
                    ) { Text(label, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp)) }
                }
            }
        }
        Spacer(Modifier.height(3.dp))
        Row0(Item(Glyphs.globe, "Taal", "Nederlands"), 1, 3, 2)
        Spacer(Modifier.height(3.dp))
        Row0(Item(Glyphs.bell, "Meldingen", "reacties, nieuwe foto's"), 2, 3, 3)

        Group("Diensten", listOf(
            Item(Glyphs.photo, "Immich", "verbonden"),
            Item(Glyphs.plane, "Vliegvelden", "AMS, EIN"),
        ))

        Group("Updates", listOf(
            Item(Glyphs.download, "Automatisch controleren", toggle = autoUpdate),
            Item(Glyphs.download, "Nu controleren", "build 267"),
        ), onToggle = { autoUpdate = !autoUpdate })

        Group("Over", listOf(
            Item(Glyphs.help, "Wat is er nieuw"),
            Item(Glyphs.logo, "Over MarkMySteps", "AGPL-3.0"),
        ))

        Spacer(Modifier.height(120.dp))
        Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
    }
}

@Composable
private fun Header(text: String) {
    Text(
        text,
        style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant),
        modifier = Modifier.padding(start = 6.dp, top = 24.dp, bottom = 10.dp),
    )
}

@Composable
private fun Group(title: String, items: List<Item>, onToggle: () -> Unit = {}) {
    Header(title)
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        items.forEachIndexed { i, item -> Row0(item, i, items.size, title.length + i, onToggle) }
    }
}

@Composable
private fun IconTile(icon: List<Shape24>, seed: Int) {
    val cs = MaterialTheme.colorScheme
    Box(Modifier.size(42.dp).clip(IconShapes[seed % IconShapes.size].toShape()).background(cs.secondaryContainer), contentAlignment = Alignment.Center) {
        LineIcon(icon, cs.onSecondaryContainer, size = 20.dp, stroke = 2f)
    }
}

@Composable
private fun Row0(item: Item, i: Int, n: Int, seed: Int, onToggle: () -> Unit = {}) {
    val cs = MaterialTheme.colorScheme
    Row(
        Modifier.fillMaxWidth().clip(slabShape(i, n)).background(cs.surfaceContainerLow)
            .dip { if (item.toggle != null) onToggle() }.padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconTile(item.icon, seed)
        Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
            Text(item.title, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 17.sp, color = cs.onSurface))
            if (item.value != null) {
                Text(item.value, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = cs.onSurfaceVariant))
            }
        }
        if (item.toggle != null) {
            Switch(
                checked = item.toggle,
                onCheckedChange = { onToggle() },
                thumbContent = if (item.toggle) {
                    { LineIcon(listOf(P("m5 12 5 5 9-10")), cs.primary, size = 14.dp, stroke = 2.6f) }
                } else null,
                colors = SwitchDefaults.colors(checkedTrackColor = cs.primary, checkedThumbColor = cs.onPrimary),
            )
        } else {
            LineIcon(Glyphs.chevronRight, cs.onSurfaceVariant, size = 18.dp, stroke = 2.2f)
        }
    }
}
