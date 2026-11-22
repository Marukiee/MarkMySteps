package nl.markmaaktmedia.markmysteps.next

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
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
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.Brush
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
    ModalBottomSheet(onDismissRequest = onDismiss, modifier = Modifier.statusBarsPadding(), sheetState = androidx.compose.material3.rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = cs.surfaceContainerLow) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 28.dp)) {
            Text("Kaart", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 24.sp, color = cs.onSurface))
            Text("Stijl van de kaart", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.5.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 4.dp, bottom = 14.dp))
            // A preview of each style, as on the web: two by two, the chosen one outlined.
            val dark = cs.background.luminance() < 0.5f
            MapStylePref.ids.chunked(2).forEach { pair ->
                Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    pair.forEach { (id, label) ->
                        val on = MapStylePref.id == id
                        Column(
                            Modifier.weight(1f).clip(RoundedCornerShape(22.dp)).background(if (on) cs.secondaryContainer else cs.surfaceContainerHigh)
                                .border(2.dp, if (on) cs.primary else androidx.compose.ui.graphics.Color.Transparent, RoundedCornerShape(22.dp))
                                .clickable { MapStylePref.set(id) }.padding(8.dp),
                        ) {
                            MapStylePreview(id, dark, Modifier.fillMaxWidth().height(84.dp).clip(RoundedCornerShape(16.dp)))
                            Row(Modifier.padding(top = 8.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(label, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = if (on) cs.onSecondaryContainer else cs.onSurface), modifier = Modifier.weight(1f))
                                if (on) LineIcon(listOf(P("m5 12 5 5 9-10")), cs.primary, size = 18.dp, stroke = 2.6f)
                            }
                        }
                    }
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
    ModalBottomSheet(onDismissRequest = onDismiss, modifier = Modifier.statusBarsPadding(), sheetState = androidx.compose.material3.rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = cs.surfaceContainerLow) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 28.dp)) {
            Text("Reisinstellingen", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 24.sp, color = cs.onSurface))
            Text("${trip.title} · ${trip.dates}", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.5.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 4.dp, bottom = 18.dp))

            Text("Kleur", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(bottom = 10.dp))
            // The trip's own colour first when it is not one of the ten, so the current choice is always marked.
            val own = "#%06X".format(0xFFFFFF and trip.color.toArgb())
            val colours = if (TripColors.any { Color(android.graphics.Color.parseColor(it)).toArgb() == trip.color.toArgb() }) TripColors else listOf(own) + TripColors.dropLast(1)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                colours.take(5).forEach { hex -> Swatch(hex, color, owner) { c -> color = c; scope.launch { runCatching { Remote.setTripColor(trip, hex) }.onSuccess { onChanged() } } } }
            }
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                colours.drop(5).forEach { hex -> Swatch(hex, color, owner) { c -> color = c; scope.launch { runCatching { Remote.setTripColor(trip, hex) }.onSuccess { onChanged() } } } }
            }

            Text("Foto's", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 24.dp, bottom = 10.dp))
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
            note?.let { Text(it, style = TextStyle(fontFamily = Inter, fontSize = 13.5.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 8.dp)) }
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


/** The web's drawn swatch of each map style (mapstyle.css), in light and dark. */
@Composable
private fun MapStylePreview(id: String, dark: Boolean, modifier: Modifier) {
    androidx.compose.foundation.Canvas(modifier) {
        val w = size.width; val h = size.height
        fun band(c: Color, angle: Float, from: Float, to: Float) {
            // A straight band across the swatch at an angle, like the CSS gradients' stripes.
            val p = androidx.compose.ui.graphics.Path()
            val rad = Math.toRadians(angle.toDouble()); val dx = kotlin.math.cos(rad).toFloat(); val dy = kotlin.math.sin(rad).toFloat()
            val len = w + h
            val c0 = androidx.compose.ui.geometry.Offset(w / 2, h / 2)
            val n = androidx.compose.ui.geometry.Offset(-dy, dx)
            fun pt(s: Float, t: Float) = c0 + androidx.compose.ui.geometry.Offset(dx * s + n.x * t, dy * s + n.y * t)
            val a0 = (from - 0.5f) * len; val a1 = (to - 0.5f) * len
            p.moveTo(pt(-len, a0).x, pt(-len, a0).y); p.lineTo(pt(len, a0).x, pt(len, a0).y); p.lineTo(pt(len, a1).x, pt(len, a1).y); p.lineTo(pt(-len, a1).x, pt(-len, a1).y); p.close()
            drawPath(p, c)
        }
        when (id) {
            "positron" -> {
                drawRect(if (dark) Color(0xFF212933) else Color(0xFFF3F1EC))
                band(if (dark) Color(0xFF2B3A2E) else Color(0xFFD7DDB9), 20f, 0.6f, 1.2f)
                band(if (dark) Color(0xFF3B4652) else Color(0xFFCFD6DD), -65f, 0.44f, 0.47f)
            }
            "bright" -> {
                drawRect(if (dark) Color(0xFF2A3A2C) else Color(0xFFD9EFC7))
                band(if (dark) Color(0xFF6A5C37) else Color(0xFFE9D79A), -60f, 0.4f, 1.2f)
                drawCircle(if (dark) Color(0xFF2F6F9E) else Color(0xFF7FC8F0), h * 0.32f, androidx.compose.ui.geometry.Offset(w * 0.7f, h * 0.3f))
            }
            "liberty" -> {
                drawRect(Brush.verticalGradient(if (dark) listOf(Color(0xFF2C2822), Color(0xFF211E19)) else listOf(Color(0xFFEFE7D6), Color(0xFFE2D7BF))))
                band(if (dark) Color(0xFF7A6C52) else Color(0xFFB9A98A), -45f, 0.46f, 0.49f)
            }
            else -> {
                drawRect(Brush.linearGradient(listOf(Color(0xFF2F4A63), Color(0xFF47624A), Color(0xFF6B6A45))))
                drawCircle(Color(0xFF3F5D3A), h * 0.42f, androidx.compose.ui.geometry.Offset(w * 0.4f, h * 0.6f))
            }
        }
    }
}
