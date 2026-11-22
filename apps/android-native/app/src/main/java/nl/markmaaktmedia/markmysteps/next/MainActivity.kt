package nl.markmaaktmedia.markmysteps.next

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue

/**
 * Test app: the MarkMySteps home page in Compose, in today's style and in a
 * proposal for a new one. A tap on the logo switches between them; the adb
 * extras "style" (current or new) and "theme" (light or dark) pick them at start,
 * and "trip" (an id from Demo.kt) opens that trip straight away.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Api.init(applicationContext)
        if (intent?.getBooleanExtra("dryRun", false) == true) Api.dryRun = true
        ThemePref.init(applicationContext)
        MapStylePref.init(applicationContext)
        CardSizePref.init(applicationContext)
        AirportPref.init(applicationContext)
        TripFactsPref.init(applicationContext)
        UiPrefs.init(applicationContext)
        Tracker.init(applicationContext)
        // The airport list in the background, so Voorkeuren opens complete.
        Thread { Airports.load(applicationContext) }.start()
        if (!Api.dryRun) Tracker.autoStart(applicationContext)
        Photos.initRatios(applicationContext)
        // The start screen (the orange compass) stays until there are trips to show: with trips kept from last
        // time that is at once; on a first start it waits for the server, and the compass needle starts turning.
        val started = System.currentTimeMillis()
        val content = findViewById<android.view.View>(android.R.id.content)
        content.viewTreeObserver.addOnPreDrawListener(object : android.view.ViewTreeObserver.OnPreDrawListener {
            override fun onPreDraw(): Boolean {
                val waiting = Api.signedIn && Data.all.isEmpty() && Data.loading && System.currentTimeMillis() - started < 8000
                if (waiting) { content.postDelayed({ content.invalidate() }, 120); return false }
                content.viewTreeObserver.removeOnPreDrawListener(this)
                return true
            }
        })
        val startStyle = intent.getStringExtra("style") ?: "new"
        val forcedTheme = intent.getStringExtra("theme")
        val startTrip = intent.getStringExtra("trip")
        val startPage = intent.getStringExtra("page")
        setContent {
            val system = isSystemInDarkTheme()
            val dark = when (forcedTheme) {
                "dark" -> true
                "light" -> false
                else -> when (ThemePref.mode) { 0 -> false; 1 -> true; else -> system }
            }
            var style by rememberSaveable { mutableStateOf(startStyle) }
            enableEdgeToEdge(
                statusBarStyle = if (dark) SystemBarStyle.dark(0) else SystemBarStyle.light(0, 0),
                navigationBarStyle = if (dark) SystemBarStyle.dark(0) else SystemBarStyle.light(0, 0),
            )
            CompositionLocalProvider(LocalPalette provides if (dark) DarkPalette else LightPalette) {
                Crossfade(style, animationSpec = tween(300), label = "style") { which ->
                    // The old look for comparing, only with the invented trips; signed in it is never one tap away.
                    val flip = { if (!Data.live) style = if (style == "current") "new" else "current" }
                    if (which == "new") HomeNew(dark = dark, onLogoTap = flip, startTrip = startTrip, startPage = startPage) else HomeCurrent(onLogoTap = flip)
                }
            }
        }
    }
}
