package nl.markmaaktmedia.markupdate

import android.app.ActivityManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import java.io.Closeable
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

/** Voor aanroepers in Java: krijgt elke nieuwe [UpdateState], op de hoofdthread. */
fun interface UpdateListener {
    fun onUpdateState(state: UpdateState)
}

/**
 * Zoekt de nieuwste release op GitHub en installeert hem desgevraagd over de draaiende app.
 *
 * Geen updatedienst en geen polling: de controle loopt als de app opent (hooguit elke [MarkUpdateConfig.checkIntervalMs]) en als de
 * gebruiker erom vraagt. De download wordt gecontroleerd tegen de SHA-256 bij de release en de installatie loopt via een
 * PackageInstaller-sessie, zodat Android latere updates zonder tweede scherm kan toepassen als dat mag.
 *
 * Bijwerken zonder eerst te de-installeren hangt af van dezelfde ondertekeningssleutel voor elke build. Android weigert een apk van
 * iemand anders, en dat maakt dit ook veilig: de download kan niet voor een andere app verwisseld worden.
 *
 * Alles wat tijd kost draait in een eigen scope van de updater, niet in die van een scherm: wisselen van scherm of tab breekt een
 * download dus niet af.
 */
class MarkUpdater internal constructor(
    private val context: Context,
    val config: MarkUpdateConfig,
    private val store: UpdateStore,
) {
    private val client = OkHttpClient()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val _state = MutableStateFlow<UpdateState>(UpdateState.Idle)
    val state: StateFlow<UpdateState> = _state.asStateFlow()

    /** De tag van de versie waar "Later" voor gekozen is. */
    val dismissed: StateFlow<String?> get() = store.dismissed

    /** Mag er vanzelf gecontroleerd worden als de app opent? Staat standaard aan; zet hem met [setAutoCheck]. */
    val autoCheck: StateFlow<Boolean> get() = store.autoCheck

    /** De versie van de draaiende app, zonder "v" en zonder "-debug". */
    val currentVersion: String get() = VersionComparator.normaliseCurrent(config.currentVersion)

    val releasesPageUrl: String get() = "https://github.com/${config.owner}/${config.repo}/releases"

    fun setAutoCheck(on: Boolean) = store.setAutoCheck(on)

    /** "Later": de kaart blijft voor deze versie weg tot er een nieuwere is. */
    fun dismiss(tag: String) = store.dismiss(tag)

    /** Bij het openen van de app: hooguit elke [MarkUpdateConfig.checkIntervalMs], en alleen als de gebruiker het niet uitzette. */
    suspend fun checkIfDue() {
        if (!store.autoCheck.value) return
        if (System.currentTimeMillis() - store.lastCheck < config.checkIntervalMs) return
        check(manual = false)
    }

    /**
     * [manual] is waar voor de knop. Een controle waar niemand om vroeg blijft stil als hij mislukt: een telefoon zonder verbinding of een
     * repo zonder releases is geen nieuws.
     */
    suspend fun check(manual: Boolean = true): ReleaseInfo? {
        // Een controle mag een download of installatie die bezig is niet wegvegen.
        when (val busy = _state.value) {
            is UpdateState.Downloading, is UpdateState.Installing, is UpdateState.NeedsPermission, is UpdateState.AwaitingConfirmation -> return null
            is UpdateState.ReadyToInstall -> return busy.release
            else -> Unit
        }
        _state.value = UpdateState.Checking
        val release = fetchLatest()
        store.lastCheck = System.currentTimeMillis()
        if (release == null) {
            _state.value = when {
                noReleaseYet -> UpdateState.UpToDate
                manual -> UpdateState.Failed(context.getString(R.string.markupdate_reason_unreachable))
                else -> UpdateState.Idle
            }
            return null
        }
        return if (VersionComparator.isNewer(release.versionName, currentVersion)) {
            // De regels voor de kaart alleen ophalen als ze nodig zijn: er is een nieuwere versie.
            val withNotes = release.copy(notes = fetchNotes(release))
            _state.value = UpdateState.Available(withNotes)
            withNotes
        } else {
            _state.value = UpdateState.UpToDate
            null
        }
    }

    /** Zoals [check] en [checkIfDue], voor aanroepers die geen coroutine hebben (Java). */
    @JvmOverloads
    fun checkAsync(manual: Boolean = true) { scope.launch { check(manual) } }

    fun checkIfDueAsync() { scope.launch { checkIfDue() } }

    /** Krijgt elke nieuwe toestand, op de hoofdthread, ook de huidige meteen. Sluit het resultaat om te stoppen. Voor aanroepers in Java. */
    fun addListener(listener: UpdateListener): Closeable {
        val job: Job = scope.launch(Dispatchers.Main) { state.collect { listener.onUpdateState(it) } }
        return Closeable { job.cancel() }
    }

    fun reset() {
        _state.value = UpdateState.Idle
    }

    /** GitHub antwoordde 404: er is nog niets gepubliceerd, en dat is geen mislukking. */
    @Volatile
    private var noReleaseYet = false

    private suspend fun fetchLatest(): ReleaseInfo? = withContext(Dispatchers.IO) {
        noReleaseYet = false
        val request = Request.Builder()
            .url("https://api.github.com/repos/${config.owner}/${config.repo}/releases/latest")
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header("User-Agent", "${config.appName}/${config.currentVersion}")
            .build()
        runCatching {
            client.newCall(request).execute().use { response ->
                if (response.code == 404) noReleaseYet = true
                if (!response.isSuccessful) return@use null
                parseRelease(response.body?.string().orEmpty(), config.apkAsset, releasesPageUrl)
            }
        }.getOrElse { error ->
            Log.w(TAG, "Could not read the releases feed", error)
            null
        }
    }

    /** `changelog.json` zoals het op de tag van [release] stond; leeg als de app het niet heeft of het niet te lezen is. */
    private suspend fun fetchNotes(release: ReleaseInfo): Map<String, List<String>> = withContext(Dispatchers.IO) {
        val path = config.changelogPath ?: return@withContext emptyMap()
        val request = Request.Builder()
            .url("https://raw.githubusercontent.com/${config.owner}/${config.repo}/${release.tag}/$path")
            .header("User-Agent", "${config.appName}/${config.currentVersion}")
            .build()
        runCatching {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) emptyMap() else parseChangelogNotes(response.body?.string().orEmpty(), release.versionName)
            }
        }.getOrElse { emptyMap() }
    }

    /**
     * Voor een ontwikkelbuild: toont een nepversie (9.9.9, 22 MB, twee regels tekst) en laat Bijwerken er doorheen lopen zonder iets echts
     * te downloaden of te installeren, zodat de kaart bekeken kan worden zonder echte release.
     */
    fun showPreview() {
        store.clearDismissed()
        _state.value = UpdateState.Available(
            ReleaseInfo(
                tag = PREVIEW_TAG, versionName = "9.9.9", title = "Preview",
                // Neutrale voorbeeldregels: dit komt in elke app op een schermafbeelding.
                body = "## What's new (English)\n\n- A faster start and smoother animations\n- Small fixes and a few improvements\n\n" +
                    "## Wat is nieuw (Nederlands)\n\n- Sneller starten en soepelere animaties\n- Kleine reparaties en verbeteringen",
                apkUrl = null, apkSizeBytes = 22_000_000, sha256Url = null, htmlUrl = "", publishedAt = "",
            ),
        )
    }

    /** Voor een ontwikkelbuild: toont de foutkaart met [reason]. */
    fun showFailurePreview(reason: String) {
        store.clearDismissed()
        _state.value = UpdateState.Failed(reason)
    }

    /** De release waar de gebruiker mee bezig is, zodat een mislukking kan aanbieden door te gaan. */
    @Volatile private var current: ReleaseInfo? = null

    /** De knop van de kaart: start downloaden en installeren, tenzij dat al loopt. */
    fun startUpdate(release: ReleaseInfo) {
        when (_state.value) {
            is UpdateState.Downloading, is UpdateState.Installing, is UpdateState.ReadyToInstall, is UpdateState.AwaitingConfirmation -> return
            else -> scope.launch { downloadAndInstall(release) }
        }
    }

    /** "Opnieuw" op de foutkaart. */
    fun startRetry() {
        scope.launch { retry() }
    }

    /** De gebruiker is terug van het scherm "onbekende apps installeren": gaat door in de eigen scope, zodat een schermwissel de download niet afbreekt. */
    fun resume() {
        scope.launch { resumeAfterPermission() }
    }

    /**
     * Downloadt, controleert en geeft het apk aan de installer. Eén tik voor de gebruiker.
     *
     * De schakelaar "onbekende apps installeren" wordt eerst gevraagd: het is een instellingenscherm waar de gebruiker doorheen moet, en
     * het is beter hem daar naartoe te sturen vóór een download dan erna.
     */
    private suspend fun downloadAndInstall(release: ReleaseInfo) {
        current = release
        if (release.tag == PREVIEW_TAG) {
            for (step in 0..40) {
                _state.value = UpdateState.Downloading(release, step / 40f)
                delay(90)
            }
            // Zoals het echt gaat: het installeert meteen, en de kaart gaat weg als de app zou sluiten.
            _state.value = UpdateState.ReadyToInstall(release, PREVIEW_TAG)
            delay(300)
            _state.value = UpdateState.Installing(release)
            delay(2600)
            _state.value = UpdateState.Idle
            return
        }
        if (!canRequestInstalls()) {
            _state.value = UpdateState.NeedsPermission(release)
            openInstallPermissionSettings()
            return
        }
        val file = download(release) ?: return
        install(release, file)
    }

    private suspend fun resumeAfterPermission() {
        val waiting = _state.value as? UpdateState.NeedsPermission ?: return
        if (!canRequestInstalls()) return
        val path = waiting.filePath
        if (path != null && File(path).exists()) install(waiting.release, File(path)) else downloadAndInstall(waiting.release)
    }

    private suspend fun retry() {
        val release = (_state.value as? UpdateState.Failed)?.release ?: current
        if (release != null) downloadAndInstall(release) else check()
    }

    private suspend fun download(release: ReleaseInfo): File? {
        val url = release.apkUrl ?: run {
            _state.value = UpdateState.Failed(context.getString(R.string.markupdate_reason_no_apk), release)
            return null
        }
        val target = File(updatesDir(), "${config.repo}-${release.versionName}.apk")
        // Een gedane download van een eerdere poging, bijvoorbeeld een die de installer annuleerde, wordt hergebruikt.
        if (release.apkSizeBytes > 0 && target.length() == release.apkSizeBytes) {
            _state.value = UpdateState.ReadyToInstall(release, target.absolutePath)
            return target
        }
        _state.value = UpdateState.Downloading(release, 0f)
        return withContext(Dispatchers.IO) {
            runCatching {
                val digest = MessageDigest.getInstance("SHA-256")
                client.newCall(Request.Builder().url(url).header("User-Agent", config.appName).build()).execute().use { response ->
                    if (!response.isSuccessful) error(context.getString(R.string.markupdate_reason_status, response.code))
                    val body = response.body ?: error(context.getString(R.string.markupdate_reason_empty))
                    val total = body.contentLength().takeIf { it > 0 } ?: release.apkSizeBytes
                    target.outputStream().use { output ->
                        body.byteStream().use { input ->
                            val buffer = ByteArray(64 * 1024)
                            var copied = 0L
                            var lastPercent = -1
                            while (true) {
                                currentCoroutineContext().ensureActive()
                                val read = input.read(buffer)
                                if (read == -1) break
                                output.write(buffer, 0, read)
                                digest.update(buffer, 0, read)
                                copied += read
                                // Alleen als het getal verandert, niet bij elk blok van 64 KB.
                                val percent = if (total > 0) (copied * 100 / total).toInt().coerceIn(0, 100) else -1
                                if (percent != lastPercent && percent >= 0) {
                                    lastPercent = percent
                                    _state.value = UpdateState.Downloading(release, percent / 100f)
                                }
                            }
                        }
                    }
                }
                release.sha256Url?.let { shaUrl ->
                    val expected = client.newCall(Request.Builder().url(shaUrl).build()).execute().use { it.body?.string().orEmpty() }
                        .trim().split(Regex("\\s+")).firstOrNull()?.lowercase()
                    val actual = digest.digest().joinToString("") { "%02x".format(it) }
                    check(expected == null || expected == actual) { context.getString(R.string.markupdate_reason_damaged) }
                }
                cleanUpOldDownloads(keepFileName = target.name)
                _state.value = UpdateState.ReadyToInstall(release, target.absolutePath)
                target
            }.getOrElse { error ->
                target.delete()
                Log.w(TAG, "download failed", error)
                _state.value = UpdateState.Failed(error.message ?: context.getString(R.string.markupdate_reason_unreachable), release)
                null
            }
        }
    }

    fun canRequestInstalls(): Boolean = context.packageManager.canRequestPackageInstalls()

    fun openInstallPermissionSettings() {
        val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
            .setData(Uri.parse("package:${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { context.startActivity(intent) }
    }

    /** Installeert via een PackageInstaller-sessie, zodat voortgang en fouten bij ons terugkomen. */
    private suspend fun install(release: ReleaseInfo, file: File) = withContext(Dispatchers.IO) {
        current = release
        if (!canRequestInstalls()) {
            _state.value = UpdateState.NeedsPermission(release, file.absolutePath)
            openInstallPermissionSettings()
            return@withContext
        }
        _state.value = UpdateState.Installing(release)
        runCatching {
            val installer = context.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
                setSize(file.length())
                // Zonder tweede tik, als Android het toestaat (de app is de installer van zichzelf); anders vraagt Android zelf.
                if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            }
            val id = installer.createSession(params)
            installer.openSession(id).use { session ->
                file.inputStream().use { input ->
                    session.openWrite("update.apk", 0, file.length()).use { output ->
                        input.copyTo(output, 64 * 1024)
                        session.fsync(output)
                    }
                }
                val intent = Intent(context, InstallResultReceiver::class.java).setAction(InstallResultReceiver.ACTION)
                val pending = PendingIntent.getBroadcast(context, id, intent, PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
                // De app kan nu binnen seconden sluiten: de haak van de app bewaart wat hij daarna nodig heeft.
                hookStarted = true
                runHook("onInstallStarting") { onInstallStarting(context, release, appIsInFront()) }
                session.commit(pending.intentSender)
            }
        }.onFailure { error ->
            Log.w(TAG, "install failed", error)
            finishHook(success = false)
            _state.value = UpdateState.Failed(error.message ?: context.getString(R.string.markupdate_reason_installer), release)
        }
    }

    /** Waar na [InstallHook.onInstallStarting] nog geen [InstallHook.onInstallFinished] op volgde. */
    @Volatile private var hookStarted = false

    private fun finishHook(success: Boolean) {
        if (!hookStarted) return
        hookStarted = false
        runHook("onInstallFinished") { onInstallFinished(context, success) }
    }

    /** Een fout in de haak van de app breekt de update niet af. */
    private inline fun runHook(name: String, call: InstallHook.() -> Unit) {
        val hook = config.installHook ?: return
        runCatching { hook.call() }.onFailure { Log.w(TAG, "installHook.$name failed", it) }
    }

    /** De installer zei nee, of de gebruiker stapte uit zijn scherm. Aangeroepen door [InstallResultReceiver]. */
    internal fun onInstallFailed(reason: String) {
        clearConfirmation()
        finishHook(success = false)
        _state.value = UpdateState.Failed(reason, current)
    }

    /**
     * De installer meldt succes. Bij een update van de app zelf is het proces al weg; leeft het nog (een ander pakket werd geïnstalleerd, zoals
     * een debug-build die de release als tweede app neerzet), dan gaat de kaart uit in plaats van op "Installeren…" te blijven staan.
     */
    internal fun onInstalled() {
        clearConfirmation()
        finishHook(success = true)
        _state.value = UpdateState.Idle
    }

    /** Het scherm van de installer dat vraagt "Deze app bijwerken?", bewaard tot de gebruiker hem beantwoord heeft. */
    @Volatile private var pendingConfirmation: Intent? = null
    @Volatile private var confirmationShown = false

    /**
     * De installer wil een tik. Staat de app voorin, dan opent de vraag meteen. Zo niet (de download duurde even en de gebruiker ging
     * weg), dan blokkeert Android een scherm dat zonder woorden over een andere app opent: de vraag wacht, een melding zegt dat de update klaar
     * staat, en zodra de app terug is opent de vraag zelf.
     */
    internal fun onConfirmationNeeded(confirm: Intent) {
        pendingConfirmation = confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        confirmationShown = false
        val release = current
        if (release != null) _state.value = UpdateState.AwaitingConfirmation(release)
        if (appIsInFront()) launchConfirmation() else notifyReady(confirm, release)
    }

    /** Opent de vraag van de installer. Aangeroepen met een tik op de balk, of als de app naar voren komt met een vraag in de wacht. */
    fun launchConfirmation() {
        val confirm = pendingConfirmation ?: return
        confirmationShown = true
        clearNotification()
        runCatching { context.startActivity(confirm) }.onFailure { Log.w(TAG, "could not open the installer", it) }
    }

    /** De app kwam naar voren: een vraag die wachtte wordt nu gesteld, één keer. */
    fun resumeConfirmation() {
        if (pendingConfirmation != null && !confirmationShown && _state.value is UpdateState.AwaitingConfirmation) launchConfirmation()
    }

    private fun clearConfirmation() {
        pendingConfirmation = null
        confirmationShown = false
        clearNotification()
    }

    /** Waar als iets van deze app op het scherm staat. Een voorgrondservice telt niet: die zie je niet. */
    private fun appIsInFront(): Boolean {
        val info = ActivityManager.RunningAppProcessInfo()
        ActivityManager.getMyMemoryState(info)
        return info.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
    }

    private fun notifyReady(confirm: Intent, release: ReleaseInfo?) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
        val open = PendingIntent.getActivity(context, NOTIFICATION_ID, confirm, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = NotificationCompat.Builder(context, config.notificationChannelId)
            .setSmallIcon(config.notificationIcon)
            .setContentTitle(context.getString(R.string.markupdate_ready_title, config.appName, release?.versionName.orEmpty()))
            .setContentText(context.getString(R.string.markupdate_ready_text))
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification) }
    }

    private fun clearNotification() {
        runCatching { NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID) }
    }

    private fun cleanUpOldDownloads(keepFileName: String? = null) {
        runCatching { updatesDir().listFiles()?.forEach { if (it.name != keepFileName) it.delete() } }
    }

    private fun updatesDir(): File = File(context.cacheDir, "markupdate").apply { mkdirs() }

    private companion object {
        const val TAG = "MarkUpdate"
        const val PREVIEW_TAG = "preview"
        const val NOTIFICATION_ID = 4017
    }
}
