package nl.markmaaktmedia.markupdate

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.util.Log
import androidx.annotation.DrawableRes

/**
 * Wat per app anders is. Meer niet: de rest van markupdate is in elke app dezelfde code.
 *
 * ```
 * MarkUpdate.init(this, MarkUpdateConfig(
 *     owner = "Marukiee", repo = "Keeper", apkAsset = "Keeper.apk",
 *     currentVersion = BuildConfig.VERSION_NAME, appName = "Keeper", notificationIcon = R.drawable.ic_stat_keeper,
 * ))
 * ```
 */
data class MarkUpdateConfig @JvmOverloads constructor(
    /** GitHub-eigenaar en -repo waar de releases staan. */
    val owner: String,
    val repo: String,
    /** Naam van het appbestand bij de release, bijvoorbeeld "Keeper.apk". De controlesom staat in "<naam>.sha256". */
    val apkAsset: String,
    /** De versie van de draaiende app, bijvoorbeeld `BuildConfig.VERSION_NAME`. Een achtervoegsel "-debug" telt niet mee. */
    val currentVersion: String,
    /** Voor de User-Agent en de tekst van de melding. */
    val appName: String,
    /** Het kleine icoon van de melding "klaar om te installeren" (een eenkleurig statusbalkicoon). */
    @param:DrawableRes val notificationIcon: Int,
    /** Hetzelfde kanaal als de app al had, zodat de instelling van de gebruiker blijft. */
    val notificationChannelId: String = "update",
    /** Bij het openen van de app wordt hooguit zo vaak gecontroleerd: elke controle wekt de radio. */
    val checkIntervalMs: Long = 6 * 60 * 60 * 1000L,
    /**
     * Het bestand in de repo (op de tag van de release) met de korte regels voor de kaart, per taal; zie [parseChangelogNotes]. Heeft de
     * repo het niet of is het niet te lezen, dan telt de releasetekst. Geef `null` als de app het niet heeft: dan wordt er niet naar gekeken.
     */
    val changelogPath: String? = "changelog.json",
    /** Wat de app zelf doet rond een installatie die hem sluit. Standaard niets. */
    val installHook: InstallHook? = null,
)

/**
 * Een haak voor wat een app zelf kan doen rond een update die hem sluit; Drip opent zich bijvoorbeeld weer via zijn toegankelijkheidsdienst.
 * Standaard doet de module niets en zegt de kaart "De app sluit zo even, daarna is hij bijgewerkt" (die tekst is per app te vervangen met
 * `UpdateCardStyle.installingSubtitle`). Alle functies hebben een lege standaard; een fout in een haak breekt de update niet af.
 */
interface InstallHook {
    /**
     * Vlak voordat het apk aan de installer gaat; de app kan binnen seconden sluiten. [inFront]: de app stond op het scherm (alleen dan is
     * het zinvol hem na de update weer te openen).
     */
    fun onInstallStarting(context: Context, release: ReleaseInfo, inFront: Boolean) {}

    /**
     * De installer meldde iets terwijl dit proces nog leeft: de installatie mislukte of werd afgebroken ([success] onwaar), of er kwam een
     * ander pakket binnen en deze app draait gewoon door ([success] waar, zoals bij een debug-build die de release neerzet). Maak ongedaan
     * wat [onInstallStarting] bewaarde. Wordt niet aangeroepen als deze app zelf vervangen werd: het proces is dan weg, zie [onUpdated].
     */
    fun onInstallFinished(context: Context, success: Boolean) {}

    /** De eerste start na een update: de versie is anders dan bij de vorige start. Draait in `MarkUpdate.init`, dus vroeg in `Application.onCreate` en voordat `MarkUpdate.get()` bestaat. */
    fun onUpdated(context: Context, previousVersion: String) {}
}

/**
 * Het ene exemplaar van de updater van dit proces. Zet het op in `Application.onCreate`: de ontvanger van de installer (die Android ook
 * wakker kan maken als de app niet draait) en de kaart gebruiken hetzelfde exemplaar.
 */
object MarkUpdate {
    @Volatile private var instance: MarkUpdater? = null

    /** Maakt de updater aan en zet het meldingskanaal klaar. Nog eens aanroepen geeft hetzelfde exemplaar terug. */
    @JvmStatic
    @Synchronized
    fun init(context: Context, config: MarkUpdateConfig): MarkUpdater {
        instance?.let { return it }
        val app = context.applicationContext
        createChannel(app, config.notificationChannelId)
        val store = UpdateStore(app)
        // De eerste start na een update (niet de allereerste start van de app): de haak mag er iets mee doen.
        val previous = store.lastVersion
        if (previous != null && previous != config.currentVersion) {
            runCatching { config.installHook?.onUpdated(app, previous) }.onFailure { Log.w("MarkUpdate", "installHook.onUpdated failed", it) }
        }
        store.lastVersion = config.currentVersion
        return MarkUpdater(app, config, store).also { instance = it }
    }

    /** De updater; [init] moet eerst gedraaid hebben. */
    @JvmStatic
    fun get(): MarkUpdater = instance ?: error("MarkUpdate.init(...) is nog niet aangeroepen, zet het in Application.onCreate")

    @JvmStatic
    fun getOrNull(): MarkUpdater? = instance

    private fun createChannel(context: Context, id: String) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(id, context.getString(R.string.markupdate_channel_name), NotificationManager.IMPORTANCE_DEFAULT)
                .apply { description = context.getString(R.string.markupdate_channel_description) },
        )
    }
}
