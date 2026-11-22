package nl.markmaaktmedia.markupdate

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Wat de updater onthoudt: wanneer hij voor het laatst keek, welke versie de gebruiker "later" gaf en of er vanzelf gecontroleerd mag
 * worden. Een eigen klein bestand, zodat geen app er een eigen opslag voor hoeft te hebben.
 */
internal class UpdateStore(context: Context) {
    private val prefs = context.getSharedPreferences("markupdate", Context.MODE_PRIVATE)

    private val _dismissed = MutableStateFlow(prefs.getString(DISMISSED, null))
    /** De tag van de versie waar de gebruiker "later" voor koos; de kaart blijft weg tot er een nieuwere is. */
    val dismissed: StateFlow<String?> = _dismissed.asStateFlow()

    private val _autoCheck = MutableStateFlow(prefs.getBoolean(AUTO_CHECK, true))
    val autoCheck: StateFlow<Boolean> = _autoCheck.asStateFlow()

    var lastCheck: Long
        get() = prefs.getLong(LAST_CHECK, 0L)
        set(value) { prefs.edit().putLong(LAST_CHECK, value).apply() }

    /** De versie van de app de vorige keer dat hij startte; zo is te zien dat hij sindsdien is bijgewerkt. */
    var lastVersion: String?
        get() = prefs.getString(LAST_VERSION, null)
        set(value) { prefs.edit().putString(LAST_VERSION, value).apply() }

    fun dismiss(tag: String) {
        prefs.edit().putString(DISMISSED, tag).apply()
        _dismissed.value = tag
    }

    fun clearDismissed() {
        prefs.edit().remove(DISMISSED).apply()
        _dismissed.value = null
    }

    fun setAutoCheck(on: Boolean) {
        prefs.edit().putBoolean(AUTO_CHECK, on).apply()
        _autoCheck.value = on
    }

    private companion object {
        const val DISMISSED = "dismissed"
        const val AUTO_CHECK = "auto_check"
        const val LAST_CHECK = "last_check"
        const val LAST_VERSION = "last_version"
    }
}
