package nl.markmaaktmedia.markmysteps.next

import android.annotation.SuppressLint
import android.content.Context
import android.webkit.WebView
import android.webkit.WebViewClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue

/**
 * The store build replaces the old app, which was the web app in a WebView. That app kept its sign-in in the
 * WebView's localStorage (origin https://localhost, keys mms.server and mms.refresh). On the first start of this
 * app, once, if the old WebView data is there and nobody is signed in here, a WebView with that same origin is
 * opened off screen to read those two values, they are wiped from it straight away, and the refresh token is
 * traded at the server for a fresh sign-in. So people who update do not have to sign in again.
 *
 * Safe by construction: same package and same private data folder only (the WebView data is not reachable by any
 * other app), no network loads in that WebView, no JavaScript bridge, the page is an empty local string, it only
 * runs in the store build and only once, and nothing it reads is logged.
 */
object OldApp {
    private const val DONE = "oldAppMigrated"
    /** Set once the old sign-in was taken over, so the home page leaves the sign-in page for the app. */
    var adopted by androidx.compose.runtime.mutableStateOf(false)

    /** Whether the old app was used on this phone: its WebView kept data in our folder. */
    fun present(context: Context): Boolean = java.io.File(context.applicationInfo.dataDir, "app_webview").exists()

    /** What the old app kept, read from its WebView storage: null when the storage could not be read at all. */
    class Kept(val server: String?, val refresh: String?)

    /**
     * Opens a WebView with the old app's origin off screen and reads its sign-in. DOM storage must be switched on
     * for that: a WebView has it off by default, and then localStorage is simply not there (build 268 read
     * nothing, so everyone who updated had to sign in again).
     */
    @SuppressLint("SetJavaScriptEnabled")
    fun read(context: Context, onRead: (WebView, Kept?) -> Unit) {
        val web = WebView(context.applicationContext)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.blockNetworkLoads = true
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = false
        web.webViewClient = object : WebViewClient() {
            private var done = false
            override fun onPageFinished(view: WebView, url: String?) {
                if (done) return
                done = true
                view.evaluateJavascript(
                    "(function(){try{return JSON.stringify({ok:true,s:localStorage.getItem('mms.server'),r:localStorage.getItem('mms.refresh')})}catch(e){return JSON.stringify({ok:false})}})()",
                ) { raw ->
                    val found = runCatching { JSONObject(JSONObject("{\"v\":$raw}").getString("v")) }.getOrNull()
                    val kept = if (found?.optBoolean("ok") == true) {
                        Kept(
                            found.optString("s").takeIf { it.isNotBlank() && it != "null" },
                            found.optString("r").takeIf { it.isNotBlank() && it != "null" },
                        )
                    } else null
                    onRead(view, kept)
                }
            }
        }
        runCatching { web.loadDataWithBaseURL("https://localhost/", "<!doctype html><html></html>", "text/html", "utf-8", null) }
            .onFailure { onRead(web, null) }
    }

    /** The old WebView profile emptied as a whole (storage, cookies, cache) and the WebView destroyed. */
    private fun wipe(view: WebView) {
        runCatching { android.webkit.WebStorage.getInstance().deleteAllData() }
        runCatching { android.webkit.CookieManager.getInstance().removeAllCookies(null) }
        runCatching { view.clearCache(true); view.clearHistory() }
        runCatching { view.destroy() }
    }

    fun adopt(context: Context, onSignedIn: () -> Unit) {
        val prefs = context.getSharedPreferences("mms.next.ui", Context.MODE_PRIVATE)
        if (prefs.getBoolean(DONE, false) || Api.signedIn || !present(context)) return
        fun settle(view: WebView) { prefs.edit().putBoolean(DONE, true).apply(); wipe(view) }
        read(context) { view, kept ->
            // Not readable this time: leave everything as it is and try again on the next start.
            if (kept == null) { runCatching { view.destroy() }; return@read }
            val refresh = kept.refresh ?: run { settle(view); return@read }
            // The old server, if it was kept; only the default server when none was kept at all. A server that was
            // not https is skipped: the token is never sent over plain http.
            val server = when {
                kept.server == null -> "https://" + context.getString(R.string.link_host)
                kept.server.startsWith("https://") -> kept.server
                else -> { settle(view); return@read }
            }
            CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
                val result = Api.adopt(server, refresh)
                launch(Dispatchers.Main) {
                    when (result) {
                        true -> { settle(view); adopted = true; onSignedIn() }
                        // Turned down: the token is no good any more, so it goes.
                        false -> settle(view)
                        // No connection: kept, the next start tries again.
                        null -> runCatching { view.destroy() }
                    }
                }
            }
        }
    }

    /** Test only (dev build in test mode): writes a made-up sign-in as the old app did, then reads it back. */
    @SuppressLint("SetJavaScriptEnabled")
    fun probe(context: Context) {
        val web = WebView(context.applicationContext)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.blockNetworkLoads = true
        web.webViewClient = object : WebViewClient() {
            private var done = false
            override fun onPageFinished(view: WebView, url: String?) {
                if (done) return
                done = true
                view.evaluateJavascript("localStorage.setItem('mms.server','https://example.invalid');localStorage.setItem('mms.refresh','probe-token-123');'ok'") {
                    view.destroy()
                    read(context) { v, kept ->
                        android.util.Log.i("MmsOldApp", "readable=${kept != null} server=${kept?.server != null} refresh=${kept?.refresh?.length ?: 0}")
                        wipe(v)
                    }
                }
            }
        }
        web.loadDataWithBaseURL("https://localhost/", "<!doctype html><html></html>", "text/html", "utf-8", null)
    }
}
