package nl.markmaaktmedia.markmysteps.next

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/*
 * The countries you have been to, filled in on a slowly turning globe, as the
 * web's CountryGlobe: Natural Earth's 110m countries, each visited one in a
 * colour from its own flag (hue kept, saturation and lightness clamped so it
 * reads on light and dark), the rest a quiet land colour, a soft light from
 * the top left. Turns 7 degrees a second.
 */

private class Country(val code: String?, val hex: String?, val rings: List<FloatArray>)

private var loaded: List<Country>? = null

private fun load(context: android.content.Context): List<Country> = loaded ?: run {
    val a = JSONArray(context.assets.open("countries110.json").bufferedReader().readText())
    (0 until a.length()).map { i ->
        val o = a.getJSONObject(i)
        val rings = mutableListOf<FloatArray>()
        val polys = o.getJSONArray("p")
        for (p in 0 until polys.length()) {
            val poly = polys.getJSONArray(p)
            for (r in 0 until poly.length()) {
                val ring = poly.getJSONArray(r)
                rings += FloatArray(ring.length() * 2) { k -> ring.getJSONArray(k / 2).getDouble(k % 2).toFloat() }
            }
        }
        Country(o.optString("c").takeIf { it.isNotBlank() && it != "null" }, o.optString("h").takeIf { it.startsWith("#") }, rings)
    }.also { loaded = it }
}

/** A country's colour from its flag, clamped into a band that reads on either theme (web: hueFor). */
private fun hueFor(code: String, hex: String?, dark: Boolean): Color {
    var hash = 0L
    for (ch in code) hash = (hash * 131 + ch.code) and 0xFFFFFFFFL
    val hsl = FloatArray(3)
    if (hex != null) androidx.core.graphics.ColorUtils.colorToHSL(android.graphics.Color.parseColor(hex), hsl)
    else { hsl[0] = (hash % 360).toFloat(); hsl[1] = 0.6f; hsl[2] = 0.52f }
    val hue = ((hsl[0] + ((hash % 9) - 4)) % 360 + 360) % 360
    val sat = (hsl[1] * 100).coerceIn(38f, if (dark) 62f else 72f)
    val base = if (dark) 52f else 50f
    val light = (base + (hsl[2] * 100 - 50) * 0.35f).coerceIn(if (dark) 42f else 40f, 62f) + ((hash % 5) - 2)
    return Color(androidx.core.graphics.ColorUtils.HSLToColor(floatArrayOf(hue, sat / 100f, light / 100f)))
}

@Composable
fun CountryGlobe(codes: List<String>, dark: Boolean, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val countries by produceState<List<Country>?>(loaded, Unit) { if (value == null) value = withContext(Dispatchers.IO) { load(context) } }
    val visited = remember(codes) { codes.map { it.uppercase() }.toSet() }
    // Open on the middle of where you have been, the tilt a little towards it.
    val (startLon, startLat) = remember(countries, visited) {
        val mine = countries.orEmpty().filter { it.code in visited }
        if (mine.isEmpty()) 10.0 to 30.0 else {
            var x = 0.0; var y = 0.0; var z = 0.0; var n = 0
            for (c in mine) for (r in c.rings) for (k in r.indices step 2) {
                val lo = Math.toRadians(r[k].toDouble()); val la = Math.toRadians(r[k + 1].toDouble())
                x += cos(la) * cos(lo); y += cos(la) * sin(lo); z += sin(la); n++
            }
            Math.toDegrees(atan2(y, x)) to Math.toDegrees(atan2(z, sqrt(x * x + y * y)))
        }
    }
    var rotation by remember(startLon) { mutableFloatStateOf(-startLon.toFloat()) }
    // Keyed on the start, so it keeps turning the state that is on screen once the countries have loaded.
    LaunchedEffect(startLon) {
        var last = 0L
        while (true) withFrameNanos { t ->
            if (last != 0L) rotation -= ((t - last) / 1e9f).coerceAtMost(0.05f) * 7f
            last = t
        }
    }
    val water = if (dark) Color(0xFF1D2731) else Color(0xFFE8EDF2)
    val land = if (dark) Color(0xFF39434D) else Color(0xFFD3DAE1)
    val edge = if (dark) Color(0xFF14181D) else Color.White
    val path = remember { Path() }
    Canvas(modifier) {
        val r = size.minDimension / 2f - 4f
        val c = Offset(size.width / 2f, size.height / 2f)
        drawCircle(water, r, c)
        val list = countries ?: return@Canvas
        val lam0 = Math.toRadians(-rotation.toDouble())
        val phi0 = Math.toRadians(startLat * 0.55)
        val sp = sin(phi0); val cp = cos(phi0)
        for (country in list) {
            val fill = if (country.code != null && country.code in visited) hueFor(country.code, country.hex, dark) else land
            for (ring in country.rings) {
                path.reset()
                var any = false
                for (k in ring.indices step 2) {
                    val lo = Math.toRadians(ring[k].toDouble()) - lam0
                    val la = Math.toRadians(ring[k + 1].toDouble())
                    val cl = cos(la)
                    var px = cl * sin(lo)
                    var py = cp * sin(la) - sp * cl * cos(lo)
                    val front = sp * sin(la) + cp * cl * cos(lo)
                    if (front < 0) {
                        // Behind the globe: pinned to its edge, so a country crossing the rim keeps its shape on our side.
                        val d = sqrt(px * px + py * py).coerceAtLeast(1e-9); px /= d; py /= d
                    } else any = true
                    val x = c.x + (px * r).toFloat(); val y = c.y - (py * r).toFloat()
                    if (k == 0) path.moveTo(x, y) else path.lineTo(x, y)
                }
                if (!any) continue
                path.close()
                drawPath(path, fill)
                drawPath(path, edge, style = Stroke(width = 0.8f))
            }
        }
        // The light from the top left, as on the web.
        drawCircle(
            Brush.radialGradient(listOf(Color.White.copy(alpha = if (dark) 0.06f else 0.18f), Color.Transparent, Color.Black.copy(alpha = if (dark) 0.35f else 0.12f)),
                center = Offset(c.x - r * 0.42f, c.y - r * 0.46f), radius = r * 2.2f),
            r, c,
        )
    }
}
