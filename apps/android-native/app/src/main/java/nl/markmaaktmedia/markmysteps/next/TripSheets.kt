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
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

/*
 * The trip page's map sheet, opened from its button as on the web: the map's
 * style. The trip's own settings are a page of their own (TripSettingsPage.kt).
 */

/** The map's look: the web's four styles as one connected group. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MapSheet(onDismiss: () -> Unit, layers: MapLayers? = null) {
    val cs = MaterialTheme.colorScheme
    AppSheet(onDismiss = onDismiss) {
        Column(Modifier.fillMaxWidth().verticalScroll(androidx.compose.foundation.rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 28.dp)) {
            Text(if (layers != null) stringResource(R.string.mapsheet_settings) else stringResource(R.string.mapsheet_map), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 24.sp, color = cs.onSurface))
            // The style first (Mark: the first thing you look for), then whose routes and photos are on this map.
            if (layers != null) {
                Spacer(Modifier.height(14.dp))
                Text(stringResource(R.string.mapsheet_style), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 17.sp, color = cs.onSurface), modifier = Modifier.padding(start = 4.dp))
                Spacer(Modifier.height(12.dp))
            } else Text(stringResource(R.string.mapsheet_style_of), style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.5.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 4.dp, bottom = 14.dp))
            MapStyleGrid()
            Text(
                stringResource(R.string.tripsheets_map_style_hint),
                style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 12.5.sp, color = cs.onSurfaceVariant),
                modifier = Modifier.padding(top = 12.dp, start = 4.dp),
            )
            if (layers != null) {
                Spacer(Modifier.height(24.dp))
                MapLayersSections(layers)
            }
        }
    }
}

/** The web's drawn swatch of each map style (mapstyle.css), in light and dark. */
@Composable
fun MapStylePreview(id: String, dark: Boolean, modifier: Modifier) {
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
