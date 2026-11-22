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

    @SuppressLint("SetJavaScriptEnabled")
    fun adopt(context: Context, onSignedIn: () -> Unit) {
        val prefs = context.getSharedPreferences("mms.next.ui", Context.MODE_PRIVATE)
        if (prefs.getBoolean(DONE, false) || Api.signedIn || !present(context)) return
        prefs.edit().putBoolean(DONE, true).apply()
        val web = WebView(context.applicationContext)
        web.settings.javaScriptEnabled = true
        web.settings.blockNetworkLoads = true
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = false
        // After reading, the old WebView profile is emptied as a whole (storage, cookies, cache) and the WebView
        // is destroyed, on every path, so nothing of the old sign-in stays behind in it.
        fun finish(view: WebView) {
            runCatching { android.webkit.WebStorage.getInstance().deleteAllData() }
            runCatching { android.webkit.CookieManager.getInstance().removeAllCookies(null) }
            runCatching { view.clearCache(true); view.clearHistory() }
            runCatching { view.destroy() }
        }
        web.webViewClient = object : WebViewClient() {
            private var read = false
            override fun onPageFinished(view: WebView, url: String?) {
                if (read) return
                read = true
                view.evaluateJavascript("JSON.stringify({s: localStorage.getItem('mms.server'), r: localStorage.getItem('mms.refresh')})") { raw ->
                    finish(view)
                    val found = runCatching { JSONObject(JSONObject("{\"v\":$raw}").getString("v")) }.getOrNull() ?: return@evaluateJavascript
                    val refresh = found.optString("r").takeIf { it.isNotBlank() && it != "null" } ?: return@evaluateJavascript
                    // The old server, if it was kept; only the default server when none was kept at all. A server
                    // that was not https is skipped: the token is never sent over plain http.
                    val kept = found.optString("s").takeIf { it.isNotBlank() && it != "null" }
                    val server = when {
                        kept == null -> "https://" + context.getString(R.string.link_host)
                        kept.startsWith("https://") -> kept
                        else -> return@evaluateJavascript
                    }
                    CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
                        if (Api.adopt(server, refresh)) launch(Dispatchers.Main) { adopted = true; onSignedIn() }
                    }
                }
            }
        }
        runCatching { web.loadDataWithBaseURL("https://localhost/", "<!doctype html><html></html>", "text/html", "utf-8", null) }
            .onFailure { finish(web) }
    }
}
