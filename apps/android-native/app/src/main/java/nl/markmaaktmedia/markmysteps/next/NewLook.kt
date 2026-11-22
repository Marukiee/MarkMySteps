package nl.markmaaktmedia.markmysteps.next

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import kotlinx.coroutines.launch

/**
 * Once, after the move to the new app: a short note that MarkMySteps has a new look and that everything else
 * stays the same. Remembered on the phone; the intent extra `newLook` shows it again for a preview.
 */
object NewLook {
    private var prefs: android.content.SharedPreferences? = null
    var show by mutableStateOf(false)
        private set
    /**
     * Only for people who already used MarkMySteps: someone who opens this version already signed in (the sign-in
     * came along from before) sees it once; someone who signs in for the first time in this version never does.
     */
    fun init(context: android.content.Context, force: Boolean) {
        val p = context.getSharedPreferences("mms.next.ui", android.content.Context.MODE_PRIVATE)
        prefs = p
        if (!p.contains("seenNewLook")) p.edit().putBoolean("seenNewLook", !Api.signedIn).apply()
        show = force || !p.getBoolean("seenNewLook", true)
    }
    fun seen() { show = false; prefs?.edit()?.putBoolean("seenNewLook", true)?.apply() }
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun NewLookDialog() {
    if (!NewLook.show) return
    val cs = MaterialTheme.colorScheme
    val motion = MaterialTheme.motionScheme
    // The compass turns once to its place as the card arrives.
    val turn = remember { Animatable(-160f) }
    val grow = remember { Animatable(0.9f) }
    LaunchedEffect(Unit) {
        launch { grow.animateTo(1f, motion.defaultSpatialSpec()) }
        turn.animateTo(0f, tween(900, easing = androidx.compose.animation.core.CubicBezierEasing(0.2f, 0f, 0f, 1f)))
    }
    Dialog(onDismissRequest = { NewLook.seen() }) {
        Column(
            Modifier.widthIn(max = 360.dp).fillMaxWidth().graphicsLayer { scaleX = grow.value; scaleY = grow.value }
                .clip(RoundedCornerShape(32.dp)).background(cs.surfaceContainerLow).padding(start = 24.dp, end = 24.dp, top = 28.dp, bottom = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            LineIcon(Glyphs.logo, cs.primary, size = 64.dp, stroke = 2.1f, modifier = Modifier.graphicsLayer { rotationZ = turn.value })
            Text(
                stringResource(R.string.newlook_title),
                textAlign = TextAlign.Center,
                style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 24.sp, lineHeight = 28.sp, letterSpacing = (-0.01).em, color = cs.onSurface),
                modifier = Modifier.padding(top = 18.dp),
            )
            Text(
                stringResource(R.string.newlook_text),
                textAlign = TextAlign.Center,
                style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 15.sp, lineHeight = 21.sp, color = cs.onSurfaceVariant),
                modifier = Modifier.padding(top = 10.dp),
            )
            Button(
                onClick = { NewLook.seen() },
                shapes = ButtonDefaults.shapes(),
                modifier = Modifier.padding(top = 24.dp).fillMaxWidth().height(52.dp),
            ) { Text(stringResource(R.string.newlook_ok), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 16.sp)) }
        }
    }
}
