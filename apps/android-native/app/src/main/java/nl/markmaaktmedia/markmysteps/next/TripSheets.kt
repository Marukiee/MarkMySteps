package nl.markmaaktmedia.markmysteps.next

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ButtonGroupDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.ToggleButton
import androidx.compose.material3.ToggleButtonDefaults
import androidx.compose.material3.toShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

/*
 * The trip page's own sheets, opened from their buttons as on the web: the
 * map's settings (its style) and the trip's settings (its colour, fetching the
 * photos again).
 */

/** The map's look: the web's four styles as one connected group. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MapSheet(onDismiss: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = cs.surfaceContainerLow) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 28.dp)) {
            Text("Kaart", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 24.sp, color = cs.onSurface))
            Text("Stijl van de kaart", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.5.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 4.dp, bottom = 14.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(ButtonGroupDefaults.ConnectedSpaceBetween)) {
                MapStylePref.ids.forEachIndexed { i, (id, label) ->
                    ToggleButton(
                        checked = MapStylePref.id == id, onCheckedChange = { MapStylePref.set(id) },
                        modifier = Modifier.weight(1f).height(52.dp),
                        shapes = when (i) {
                            0 -> ButtonGroupDefaults.connectedLeadingButtonShapes()
                            MapStylePref.ids.lastIndex -> ButtonGroupDefaults.connectedTrailingButtonShapes()
                            else -> ButtonGroupDefaults.connectedMiddleButtonShapes()
                        },
                        colors = ToggleButtonDefaults.toggleButtonColors(
                            containerColor = cs.surfaceContainerHighest, contentColor = cs.onSurfaceVariant,
                            checkedContainerColor = cs.primary, checkedContentColor = cs.onPrimary,
                        ),
                    ) { Text(label, maxLines = 1, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp)) }
                }
            }
            Text(
                "In de donkere stand worden de lichte stijlen vanzelf de donkere kaart.",
                style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 12.5.sp, color = cs.onSurfaceVariant),
                modifier = Modifier.padding(top = 12.dp, start = 4.dp),
            )
        }
    }
}

private val TripColors = listOf(
    "#E8613C", "#E34B8A", "#7A5BD6", "#5B8DEF", "#2BB6A8", "#4CAF50", "#D9A441", "#C9772E", "#8D6E63", "#607D8B",
)

/** The trip's own settings: its colour on the globe and the map, and fetching its photos again. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TripSettingsSheet(trip: Trip, onDismiss: () -> Unit, onChanged: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    var color by remember { mutableStateOf(trip.color) }
    var syncing by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }
    val owner = trip.ownerId != null && trip.ownerId == Data.me?.id
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = cs.surfaceContainerLow) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 28.dp)) {
            Text("Reisinstellingen", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 24.sp, color = cs.onSurface))
            Text("${trip.title} · ${trip.dates}", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.5.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 4.dp, bottom = 18.dp))

            Text("Kleur", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(start = 4.dp, bottom = 10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TripColors.take(5).forEach { hex -> Swatch(hex, color, owner) { c -> color = c; scope.launch { runCatching { Remote.setTripColor(trip, hex) }.onSuccess { onChanged() } } } }
            }
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TripColors.drop(5).forEach { hex -> Swatch(hex, color, owner) { c -> color = c; scope.launch { runCatching { Remote.setTripColor(trip, hex) }.onSuccess { onChanged() } } } }
            }

            Text("Foto's", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(start = 4.dp, top = 24.dp, bottom = 10.dp))
            FilledTonalButton(
                onClick = {
                    syncing = true; note = null
                    scope.launch {
                        note = if (runCatching { Remote.syncPhotos(trip) }.isSuccess) "Foto's worden opgehaald" else "Ophalen mislukt"
                        syncing = false
                        onChanged()
                    }
                },
                enabled = !syncing, shapes = ButtonDefaults.shapes(), modifier = Modifier.height(48.dp),
            ) {
                // The spinner takes the icon's place, so the button keeps its size.
                Box(Modifier.size(20.dp), contentAlignment = Alignment.Center) {
                    if (syncing) LoadingIndicator(Modifier.size(20.dp), color = cs.onSecondaryContainer)
                    else LineIcon(Glyphs.download, cs.onSecondaryContainer, size = 20.dp, stroke = 2f)
                }
                Spacer(Modifier.size(8.dp))
                Text("Foto's opnieuw ophalen uit Immich", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp))
            }
            note?.let { Text(it, style = TextStyle(fontFamily = Inter, fontSize = 13.5.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(start = 4.dp, top = 8.dp)) }
        }
    }
}

@Composable
private fun Swatch(hex: String, current: Color, enabled: Boolean, onPick: (Color) -> Unit) {
    val c = Color(android.graphics.Color.parseColor(hex))
    val on = c.toArgb() == current.toArgb()
    Box(
        Modifier.size(48.dp).clip(if (on) MaterialShapes.Cookie9Sided.toShape() else CircleShape).background(c)
            .clickable(enabled = enabled) { onPick(c) },
        contentAlignment = Alignment.Center,
    ) { if (on) LineIcon(listOf(P("m5 12 5 5 9-10")), Color.White, size = 20.dp, stroke = 2.6f) }
}
