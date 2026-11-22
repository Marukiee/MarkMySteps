package nl.markmaaktmedia.markmysteps.next

import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue

import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.layout.layout
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight

/** The three typefaces of the web app, as the same variable fonts. */
private fun variable(res: Int, weights: List<Int>) = FontFamily(
    weights.map { w ->
        Font(res, weight = FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w)))
    },
)

val Inter = variable(R.font.inter_var, listOf(400, 500, 550, 600, 650, 700))
val Fraunces = variable(R.font.fraunces_var, listOf(400, 500, 560, 600, 650))
val Outfit = variable(R.font.outfit_var, listOf(400, 500, 600, 620, 700, 800))

/**
 * The colour tokens of global.css, one to one, so the port starts from the
 * same values the web app uses (--paper, --ink, --accent and the rest).
 */
data class Palette(
    val dark: Boolean,
    val paper: Color,
    val raised: Color,
    val sunken: Color,
    val ink: Color,
    val inkSoft: Color,
    val inkFaint: Color,
    val line: Color,
    val accent: Color,
    val accentSoft: Color,
    val accentInk: Color,
    val teal: Color,
    val sphere: Color,
    val land: Color,
    val bow: Color,
    val glass: Color,
)

val LightPalette = Palette(
    dark = false,
    paper = Color(0xFFFAF6EF),
    raised = Color(0xFFFFFFFF),
    sunken = Color(0xFFF1EBE1),
    ink = Color(0xFF1E2A35),
    inkSoft = Color(0xFF51616F),
    inkFaint = Color(0xFF8B97A3),
    line = Color(0xFFE4DCCE),
    accent = Color(0xFFE8613C),
    accentSoft = Color(0xFFFBE9E2),
    accentInk = Color(0xFFC74A28),
    teal = Color(0xFF2A8F85),
    sphere = Color(0xFFEADFCE),
    land = Color(0xFFD8C9AD),
    bow = Color(0xD9697380),
    glass = Color(0xFFFFFFFF),
)

val DarkPalette = Palette(
    dark = true,
    paper = Color(0xFF14181D),
    raised = Color(0xFF1D242C),
    sunken = Color(0xFF0F141A),
    ink = Color(0xFFEEF1F4),
    inkSoft = Color(0xFFA7B2BD),
    inkFaint = Color(0xFF6D7A87),
    line = Color(0xFF2B333D),
    accent = Color(0xFFF0714D),
    accentSoft = Color(0xFF3A231A),
    accentInk = Color(0xFFF6926F),
    teal = Color(0xFF38A89C),
    sphere = Color(0xFF1A2028),
    land = Color(0xFF2D3742),
    bow = Color(0xE6A5AFBB),
    glass = Color(0xFF181E25),
)

val LocalPalette = staticCompositionLocalOf { LightPalette }

/**
 * Lets a horizontally scrolling row run to the screen's edges although its parent has a side
 * margin: the row is laid out [gutter] wider on both sides, and the caller pads its content by
 * the same amount, so the first item still lines up with everything else.
 */
fun androidx.compose.ui.Modifier.bleed(gutter: androidx.compose.ui.unit.Dp): androidx.compose.ui.Modifier =
    this.then(androidx.compose.ui.Modifier.layout { measurable, constraints ->
        val extra = gutter.roundToPx() * 2
        val width = constraints.maxWidth + extra
        val placeable = measurable.measure(constraints.copy(minWidth = width, maxWidth = width))
        layout(constraints.maxWidth, placeable.height) { placeable.place(-extra / 2, 0) }
    })

/** A title with a small, quiet "(bèta)" after it, as the web marks the photo book and the summary. */
fun betaTitle(title: String, color: androidx.compose.ui.graphics.Color, size: androidx.compose.ui.unit.TextUnit) =
    androidx.compose.ui.text.buildAnnotatedString {
        append(title)
        pushStyle(androidx.compose.ui.text.SpanStyle(fontFamily = Inter, fontWeight = androidx.compose.ui.text.font.FontWeight(700), fontSize = size, color = color))
        append(" (bèta)")
        pop()
    }

/**
 * A progress bar that glides: it never jumps to the next value or slips back, it eases towards it over a
 * moment, so a job reporting in steps still reads as one smooth fill.
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3ExpressiveApi::class)
@androidx.compose.runtime.Composable
fun SmoothProgress(value: Float, modifier: androidx.compose.ui.Modifier = androidx.compose.ui.Modifier) {
    var highest by androidx.compose.runtime.remember { androidx.compose.runtime.mutableFloatStateOf(0f) }
    highest = maxOf(highest, value.coerceIn(0f, 1f))
    val shown by androidx.compose.animation.core.animateFloatAsState(
        highest, androidx.compose.animation.core.tween(700, easing = androidx.compose.animation.core.LinearOutSlowInEasing), label = "progress",
    )
    androidx.compose.material3.LinearWavyProgressIndicator(progress = { shown }, modifier = modifier)
}
