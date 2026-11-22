package nl.markmaaktmedia.markmysteps.next

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * The web app's line icons, from the same SVG path data (24 by 24, round
 * caps and joins), so a stroke here is the stroke there.
 */
sealed interface Shape24
data class P(val d: String) : Shape24
data class C(val cx: Float, val cy: Float, val r: Float) : Shape24

object Glyphs {
    val compass = listOf(C(12f, 12f, 9f), P("m15.5 8.5-2 5-5 2 2-5Z"))
    val logo = listOf(C(12f, 12f, 9.4f), P("m16.4 7.6-2.5 6.3-6.3 2.5 2.5-6.3Z"))
    val friends = listOf(C(9f, 8f, 3.2f), P("M2.8 19.5a6.2 6.2 0 0 1 12.4 0"), C(17f, 9.5f, 2.4f), P("M15.4 14.6a5 5 0 0 1 5.8 4.9"))
    val settings = listOf(
        C(12f, 12f, 3f),
        P("M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z"),
    )
    val hourglass = listOf(P("M7 4h10M7 20h10"), P("M7 4c0 4 3 5 5 8 2-3 5-4 5-8"), P("M7 20c0-4 3-5 5-8 2 3 5 4 5 8"))
    val plus = listOf(P("M12 5v14"), P("M5 12h14"))
    val chevronRight = listOf(P("m9 18 6-6-6-6"))
    val globe = listOf(C(12f, 12f, 9f), P("M3 12h18"), P("M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18Z"))
    val distance = listOf(P("M4 6v12"), P("M20 6v12"), P("M4 12h16"), P("m8 9-3 3 3 3"), P("m16 9 3 3-3 3"))
    val pin = listOf(P("M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"), C(12f, 10f, 3f))
    val dotsCircles = listOf(C(5f, 12f, 1.6f), C(12f, 12f, 1.6f), C(19f, 12f, 1.6f))
    val car = listOf(
        P("M2.5 16.4V13.7c0-.6.36-1.14.92-1.36L6 11.2l2.2-2.9c.4-.53 1.03-.85 1.7-.85h4.2c.67 0 1.3.32 1.7.85l2.2 2.9 2.58 1.14c.56.22.92.76.92 1.36v2.7"),
        P("M6 11.2h12"), P("M12 7.45v3.75"), P("M2.5 16.4h2.6M9.1 16.4h5.8M18.9 16.4h2.6"), C(7.1f, 16.5f, 2f), C(16.9f, 16.5f, 2f),
    )
    val train = listOf(
        P("M5 6.5A3.5 3.5 0 0 1 8.5 3h7A3.5 3.5 0 0 1 19 6.5V14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z"),
        P("M5.5 10.5h13"), P("M12 3v7.5"), P("M8.6 13.2h.01M15.4 13.2h.01"), P("M8.6 16v3.4M15.4 16v3.4"),
    )
    val plane = listOf(P("M12 2c1.1 0 1.8 1.5 1.8 3.4v3.3l7.7 4.5v2.2l-7.7-2.4v4.2l2.8 1.9v1.9L12 19.9l-4.6 1.1v-1.9l2.8-1.9v-4.2L2.5 15.4v-2.2l7.7-4.5V5.4C10.2 3.5 10.9 2 12 2Z"))
    val person = listOf(C(12f, 8f, 3.6f), P("M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"))
    val lock = listOf(P("M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z"), P("M8 11V7a4 4 0 0 1 8 0v4"))
    val shield = listOf(P("M12 3 5 6v6c0 4 3 6.5 7 9 4-2.5 7-5 7-9V6l-7-3Z"), P("m9 12 2 2 4-4"))
    val bell = listOf(P("M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"), P("M10 20a2 2 0 0 0 4 0"))
    val sun = listOf(C(12f, 12f, 4f), P("M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"))
    val moon = listOf(P("M20 14.5A8.5 8.5 0 0 1 9.5 4a7.5 7.5 0 1 0 10.5 10.5Z"))
    val download = listOf(P("M12 3v12"), P("m7 11 5 5 5-5"), P("M4 20h16"))
    val help = listOf(C(12f, 12f, 9f), P("M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7"), P("M12 17h.01"))
    val pencil = listOf(P("M12 20h9"), P("M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"))
    val photo = listOf(P("M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"), C(9f, 9.5f, 1.8f), P("m21 15-5-5L5 20"))
    val bus = listOf(P("M7 4h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"), P("M5 11h14"), P("M8 16v2M16 16v2"), P("M7.5 13.5h.01M16.5 13.5h.01"))
    val boat = listOf(P("M3 15h18l-2 4a2 2 0 0 1-1.8 1H6.8A2 2 0 0 1 5 19l-2-4Z"), P("M5 15V9a2 2 0 0 1 2-2h6l4 4v4"), P("M10 7V4"))
    val minus = listOf(P("M5 12h14"))
    val trash = listOf(P("M4 7h16"), P("M10 11v6M14 11v6"), P("M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"), P("M9 7V4h6v3"))
    val search = listOf(C(11f, 11f, 7f), P("m20 20-3.5-3.5"))
    val camera = listOf(P("M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"), C(12f, 13f, 3.2f))
    val arrowRight = listOf(P("M5 12h14"), P("m13 6 6 6-6 6"))
    val cloud = listOf(P("M7 18h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.2 9.1 4.5 4.5 0 0 0 7 18Z"))
    val grip = listOf(C(9f, 6f, 1.3f), C(15f, 6f, 1.3f), C(9f, 12f, 1.3f), C(15f, 12f, 1.3f), C(9f, 18f, 1.3f), C(15f, 18f, 1.3f))
}

private val parsed = HashMap<String, Path>()

private fun pathOf(d: String): Path = parsed.getOrPut(d) { PathParser().parsePathString(d).toPath() }

@Composable
fun LineIcon(
    shapes: List<Shape24>,
    color: Color,
    size: Dp = 24.dp,
    stroke: Float = 2f,
    filled: Boolean = false,
    modifier: Modifier = Modifier,
) {
    val list = remember(shapes) { shapes }
    Canvas(modifier.size(size)) {
        val k = this.size.minDimension / 24f
        scale(k, pivot = Offset.Zero) {
            val style = if (filled) Fill else Stroke(width = stroke, cap = StrokeCap.Round, join = StrokeJoin.Round)
            for (s in list) when (s) {
                is P -> drawPath(pathOf(s.d), color, style = style)
                is C -> drawCircle(color, radius = s.r, center = Offset(s.cx, s.cy), style = style)
            }
        }
    }
}
