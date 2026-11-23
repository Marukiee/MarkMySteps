package nl.markmaaktmedia.markmysteps.next

import android.graphics.Bitmap
import android.graphics.Canvas
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp
import com.caverock.androidsvg.SVG
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/*
 * A country's flag as the web app draws it: one flat set (the same SVG files),
 * 4:3, softly rounded corners and a hairline so white flags do not dissolve
 * into the page. The font's waving emoji flag only as a fallback for a code
 * the set does not have.
 */

private val cache = object : LruCache<String, Bitmap>(4 * 1024 * 1024) {
    override fun sizeOf(key: String, value: Bitmap) = value.allocationByteCount
}

/** "🇲🇦" to "ma"; a two-letter code stays as it is. */
fun flagCode(flag: String?): String? = TripFigures.codeOfFlag(flag)

@Composable
fun FlagIcon(flag: String?, height: Dp, modifier: Modifier = Modifier) {
    val code = flagCode(flag)
    val context = LocalContext.current
    val px = with(LocalDensity.current) { height.roundToPx() }.coerceAtLeast(8)
    val key = "$code/$px"
    val bitmap by produceState(cache.get(key), key) {
        if (value == null && code != null) value = withContext(Dispatchers.IO) {
            runCatching {
                val svg = SVG.getFromAsset(context.assets, "flags/$code.svg")
                val w = px * 4 / 3
                svg.setDocumentWidth(w.toFloat()); svg.setDocumentHeight(px.toFloat())
                Bitmap.createBitmap(w, px, Bitmap.Config.ARGB_8888).also { svg.renderToCanvas(Canvas(it)); cache.put(key, it) }
            }.getOrNull()
        }
    }
    val shape = RoundedCornerShape(height * 0.17f)
    val b = bitmap
    when {
        b != null -> Image(
            b.asImageBitmap(), null, contentScale = ContentScale.Crop,
            modifier = modifier.height(height).aspectRatio(4f / 3f).clip(shape).border(androidx.compose.ui.unit.Dp.Hairline, Color(0x1A0F1419), shape),
        )
        code != null && flag != null && flag.length > 2 -> Box(modifier.height(height).aspectRatio(4f / 3f).clip(shape).background(MaterialTheme.colorScheme.surfaceContainerHigh))
        flag != null -> Text(flag, fontSize = (height.value * 0.9f).sp, modifier = modifier)
    }
}
