package nl.markmaaktmedia.markmysteps.next

import android.content.Context
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import nl.markmaaktmedia.markupdate.MarkUpdate
import nl.markmaaktmedia.markupdate.MarkUpdateConfig
import nl.markmaaktmedia.markupdate.MarkUpdater
import nl.markmaaktmedia.markupdate.ReleaseInfo
import nl.markmaaktmedia.markupdate.UpdateState
import nl.markmaaktmedia.markupdate.ui.UpdateCard
import nl.markmaaktmedia.markupdate.ui.UpdateCardStyle

/**
 * The app's side of the shared updater (markupdate, a copy of Keeper's module: never changed here).
 *
 * Where it looks comes from the build (BuildConfig.UPDATE_REPO and UPDATE_ASSET, see app/build.gradle.kts), so it
 * can be pointed at the native release later without touching code. The releases of Marukiee/MarkMySteps also carry
 * the old web app (markmysteps.apk, another package), and the shared parser takes any .apk when the named one is
 * missing; so a release is only ever offered when its apk has exactly the configured name. Anything else counts as
 * "nothing new", and the dev build can never install the web app over itself.
 *
 * Like the web app's bridge, the version compared is the build number (versionCode): releases are tagged v<build>.
 */
object Updates {
    private val asset = BuildConfig.UPDATE_ASSET

    val updater: MarkUpdater? get() = MarkUpdate.getOrNull()

    fun init(context: Context) {
        val repo = BuildConfig.UPDATE_REPO.trim()
        if (!repo.contains('/')) return
        val code = runCatching { context.packageManager.getPackageInfo(context.packageName, 0).longVersionCode }.getOrDefault(0L)
        MarkUpdate.init(
            context,
            MarkUpdateConfig(
                owner = repo.substringBefore('/'), repo = repo.substringAfter('/'), apkAsset = asset,
                currentVersion = code.toString(), appName = "MarkMySteps",
                notificationIcon = R.drawable.ic_stat_compass,
                // This repo has no changelog.json: the card takes its lines from the release text.
                changelogPath = null,
                // Two minutes, not the module's six hours: releases come several times a day, and opening the app
                // after one has to show the card (Mark). Ten minutes still missed one opened just after a quick look.
                // GitHub allows 60 unsigned calls an hour; this is at most 30.
                checkIntervalMs = 2 * 60 * 1000L,
            ),
        )
    }

    /** Only a release with exactly our apk, or the card's own preview. */
    fun allowed(release: ReleaseInfo): Boolean =
        release.tag == "preview" || release.apkUrl?.substringBefore('?')?.substringAfterLast('/') == asset

    /** A release that is not ours goes back to nothing, before anything can offer it. */
    private fun guard(u: MarkUpdater) {
        val s = u.state.value
        if (s is UpdateState.Available && !allowed(s.release)) u.reset()
    }

    /** When the app comes to the front: at most every two minutes (see init). */
    suspend fun checkIfDue() {
        val u = updater ?: return
        runCatching { u.checkIfDue() }
        guard(u)
    }

    /** What "Nu controleren" found. */
    enum class Found { New, Latest, Failed, Off }

    suspend fun checkNow(): Found {
        val u = updater ?: return Found.Off
        val release = runCatching { u.check(manual = true) }.getOrNull()
        guard(u)
        return when {
            release != null && allowed(release) -> Found.New
            u.state.value is UpdateState.Failed -> Found.Failed
            else -> Found.Latest
        }
    }

    /** For a screenshot of the card without a release: the module's own preview (downloads and installs nothing). */
    fun preview(kind: String) {
        val u = updater ?: return
        when (kind) {
            "preview" -> u.showPreview()
            "fail" -> u.showFailurePreview(Lang.text(R.string.update_preview_fail))
            "clear" -> u.reset()
        }
    }
}

/** The shared update card at the top of the homepage, in the shape of the cards around it. */
@Composable
fun MmsUpdateCard(modifier: Modifier = Modifier) {
    val u = Updates.updater ?: return
    val state by u.state.collectAsState()
    val s = state
    if (s is UpdateState.Available && !Updates.allowed(s.release)) {
        LaunchedEffect(s) { u.reset() }
        return
    }
    UpdateCard(modifier, style = UpdateCardStyle(shape = RoundedCornerShape(28.dp)))
}
