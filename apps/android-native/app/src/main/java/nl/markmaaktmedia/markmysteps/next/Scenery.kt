package nl.markmaaktmedia.markmysteps.next

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import kotlin.math.PI
import kotlin.math.sin

/**
 * A drawn landscape standing in for a cover photo, so this test shows how a
 * trip with a photo looks (the blurred backdrop, the thumbnail, the big card)
 * without anybody's real photos in it. In the app these are Immich photos.
 */
@Composable
fun Scenery(scene: Scene, modifier: Modifier = Modifier) {
    Canvas(modifier) {
        when (scene) {
            Scene.Desert -> landscape(
                sky = listOf(Color(0xFFE9E4DC), Color(0xFFF2D9B3)), sun = Color(0xFFFFF4DE), sunAt = Offset(0.72f, 0.3f),
                layers = listOf(Color(0xFFB9A58C) to 0.55f, Color(0xFFD8A866) to 0.66f, Color(0xFFC48B45) to 0.8f, Color(0xFF6E7A3E) to 0.93f),
            )
            Scene.SunsetSea -> {
                landscape(
                    sky = listOf(Color(0xFFF7B267), Color(0xFFF79D3C), Color(0xFFE8763A)), sun = Color(0xFFFFF0C8), sunAt = Offset(0.66f, 0.42f),
                    layers = listOf(Color(0xFF8A4A2A) to 0.56f),
                )
                drawRect(Brush.verticalGradient(listOf(Color(0xFFD9822F), Color(0xFF6E3B1C)), startY = size.height * 0.6f), topLeft = Offset(0f, size.height * 0.6f))
                drawRect(Color(0x66FFE9B0), topLeft = Offset(size.width * 0.6f, size.height * 0.6f), size = androidx.compose.ui.geometry.Size(size.width * 0.12f, size.height * 0.4f))
                hills(Color(0xFF3B2414), 0.86f, 0.05f, 3f)
            }
            Scene.Snow -> landscape(
                sky = listOf(Color(0xFF8FB8DE), Color(0xFFCFE3F2)), sun = Color(0x00FFFFFF), sunAt = Offset(0.8f, 0.2f),
                layers = listOf(Color(0xFFE9EEF3) to 0.55f, Color(0xFFFFFFFF) to 0.7f, Color(0xFF4F5B66) to 0.9f),
            )
            Scene.Coast -> {
                landscape(
                    sky = listOf(Color(0xFF7FB6E6), Color(0xFFCDE6F5)), sun = Color(0xFFFFFBEA), sunAt = Offset(0.2f, 0.22f),
                    layers = listOf(Color(0xFF2F7FB0) to 0.58f),
                )
                hills(Color(0xFFC9A77C), 0.7f, 0.08f, 1.6f)
                hills(Color(0xFF7C8F4E), 0.82f, 0.06f, 2.4f)
            }
            Scene.Highlands -> landscape(
                sky = listOf(Color(0xFF9DB4C4), Color(0xFFD6E0E4)), sun = Color(0x00FFFFFF), sunAt = Offset(0.5f, 0.2f),
                layers = listOf(Color(0xFF7D8C93) to 0.5f, Color(0xFF5E7B5C) to 0.64f, Color(0xFF3F5E43) to 0.8f, Color(0xFF2B3F2D) to 0.94f),
            )
            Scene.Fjord -> {
                landscape(
                    sky = listOf(Color(0xFF6E9CC8), Color(0xFFBFD7EA)), sun = Color(0x00FFFFFF), sunAt = Offset(0.5f, 0.2f),
                    layers = listOf(Color(0xFF51656F) to 0.42f, Color(0xFF3A4E46) to 0.52f),
                )
                drawRect(Brush.verticalGradient(listOf(Color(0xFF3E6E8E), Color(0xFF1F3F55)), startY = size.height * 0.62f), topLeft = Offset(0f, size.height * 0.62f))
                hills(Color(0xFFB34A3A), 0.9f, 0.02f, 6f)
            }
            Scene.Mountains -> landscape(
                sky = listOf(Color(0xFF8AA7D6), Color(0xFFE0E8F4)), sun = Color(0xFFFFFFFF), sunAt = Offset(0.75f, 0.25f),
                layers = listOf(Color(0xFF9AA6B8) to 0.48f, Color(0xFF6E7C90) to 0.62f, Color(0xFF465566) to 0.8f),
            )
        }
    }
}

private fun DrawScope.landscape(sky: List<Color>, sun: Color, sunAt: Offset, layers: List<Pair<Color, Float>>) {
    drawRect(Brush.verticalGradient(sky))
    val c = Offset(size.width * sunAt.x, size.height * sunAt.y)
    drawCircle(Brush.radialGradient(listOf(sun.copy(alpha = sun.alpha * 0.55f), Color.Transparent), center = c, radius = size.minDimension * 0.45f), radius = size.minDimension * 0.45f, center = c)
    drawCircle(sun, radius = size.minDimension * 0.08f, center = c)
    layers.forEachIndexed { i, (color, at) -> hills(color, at, 0.07f - i * 0.012f, 1.3f + i * 0.9f) }
}

/** A band of soft hills from [at] (share of the height) to the bottom. */
private fun DrawScope.hills(color: Color, at: Float, height: Float, waves: Float) {
    val path = Path()
    val base = size.height * at
    path.moveTo(0f, size.height)
    val steps = 48
    for (i in 0..steps) {
        val x = size.width * i / steps
        val t = i.toFloat() / steps
        val y = base - size.height * height * (0.6f * sin((t * waves + at * 3) * PI.toFloat()) + 0.4f * sin((t * waves * 2.3f + at * 7) * PI.toFloat()))
        path.lineTo(x, y)
    }
    path.lineTo(size.width, size.height)
    path.close()
    drawPath(path, color)
}
