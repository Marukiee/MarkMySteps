package nl.markmaaktmedia.markmysteps.next

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

/*
 * The app-level pieces of Instellingen and the app's frame: language and navigation bar in Weergave, the
 * photo cache in Gegevens, updates and Wat is er nieuw in Over, the hidden developer page, the offline banner
 * and the photos linked from this phone in Reisinstellingen.
 */

/** Angle brackets, for the developer page. */
val GlyphCode = listOf(P("m16 18 6-6-6-6"), P("m8 6-6 6 6 6"))

// Weergave.

@Composable
fun LanguagePanel() {
    val activity = LocalContext.current as? android.app.Activity
    Header(stringResource(R.string.lang_title))
    Panel {
        // The names of the languages in their own language, so someone who cannot read the current one still finds theirs.
        Choices(listOf(Lang.SYSTEM to stringResource(R.string.common_system), "nl" to "Nederlands", "en" to "English"), Lang.setting, { Lang.choose(activity, it) })
        Hint(stringResource(R.string.lang_hint))
    }
}

@Composable
fun NavBarPanel() {
    Header(stringResource(R.string.nav_title))
    Panel {
        Choices(listOf(false to stringResource(R.string.nav_auto), true to stringResource(R.string.nav_always)), AppPrefs.navBarAlways, { AppPrefs.changeNavBarAlways(it) })
        Hint(stringResource(R.string.nav_hint))
    }
}

// Gegevens.

private fun megabytes(mb: Int) = if (mb >= 1000 && mb % 1000 == 0) "${mb / 1000} GB" else "$mb MB"

private fun sizeText(b: Long): String = when {
    b >= 1_000_000_000 -> String.format(java.util.Locale.getDefault(), "%.1f GB", b / 1e9)
    b >= 1_000_000 -> "${b / 1_000_000} MB"
    b >= 1_000 -> "${b / 1_000} kB"
    else -> "$b B"
}

/** The web's PhotoCacheSection: how full the cache on disk is, the ceiling (250 MB, 1 GB, no limit or your own) and clearing it. */
@Composable
fun PhotoCachePanel() {
    val cs = MaterialTheme.colorScheme
    var used by remember { mutableStateOf(-1L) }
    var confirm by remember { mutableStateOf(false) }
    val presets = listOf(250, 1000)
    var custom by remember { mutableStateOf(AppPrefs.photoCacheMb != 0 && AppPrefs.photoCacheMb !in presets) }
    var customText by remember { mutableStateOf(AppPrefs.photoCacheMb.toString()) }
    val scope = rememberCoroutineScope()
    fun measure() = scope.launch { used = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { PhotoDisk.usedBytes() } }
    LaunchedEffect(AppPrefs.photoCacheMb) { delay(if (used < 0) 0 else 1700); measure() }
    Header(stringResource(R.string.cache_title))
    Panel {
        val limit = AppPrefs.photoCacheMb
        val filled = if (limit > 0 && used > 0) (used.toFloat() / (limit * 1024f * 1024f)).coerceIn(0f, 1f) else 0f
        MeterBar(filled, Modifier.fillMaxWidth().height(8.dp), color = if (filled > 0.9f) cs.error else cs.primary)
        Hint(
            if (used < 0) " " else if (limit > 0) stringResource(R.string.cache_usage, sizeText(used), megabytes(limit))
            else stringResource(R.string.cache_usage_no_limit, sizeText(used)),
        )
        Text(stringResource(R.string.cache_max), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(start = 6.dp))
        val choice = when { custom -> -2; else -> limit }
        Choices(
            presets.map { it to megabytes(it) } + listOf(0 to stringResource(R.string.cache_no_limit), -2 to stringResource(R.string.cache_custom_short)),
            choice,
            { v -> if (v == -2) { custom = true; customText = limit.takeIf { it > 0 }?.toString() ?: "500" } else { custom = false; AppPrefs.changePhotoCacheMb(v) } },
        )
        AnimatedVisibility(custom, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
            FormField(stringResource(R.string.cache_custom), customText, { t ->
                customText = t.filter { it.isDigit() }.take(5)
                customText.toIntOrNull()?.takeIf { it >= 20 }?.let { AppPrefs.changePhotoCacheMb(it) }
            }, type = KeyboardType.Number)
        }
        Hint(stringResource(R.string.cache_help))
        SoftButton(stringResource(R.string.cache_clear), { confirm = true }, Modifier.fillMaxWidth(), icon = Glyphs.trash, enabled = used > 0 || Photos.usedBytes() > 0)
    }
    if (confirm) Confirm(
        stringResource(R.string.cache_clear_title), stringResource(R.string.cache_clear_body), stringResource(R.string.cache_clear_confirm),
        onConfirm = { Photos.clear(); measure() }, onDismiss = { confirm = false },
    )
}

/** A thin meter that glides to its value, down as well as up (SmoothProgress only ever grows). */
@Composable
fun MeterBar(value: Float, modifier: Modifier = Modifier, color: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.primary) {
    val shown by androidx.compose.animation.core.animateFloatAsState(value, MaterialTheme.motionScheme.slowSpatialSpec(), label = "progress")
    Box(modifier.clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainerHighest)) {
        Box(Modifier.fillMaxWidth(shown.coerceIn(0f, 1f)).height(100.dp).clip(CircleShape).background(color))
    }
}

// Over.

/** Updates in Over: check now, and whether the app looks by itself when it opens. */
@Composable
fun UpdatePanel() {
    val u = Updates.updater
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    val build = rememberBuild()
    val auto = u?.autoCheck?.collectAsState()
    val newText = stringResource(R.string.update_available, "%s")
    val latestText = stringResource(R.string.update_latest, build.second)
    val failText = stringResource(R.string.update_failed)
    val offText = stringResource(R.string.update_off)
    Group(stringResource(R.string.update_title), listOfNotNull(
        Item(Glyphs.download, stringResource(if (busy) R.string.update_checking else R.string.update_check), null, plain = true, enabled = !busy, action = {
            busy = true; result = null
            scope.launch {
                val found = Updates.checkNow()
                val state = u?.state?.value
                result = when (found) {
                    Updates.Found.New -> newText.format((state as? nl.markmaaktmedia.markupdate.UpdateState.Available)?.release?.versionName ?: "") to false
                    Updates.Found.Latest -> latestText to false
                    Updates.Found.Failed -> failText to true
                    Updates.Found.Off -> offText to false
                }
                busy = false
            }
        }),
        if (u != null && auto != null) Item(Glyphs.bell, stringResource(R.string.update_auto), stringResource(R.string.update_auto_hint), toggle = auto.value, action = { u.setAutoCheck(!auto.value) }) else null,
    ))
    Note(result?.first, error = result?.second == true, feel = null)
}

@Composable
fun rememberBuild(): Pair<String, String> {
    val context = LocalContext.current
    return remember {
        runCatching { context.packageManager.getPackageInfo(context.packageName, 0).let { (it.versionName ?: "") to it.longVersionCode.toString() } }.getOrDefault("" to "")
    }
}

/** The version line in Over: five taps open the developer page, with a short count and a light tick per tap. */
@Composable
fun VersionTaps(version: String, content: @Composable (Modifier) -> Unit) {
    val haptics = rememberHaptics()
    var taps by remember { mutableIntStateOf(0) }
    var note by remember { mutableStateOf<String?>(null) }
    var stamp by remember { mutableIntStateOf(0) }
    val unlocked = stringResource(R.string.dev_unlocked)
    val res = LocalContext.current.resources
    Column {
        content(Modifier.dip {
            if (AppPrefs.developer) { note = unlocked; stamp++; return@dip }
            taps++
            if (taps >= 5) { AppPrefs.changeDeveloper(true); haptics(Haptic.Confirm); note = unlocked; taps = 0 }
            else { haptics(Haptic.Tick); if (taps >= 2) note = res.getQuantityString(R.plurals.dev_taps, 5 - taps, 5 - taps) }
            stamp++
        })
        LaunchedEffect(stamp) { if (note != null) { delay(2200); note = null; if (!AppPrefs.developer) taps = 0 } }
        Box(Modifier.padding(start = 10.dp)) { Note(note, feel = null) }
    }
}

/** The web's ChangelogPanel: every release, newest first, its new things, improvements and fixes. */
@Composable
fun WhatsNewPage(onBack: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val context = LocalContext.current
    val dutch = Lang.dutch
    val entries = remember(dutch) {
        runCatching {
            val all = JSONObject(context.assets.open("changelog.json").bufferedReader().readText())
            val a = all.getJSONArray(if (dutch) "nl" else "en")
            (0 until a.length()).map { a.getJSONObject(it) }
        }.getOrDefault(emptyList())
    }
    SettingsScaffold(stringResource(R.string.whatsnew_title), onBack) {
        Spacer(Modifier.height(8.dp))
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            entries.forEach { e ->
                Panel {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(e.optString("title"), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 19.sp, color = cs.onSurface))
                            Text(shortDate(e.optString("date")), style = ValueStyle.copy(color = cs.onSurfaceVariant))
                        }
                        if (e.optBoolean("highlight")) Text(
                            stringResource(R.string.whatsnew_badge),
                            style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 12.sp, color = cs.onPrimary),
                            modifier = Modifier.clip(CircleShape).background(cs.primary).padding(horizontal = 10.dp, vertical = 4.dp),
                        )
                    }
                    listOf("new" to R.string.whatsnew_new, "better" to R.string.whatsnew_better, "fixed" to R.string.whatsnew_fixed).forEach { (k, label) ->
                        val list = e.optJSONArray(k) ?: return@forEach
                        if (list.length() == 0) return@forEach
                        Text(stringResource(label), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 14.sp, color = cs.primary), modifier = Modifier.padding(top = 4.dp))
                        for (i in 0 until list.length()) Row {
                            Box(Modifier.padding(top = 7.dp, end = 10.dp).size(5.dp).clip(CircleShape).background(cs.onSurfaceVariant))
                            Text(list.getString(i), style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 14.sp, lineHeight = 20.sp, color = cs.onSurface))
                        }
                    }
                }
            }
        }
    }
}

/**
 * The hidden developer page, as the web's developer tab and what a native build needs on top: whether dry
 * run is on, the real screens of a new user as previews, the update card, the one-time notes, the offline
 * queue, the build, and the last server errors to copy.
 */
@Composable
fun DeveloperPage(onBack: () -> Unit, onPreview: (String) -> Unit) {
    val context = LocalContext.current
    val build = rememberBuild()
    var confirmQueue by remember { mutableStateOf(false) }
    var errors by remember { mutableStateOf(ApiLog.text()) }
    var copied by remember { mutableStateOf<String?>(null) }
    val copiedText = stringResource(R.string.common_copied)
    LaunchedEffect(copied) { if (copied != null) { delay(1800); copied = null } }
    SettingsScaffold(stringResource(R.string.dev_title), onBack) {
        Header(stringResource(R.string.dev_dryrun), top = true)
        Panel { Hint(stringResource(if (Api.dryRun) R.string.dev_dryrun_on else R.string.dev_dryrun_off)) }

        Header(stringResource(R.string.dev_screens))
        Group(null, listOf(
            Item(Glyphs.logo, stringResource(R.string.dev_screen_onboarding), action = { onPreview("onboarding") }),
            Item(Glyphs.photo, stringResource(R.string.dev_screen_onboarding_local), action = { onPreview("onboarding-local") }),
            Item(Glyphs.lock, stringResource(R.string.dev_screen_login), action = { onPreview("login") }),
            Item(Glyphs.person, stringResource(R.string.dev_screen_register), action = { onPreview("register") }),
            Item(Glyphs.hourglass, stringResource(R.string.dev_screen_pending), action = { onPreview("pending") }),
        ))
        Hint(stringResource(R.string.dev_screens_hint), Modifier.padding(horizontal = 6.dp, vertical = 6.dp))

        Header(stringResource(R.string.dev_update))
        Panel {
            Hint(stringResource(R.string.dev_update_source, BuildConfig.UPDATE_REPO.ifBlank { "-" }, BuildConfig.UPDATE_ASSET, build.second))
            ButtonRow {
                SoftButton(stringResource(R.string.dev_update_preview), { Updates.preview("preview") }, Modifier.weight(1f))
                SoftButton(stringResource(R.string.dev_update_fail), { Updates.preview("fail") }, Modifier.weight(1f))
            }
            SoftButton(stringResource(R.string.dev_update_clear), { Updates.preview("clear") }, Modifier.fillMaxWidth())
            Hint(stringResource(R.string.dev_update_preview_hint))
        }
        UpdatePanel()

        Header(stringResource(R.string.dev_look))
        Group(null, listOf(
            Item(Glyphs.sun, stringResource(R.string.dev_look_show), plain = true, action = { NewLook.again() }),
            Item(Glyphs.trash, stringResource(R.string.dev_cards_reset), plain = true, enabled = CardSizePref.overrides.isNotEmpty(), action = { CardSizePref.clear() }),
        ))

        Header(stringResource(R.string.dev_queue))
        Panel {
            Hint(if (Offline.count == 0) "0" else pluralStringResource(R.plurals.offline_pending, Offline.count, Offline.count))
            SoftButton(stringResource(R.string.dev_queue_clear), { confirmQueue = true }, Modifier.fillMaxWidth(), icon = Glyphs.trash, enabled = Offline.count > 0)
        }

        Header(stringResource(R.string.dev_app))
        Panel { Hint(stringResource(R.string.dev_app_info, build.first, build.second, context.packageName)) }

        Header(stringResource(R.string.dev_errors))
        Panel {
            Text(
                errors.ifBlank { stringResource(R.string.dev_errors_none) },
                style = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 11.5.sp, lineHeight = 16.sp, color = MaterialTheme.colorScheme.onSurface),
            )
            Hint(stringResource(R.string.dev_errors_hint))
            SoftButton(stringResource(R.string.common_copy), {
                errors = ApiLog.text()
                (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("MarkMySteps", errors))
                copied = copiedText
            }, Modifier.fillMaxWidth(), enabled = errors.isNotBlank())
            Note(copied)
        }

        Header(stringResource(R.string.dev_hide))
        Panel {
            Hint(stringResource(R.string.dev_hide_hint))
            SoftButton(stringResource(R.string.dev_hide), { AppPrefs.changeDeveloper(false); onBack() }, Modifier.fillMaxWidth())
        }
    }
    if (confirmQueue) Confirm(
        stringResource(R.string.dev_queue_clear_title), stringResource(R.string.dev_queue_clear_body), stringResource(R.string.dev_queue_clear),
        onConfirm = { Offline.clear() }, onDismiss = { confirmQueue = false },
    )
}

// The app's frame.

/**
 * The web's OfflineBanner: while the server cannot be reached, a strip at the top says so, with how many
 * changes wait on the phone. It can be put away for this outage; the next one says it again.
 */
@Composable
fun OfflineBanner(modifier: Modifier = Modifier) {
    val cs = MaterialTheme.colorScheme
    var dismissed by remember { mutableStateOf(false) }
    LaunchedEffect(Offline.reachable) { if (Offline.reachable) dismissed = false }
    val offline = Data.live && !Offline.reachable && !Api.dryRun && !LocalMode.on
    val waiting = Offline.count > 0 && Data.live
    val shown = (offline && !dismissed) || waiting
    val motion = MaterialTheme.motionScheme
    AnimatedVisibility(
        shown, modifier = modifier,
        enter = slideInVertically(motion.defaultSpatialSpec()) { -it } + fadeIn(motion.defaultEffectsSpec()),
        exit = slideOutVertically(motion.fastSpatialSpec()) { -it } + fadeOut(motion.fastEffectsSpec()),
    ) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
            Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
            Row(
                Modifier.fillMaxWidth().padding(top = 6.dp).clip(RoundedCornerShape(22.dp)).background(cs.inverseSurface).padding(start = 16.dp, end = 6.dp, top = 10.dp, bottom = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                LineIcon(Glyphs.cloud, cs.inverseOnSurface, size = 18.dp, stroke = 2f)
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    if (offline) Text(stringResource(R.string.offline_banner), style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(550), fontSize = 13.sp, lineHeight = 18.sp, color = cs.inverseOnSurface))
                    if (waiting) Text(
                        pluralStringResource(R.plurals.offline_pending, Offline.count, Offline.count),
                        style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(650), fontSize = 13.sp, color = cs.inversePrimary),
                    )
                }
                if (offline) Box(Modifier.size(40.dp).clip(CircleShape).dip { dismissed = true }, contentAlignment = Alignment.Center) {
                    LineIcon(listOf(P("M18 6 6 18"), P("m6 6 12 12")), cs.inverseOnSurface, size = 18.dp, stroke = 2.2f)
                }
            }
        }
    }
}

// Reisinstellingen.

/** The web's tripSettings.device card: link the photos of this trip's days from the gallery, or unlink them. */
@Composable
fun DevicePhotosPanel(trip: Trip, onChanged: () -> Unit = {}) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val version = DeviceMedia.version.intValue
    val count = remember(trip.id, version) { DeviceMedia.count(trip) }
    var busy by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var confirm by remember { mutableStateOf(false) }
    val noAccess = stringResource(R.string.device_no_access)
    val noLocation = stringResource(R.string.device_no_location)
    val none = stringResource(R.string.device_none)
    val noDates = stringResource(R.string.device_no_dates)
    fun run() {
        if (trip.start == null) { note = noDates to true; return }
        busy = true; note = null
        scope.launch {
            val r = runCatching { DeviceMedia.link(context, trip) }.getOrNull()
            busy = false
            if ((r?.added ?: 0) > 0) onChanged()
            note = when {
                r == null -> noAccess to true
                r.added == 0 -> none to false
                else -> (Lang.plural(R.plurals.device_added, r.added, r.added) + if (!r.hasLocation) " " + noLocation else "") to false
            }
        }
    }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        val gallery = granted.filterKeys { it != android.Manifest.permission.ACCESS_MEDIA_LOCATION }.values.any { it } ||
            (android.os.Build.VERSION.SDK_INT >= 34 && context.checkSelfPermission(android.Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) == android.content.pm.PackageManager.PERMISSION_GRANTED)
        if (gallery) run() else note = noAccess to true
    }
    Header(stringResource(R.string.device_title))
    Panel {
        Hint(if (count > 0) pluralStringResource(R.plurals.device_count, count, count) else stringResource(R.string.device_empty))
        ButtonRow {
            SoftButton(stringResource(if (busy) R.string.device_linking else R.string.device_link), { ask.launch(DeviceMedia.permissions()) }, Modifier.weight(1f), icon = Glyphs.photo, busy = busy, enabled = !busy)
            if (count > 0) QuietDangerButton(stringResource(R.string.device_unlink), { confirm = true }, Modifier.weight(1f))
        }
        Note(note?.first, error = note?.second == true)
        Hint(stringResource(R.string.device_help))
    }
    if (confirm) Confirm(
        stringResource(R.string.device_unlink_title), stringResource(R.string.device_unlink_body), stringResource(R.string.device_unlink),
        onConfirm = { DeviceMedia.unlink(trip); note = null; onChanged() }, onDismiss = { confirm = false },
    )
}
