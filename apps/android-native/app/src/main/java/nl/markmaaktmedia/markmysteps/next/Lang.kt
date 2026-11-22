package nl.markmaaktmedia.markmysteps.next

import android.app.Activity
import android.app.LocaleManager
import android.content.Context
import android.content.res.Configuration
import android.os.Build
import android.os.LocaleList
import androidx.annotation.StringRes
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/**
 * The language of the app: Dutch or English, as the web app has them. "system" follows the phone, and a phone in
 * another language gets English, as on the web. The words themselves live in res/values (English) and
 * res/values-nl (Dutch).
 *
 * Android 13 and later keep the choice themselves (it also shows under the phone's own app languages); below
 * that it is kept here and every context is wrapped in it.
 */
object Lang {
    const val SYSTEM = "system"
    private const val KEY = "lang"
    private lateinit var app: Context

    /** "system", "nl" or "en". */
    var setting by mutableStateOf(SYSTEM); private set

    fun init(context: Context) {
        app = context.applicationContext
        setting = if (Build.VERSION.SDK_INT >= 33) {
            app.getSystemService(LocaleManager::class.java)?.applicationLocales?.takeIf { !it.isEmpty }?.get(0)?.language ?: SYSTEM
        } else prefs(app).getString(KEY, SYSTEM) ?: SYSTEM
    }

    private fun prefs(c: Context) = c.getSharedPreferences("mms.next.ui", Context.MODE_PRIVATE)

    /** For attachBaseContext below Android 13: the context in the chosen language. */
    fun wrap(base: Context): Context {
        if (Build.VERSION.SDK_INT >= 33) return base
        val tag = prefs(base).getString(KEY, SYSTEM) ?: SYSTEM
        if (tag == SYSTEM) return base
        val config = Configuration(base.resources.configuration).apply { setLocales(LocaleList.forLanguageTags(tag)) }
        return base.createConfigurationContext(config)
    }

    /** Switches the language; the screen is built again in it, keeping where you were. */
    fun choose(activity: Activity?, tag: String) {
        if (tag == setting) return
        setting = tag
        prefs(app).edit().putString(KEY, tag).apply()
        if (Build.VERSION.SDK_INT >= 33) {
            app.getSystemService(LocaleManager::class.java)?.applicationLocales =
                if (tag == SYSTEM) LocaleList.getEmptyLocaleList() else LocaleList.forLanguageTags(tag)
        } else activity?.recreate()
    }

    /** The language the app speaks now: "nl" or "en". */
    val current: String get() = if (::app.isInitialized && text(R.string.lang_code) == "nl") "nl" else "en"

    val dutch: Boolean get() = current == "nl"

    /** For dates and country names on screen: Dutch, or British English so the week starts on Monday as well. */
    val locale: java.util.Locale get() = java.util.Locale.forLanguageTag(if (dutch) "nl-NL" else "en-GB")

    /** A word outside a composable (a notification, an error from the server line). */
    fun text(@StringRes id: Int, vararg args: Any): String {
        val res = (if (Build.VERSION.SDK_INT >= 33) app else wrap(app)).resources
        return if (args.isEmpty()) res.getString(id) else res.getString(id, *args)
    }

    /** A counted word: "1 foto", "3 foto's". */
    fun plural(@androidx.annotation.PluralsRes id: Int, count: Int, vararg args: Any): String {
        val res = (if (Build.VERSION.SDK_INT >= 33) app else wrap(app)).resources
        return res.getQuantityString(id, count, *(if (args.isEmpty()) arrayOf<Any>(count) else args))
    }
}
