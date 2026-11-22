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
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

/**
 * Test app: the MarkMySteps home page in Compose, in today's style and in a
 * proposal for a new one. A tap on the logo switches between them; the adb
 * extras "style" (current or new) and "theme" (light or dark) pick them at start,
 * and "trip" (an id from Demo.kt) opens that trip straight away.
 */
class MainActivity : ComponentActivity() {
    // Below Android 13 the chosen language is put on the screen's context here (Lang.kt).
    override fun attachBaseContext(newBase: android.content.Context) = super.attachBaseContext(Lang.wrap(newBase))

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // The store build takes no test extras (dry run, previews, fake update): another app could otherwise start it
        // with them and, for example, quietly stop every change from being saved. A link (the intent's data) stays.
        if (BuildConfig.STORE) intent?.replaceExtras(null as Bundle?)
        // The update card without a release, for a screenshot: "preview" runs the module's own fake 9.9.9 (it
        // downloads and installs nothing), "fail" the failure card, "clear" puts it away.
        intent?.getStringExtra("update")?.let { Updates.preview(it) }
        Api.init(applicationContext)
        // Updating from the old app: its sign-in comes along once (store build only), then the trips load.
        if (BuildConfig.STORE) OldApp.adopt(this) { kotlinx.coroutines.MainScope().launch { Data.load() } }
        DeepLink.linkHost = getString(R.string.link_host)
        // A share or trip link that opened the app: handled once the home page and the trips are there.
        if (savedInstanceState == null) intent?.takeIf { it.action == android.content.Intent.ACTION_VIEW }?.data?.let { DeepLink.pending = it }
        if (!BuildConfig.STORE && intent?.getBooleanExtra("dryRun", false) == true) {
            Api.dryRun = true
            // Said at start, so a test can check the flag took before it taps anything that writes.
            android.util.Log.i("MmsDryRun", "dry run on: writes are answered on the phone and never sent")
            MapDebug.ongoing = intent.getBooleanExtra("mapOngoing", false)
            MapDebug.openPoints = intent.getBooleanExtra("mapPoints", false)
            MapDebug.fakeLive = intent.getBooleanExtra("mapLive", false)
        }
        ThemePref.init(applicationContext)
        MapStylePref.init(applicationContext)
        CardSizePref.init(applicationContext)
        NewLook.init(applicationContext, force = intent?.getBooleanExtra("newLook", false) == true)
        AirportPref.init(applicationContext)
        TripFactsPref.init(applicationContext)
        UiPrefs.init(applicationContext)
        AppPrefs.init(applicationContext)
        Onboarding.init(applicationContext)
        LocalMode.init(applicationContext)
        PhotoDisk.init(applicationContext)
        DeviceMedia.init(applicationContext)
        Offline.init(applicationContext)
        Tracker.init(applicationContext)
        MapPhotosPref.init(applicationContext)
        // A trip that ended while the phone was in a pocket stops recording now, as on the web.
        Tracker.stopIfOver(applicationContext)
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
        lifecycle.addObserver(object : androidx.lifecycle.DefaultLifecycleObserver {
            // Back in the app: whatever waited for a connection goes out now (never in a dry run).
            override fun onResume(owner: androidx.lifecycle.LifecycleOwner) {
                lifecycleScope.launch { Offline.probe(); Offline.flush() }
            }
        })
        // Looks at screens that cannot be reached safely on a real account; none of them sends anything.
        val previews = Previews(
            invite = intent.getBooleanExtra("invitePreview", false),
            tempPassword = intent.getBooleanExtra("tempPassword", false),
            mfa = intent.getBooleanExtra("mfaPreview", false),
            access = intent.getBooleanExtra("accessPreview", false),
        )
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
                    if (which == "new") HomeNew(dark = dark, onLogoTap = flip, startTrip = startTrip, startPage = startPage, previews = previews) else HomeCurrent(onLogoTap = flip)
                }
            }
        }
    }

    /** A link tapped while the app was already open (singleTop): the same way in as at start. */
    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == android.content.Intent.ACTION_VIEW) intent.data?.let { DeepLink.pending = it }
    }
}

/** Screens a test opens to look at (adb extras); they never send anything. */
data class Previews(val invite: Boolean = false, val tempPassword: Boolean = false, val mfa: Boolean = false, val access: Boolean = false)
