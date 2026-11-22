package nl.markmaaktmedia.markmysteps.next

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.requiredWidth
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.toShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/*
 * The way into the app for someone new, as the web's auth flow: create an account on a server, wait for the
 * admin to let you in (the app looks by itself), or carry on without a server; then a short onboarding with
 * the theme, your airports and the permissions. Every screen can be opened as a preview from the developer
 * page, and a preview never sends or keeps anything.
 */

/** Whether the onboarding was done (or never needed, for someone who already used the app). */
object Onboarding {
    private var prefs: android.content.SharedPreferences? = null
    var done by mutableStateOf(true); private set

    fun init(context: Context) {
        val p = context.getSharedPreferences("mms.next.ui", Context.MODE_PRIVATE)
        prefs = p
        // Someone who opens this version already signed in used the app before: no tour for them.
        if (!p.contains("onboarded")) p.edit().putBoolean("onboarded", Api.signedIn || OldApp.present(context)).apply()
        done = p.getBoolean("onboarded", true)
    }

    fun finish() { done = true; prefs?.edit()?.putBoolean("onboarded", true)?.apply() }
    /** A new account or a new start without a server: the tour comes once. */
    fun needed() { done = false; prefs?.edit()?.putBoolean("onboarded", false)?.apply() }
}

private val GlyphMail = listOf(P("M4 6h16v12H4z"), P("m4 7 8 6 8-6"))

/** A page of the way in: the compass and a title over the page colour, the content under it, scrolling above the keyboard. */
@Composable
private fun AuthScaffold(title: String, intro: String?, onBack: (() -> Unit)?, content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    val cs = MaterialTheme.colorScheme
    Column(Modifier.fillMaxSize().background(cs.background).imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp)) {
        Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (onBack != null) Box(Modifier.size(48.dp).clip(CircleShape).background(cs.surfaceContainerHigh).dip(onBack), contentAlignment = Alignment.Center) {
                LineIcon(listOf(P("M19 12H5"), P("m12 19-7-7 7-7")), cs.onSurface, size = 22.dp, stroke = 2.2f)
            }
        }
        Row(Modifier.padding(top = 18.dp), verticalAlignment = Alignment.CenterVertically) {
            LineIcon(Glyphs.logo, cs.primary, size = 36.dp, stroke = 2.1f)
            Text(title, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 30.sp, letterSpacing = (-0.02).em, color = cs.onBackground), modifier = Modifier.padding(start = 12.dp))
        }
        if (intro != null) Text(intro, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 15.sp, lineHeight = 21.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 10.dp, bottom = 18.dp))
        content()
        Spacer(Modifier.height(24.dp))
        Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
    }
}

/**
 * Account maken, as the web's sign-up: server, name, username, email and password (ten characters or more).
 * The first account of a server is in at once; anyone after waits for the admin ([onPending]).
 */
@Composable
fun RegisterPage(preview: Boolean, onBack: () -> Unit, onApproved: () -> Unit, onPending: () -> Unit) {
    val scope = rememberCoroutineScope()
    var server by rememberSaveable { mutableStateOf(Api.base.removePrefix("https://")) }
    var name by rememberSaveable { mutableStateOf("") }
    var username by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    BackHandler(onBack = onBack)
    val usernameOk = Regex("^[a-zA-Z0-9._-]{3,30}$").matches(username.trim())
    val emailOk = android.util.Patterns.EMAIL_ADDRESS.matcher(email.trim()).matches()
    val ready = server.isNotBlank() && name.isNotBlank() && usernameOk && emailOk && password.length >= 10
    val errEmail = stringResource(R.string.auth_error_email)
    val errUser = stringResource(R.string.auth_error_username)
    val errTaken = stringResource(R.string.auth_error_taken)
    val errFull = stringResource(R.string.auth_error_full)
    val errMany = stringResource(R.string.auth_error_too_many)
    fun submit() {
        if (busy) return
        error = when { !emailOk -> errEmail; !usernameOk -> errUser; else -> null }
        if (error != null || !ready) return
        busy = true
        scope.launch {
            try {
                Api.previewing = Api.previewing || preview
                val status = Api.register(server, email, username, name, password)
                password = ""
                Onboarding.needed()
                if (status == "APPROVED") onApproved() else onPending()
            } catch (e: Api.Failure) {
                error = when (e.status) {
                    409 -> errTaken
                    403 -> errFull
                    429 -> errMany
                    else -> e.message
                }
            } finally {
                busy = false
            }
        }
    }
    AuthScaffold(stringResource(R.string.auth_create_account), stringResource(R.string.auth_register_intro), onBack) {
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(30.dp)).background(MaterialTheme.colorScheme.surfaceContainerLow).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            FormField(stringResource(R.string.auth_server), server, { server = it }, hint = stringResource(R.string.auth_server_hint), type = KeyboardType.Uri)
            FormField(stringResource(R.string.auth_name), name, { name = it }, capitalize = true, autofill = androidx.compose.ui.autofill.ContentType.PersonFullName)
            FormField(
                stringResource(R.string.auth_username), username, { username = it.trim().take(30) }, hint = stringResource(R.string.auth_username_placeholder), prefix = "@",
                autofill = androidx.compose.ui.autofill.ContentType.NewUsername,
                support = stringResource(R.string.auth_username_hint), supportError = username.isNotBlank() && !usernameOk,
            )
            FormField(stringResource(R.string.auth_email), email, { email = it.trim() }, type = KeyboardType.Email, autofill = androidx.compose.ui.autofill.ContentType.EmailAddress)
            FormField(
                stringResource(R.string.auth_password), password, { password = it }, type = KeyboardType.Password, secret = true,
                autofill = androidx.compose.ui.autofill.ContentType.NewPassword, done = ::submit,
                support = stringResource(R.string.auth_password_hint), supportError = password.isNotEmpty() && password.length < 10,
            )
            Note(error, error = true)
            MainButton(stringResource(if (busy) R.string.auth_wait else R.string.auth_create_account), ::submit, Modifier.fillMaxWidth(), busy = busy, enabled = ready)
        }
        androidx.compose.material3.TextButton(onClick = onBack, modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 8.dp)) {
            Text(stringResource(R.string.auth_have_account), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp))
        }
    }
}

/**
 * The web's PendingPage: the compass turns while the admin decides. The app asks every twenty seconds and
 * whenever it comes back to the front; approved, it carries on by itself (with a notification), refused, it
 * says so and goes back to signing in.
 */
@Composable
fun PendingPage(preview: Boolean, onApproved: () -> Unit, onSignOut: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val context = LocalContext.current
    var checking by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf<String?>(null) }
    var rejected by remember { mutableStateOf(false) }
    var checkedAt by remember { mutableLongStateOf(0L) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var wake by remember { mutableIntStateOf(0) }
    val failText = stringResource(R.string.auth_pending_failed)
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { wake++ }
    LaunchedEffect(wake) {
        if (preview) return@LaunchedEffect
        while (true) {
            checking = true
            try {
                val (status, just) = Api.approval()
                failed = null
                checkedAt = System.currentTimeMillis()
                when (status) {
                    "REJECTED" -> { rejected = true; checking = false; return@LaunchedEffect }
                    "APPROVED" -> {
                        if (just) notifyApproved(context)
                        Api.upgrade()
                        checking = false
                        onApproved()
                        return@LaunchedEffect
                    }
                }
            } catch (e: Api.Failure) {
                failed = e.message ?: failText
            }
            checking = false
            delay(20_000)
        }
    }
    LaunchedEffect(Unit) { while (true) { delay(30_000); now = System.currentTimeMillis() } }
    BackHandler(enabled = preview, onBack = onSignOut)
    val motion = MaterialTheme.motionScheme
    Box(Modifier.fillMaxSize().background(cs.background).padding(horizontal = 24.dp), contentAlignment = Alignment.Center) {
        AnimatedContent(rejected, transitionSpec = { (fadeIn(motion.slowEffectsSpec()) + scaleIn(motion.defaultSpatialSpec(), initialScale = 0.94f)) togetherWith fadeOut(motion.fastEffectsSpec()) }, label = "pending") { no ->
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(32.dp)).background(cs.surfaceContainerLow).padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (no) {
                    Box(Modifier.size(64.dp).clip(MaterialShapes.Cookie9Sided.toShape()).background(cs.errorContainer), contentAlignment = Alignment.Center) {
                        LineIcon(listOf(P("M18 6 6 18"), P("m6 6 12 12")), cs.onErrorContainer, size = 30.dp, stroke = 2.4f)
                    }
                    AuthTitle(stringResource(R.string.auth_rejected_title))
                    AuthBody(stringResource(R.string.auth_rejected_body))
                    SoftButton(stringResource(R.string.auth_rejected_back), onSignOut, Modifier.fillMaxWidth())
                } else {
                    // The needle sweeps round while you wait: something is happening, and it cannot be hurried.
                    val turn by rememberInfiniteTransition(label = "needle").animateFloat(0f, 360f, infiniteRepeatable(tween(2400, easing = LinearEasing), RepeatMode.Restart), label = "turn")
                    Box(Modifier.size(64.dp).clip(MaterialShapes.Cookie9Sided.toShape()).background(cs.primaryContainer), contentAlignment = Alignment.Center) {
                        LineIcon(Glyphs.logo, cs.onPrimaryContainer, size = 34.dp, stroke = 2.1f, modifier = Modifier.graphicsLayer { rotationZ = turn })
                    }
                    AuthTitle(stringResource(R.string.auth_pending_title))
                    AuthBody(stringResource(R.string.auth_pending_body))
                    AuthBody(stringResource(R.string.auth_pending_hint), small = true)
                    val minutes = ((now - checkedAt) / 60_000).toInt()
                    Text(
                        when {
                            failed != null -> failed!!
                            checking -> stringResource(R.string.auth_pending_checking)
                            checkedAt == 0L -> stringResource(R.string.auth_pending_not_checked)
                            minutes < 1 -> stringResource(R.string.auth_pending_just_checked)
                            else -> stringResource(R.string.auth_pending_checked_ago, minutes)
                        },
                        style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 13.sp, color = if (failed != null) cs.error else cs.primary),
                    )
                    SoftButton(stringResource(R.string.auth_pending_logout), onSignOut, Modifier.fillMaxWidth())
                }
            }
        }
    }
}

@Composable
private fun AuthTitle(text: String) {
    Text(text, textAlign = TextAlign.Center, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 24.sp, letterSpacing = (-0.01).em, color = MaterialTheme.colorScheme.onSurface))
}

@Composable
private fun AuthBody(text: String, small: Boolean = false) {
    Text(text, textAlign = TextAlign.Center, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = if (small) 13.sp else 15.sp, lineHeight = if (small) 18.sp else 21.sp, color = MaterialTheme.colorScheme.onSurfaceVariant))
}

private fun notifyApproved(context: Context) {
    runCatching {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("account", Lang.text(R.string.auth_channel), NotificationManager.IMPORTANCE_DEFAULT))
        nm.notify(
            7301,
            android.app.Notification.Builder(context, "account").setSmallIcon(R.drawable.ic_stat_compass)
                .setContentTitle(Lang.text(R.string.auth_approved_title)).setContentText(Lang.text(R.string.auth_approved_body)).setAutoCancel(true).build(),
        )
    }
}

/**
 * The web's LocalModeSheet: what works without a server and what needs one, and how to get a server later.
 * [onStart] starts the app on this phone alone.
 */
@Composable
fun LocalModeSheet(onDismiss: () -> Unit, onStart: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    AppSheet(onDismiss = onDismiss) {
        Column(Modifier.padding(horizontal = 20.dp).verticalScroll(rememberScrollState())) {
            Text(stringResource(R.string.local_title), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 26.sp, color = cs.onSurface))
            Text(stringResource(R.string.local_intro), style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 15.sp, lineHeight = 21.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 6.dp, bottom = 14.dp))
            @Composable fun Block(title: String, glyph: List<Shape24>, rows: List<Pair<Int, Int>>, tone: androidx.compose.ui.graphics.Color) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 4.dp, bottom = 8.dp, top = 6.dp)) {
                    LineIcon(glyph, tone, size = 18.dp, stroke = 2.2f)
                    Text(title, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 15.sp, color = tone), modifier = Modifier.padding(start = 8.dp))
                }
                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    rows.forEachIndexed { i, (t, b) ->
                        Column(Modifier.fillMaxWidth().clip(slabShape(i, rows.size)).background(cs.surfaceContainerHigh).padding(horizontal = 16.dp, vertical = 12.dp)) {
                            Text(stringResource(t), style = TitleStyle.copy(color = cs.onSurface))
                            Text(stringResource(b), style = ValueStyle.copy(color = cs.onSurfaceVariant))
                        }
                    }
                }
            }
            Block(stringResource(R.string.local_works), Glyphs.check, listOf(
                R.string.local_tracking_title to R.string.local_tracking, R.string.local_plan_title to R.string.local_plan,
                R.string.local_photos_title to R.string.local_photos, R.string.local_maps_title to R.string.local_maps,
            ), cs.primary)
            Spacer(Modifier.height(10.dp))
            Block(stringResource(R.string.local_needs), Glyphs.cloud, listOf(
                R.string.local_companions_title to R.string.local_companions, R.string.local_share_title to R.string.local_share,
                R.string.local_backup_title to R.string.local_backup, R.string.local_immich_title to R.string.local_immich,
            ), cs.onSurfaceVariant)
            Spacer(Modifier.height(14.dp))
            Text(stringResource(R.string.local_later_title), style = TitleStyle.copy(color = cs.onSurface), modifier = Modifier.padding(start = 4.dp))
            Hint(stringResource(R.string.local_later), Modifier.padding(start = 4.dp, top = 2.dp))
            Spacer(Modifier.height(16.dp))
            ButtonRow {
                SoftButton(stringResource(R.string.common_back), onDismiss, Modifier.weight(1f))
                MainButton(stringResource(R.string.local_start), onStart, Modifier.weight(1.6f))
            }
            Spacer(Modifier.height(12.dp))
            Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
        }
    }
}

/**
 * The web's OnboardingV2Page, natively: a few slides that tell what the app does, then the choices that matter
 * at the start (theme, airports) and the permissions (location, notifications; without a server also your name
 * and the gallery). Swipe or tap Volgende; Overslaan goes to the end. A preview keeps nothing.
 */
@Composable
fun OnboardingPage(preview: Boolean, local: Boolean, onDone: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val motion = MaterialTheme.motionScheme
    var theme by remember { mutableIntStateOf(ThemePref.mode) }
    // The preview shows the theme you pick at once, like the real one, and puts yours back when it closes.
    val ownTheme = remember { ThemePref.mode }
    if (preview) androidx.compose.runtime.DisposableEffect(Unit) { onDispose { ThemePref.show(ownTheme) } }
    var name by remember { mutableStateOf(if (preview) "" else LocalMode.name) }
    fun granted(p: String) = context.checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED
    var location by remember { mutableStateOf<Boolean?>(if (granted(android.Manifest.permission.ACCESS_FINE_LOCATION)) true else null) }
    var notifs by remember { mutableStateOf<Boolean?>(if (granted(android.Manifest.permission.POST_NOTIFICATIONS)) true else null) }
    var gallery by remember { mutableStateOf<Boolean?>(null) }
    val askLocation = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { r -> location = r.values.any { it } }
    val askNotifs = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { notifs = it }
    val askGallery = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { r -> gallery = r.filterKeys { it != android.Manifest.permission.ACCESS_MEDIA_LOCATION }.values.any { it } }

    class Slide(val key: String, val glyph: List<Shape24>, val title: Int, val body: Int, val extra: (@Composable () -> Unit)? = null)
    @Composable fun Ask(state: Boolean?, label: String, onAsk: () -> Unit) {
        AnimatedContent(state, label = "ask") { s ->
            when (s) {
                true -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                    LineIcon(Glyphs.check, cs.primary, size = 20.dp, stroke = 2.4f)
                    Text(stringResource(R.string.onb_granted), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 16.sp, color = cs.primary), modifier = Modifier.padding(start = 8.dp))
                }
                false -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    SoftButton(label, onAsk, Modifier.fillMaxWidth())
                    Hint(stringResource(R.string.onb_denied), Modifier.padding(top = 8.dp))
                }
                null -> MainButton(label, onAsk, Modifier.fillMaxWidth())
            }
        }
    }
    val slides = buildList {
        add(Slide("welcome", Glyphs.logo, R.string.onb_welcome_title, R.string.onb_welcome_body))
        if (local) add(Slide("name", Glyphs.person, R.string.onb_name_title, R.string.onb_name_body) {
            FormField(stringResource(R.string.onb_name_placeholder), name, { name = it.take(60); if (!preview) LocalMode.changeName(name) }, capitalize = true)
        })
        add(Slide("globe", Glyphs.globe, R.string.onb_globe_title, R.string.onb_globe_body))
        add(Slide("plan", Glyphs.car, R.string.onb_plan_title, R.string.onb_plan_body))
        add(Slide("trips", Glyphs.photo, R.string.onb_trips_title, R.string.onb_trips_body))
        if (!local) add(Slide("share", Glyphs.send, R.string.onb_share_title, R.string.onb_share_body))
        add(Slide("offline", Glyphs.cloud, R.string.onb_offline_title, R.string.onb_offline_body))
        add(Slide("theme", Glyphs.sun, R.string.onb_theme_title, R.string.onb_theme_body) {
            Choices(listOf(0 to stringResource(R.string.settings_theme_light), 1 to stringResource(R.string.settings_theme_dark), 2 to stringResource(R.string.common_system)), theme, { theme = it; if (preview) ThemePref.show(it) else ThemePref.set(it) })
        })
        add(Slide("airports", Glyphs.plane, R.string.onb_airports_title, R.string.onb_airports_body) {
            // The real panel; in a preview it only shows, so nothing is kept.
            Box {
                AirportsPanel()
                if (preview) Box(Modifier.matchParentSize().pointerInput(Unit) {
                    awaitPointerEventScope { while (true) awaitPointerEvent(androidx.compose.ui.input.pointer.PointerEventPass.Initial).changes.forEach { it.consume() } }
                })
            }
        })
        add(Slide("location", Glyphs.pin, R.string.onb_location_title, R.string.onb_location_body) {
            Ask(location, stringResource(R.string.onb_location_ask)) { askLocation.launch(arrayOf(android.Manifest.permission.ACCESS_FINE_LOCATION, android.Manifest.permission.ACCESS_COARSE_LOCATION)) }
        })
        if (local) add(Slide("gallery", Glyphs.camera, R.string.onb_gallery_title, R.string.onb_gallery_body) {
            Ask(gallery, stringResource(R.string.onb_gallery_ask)) { askGallery.launch(DeviceMedia.permissions()) }
        })
        add(Slide("notifs", Glyphs.bell, R.string.onb_notifs_title, R.string.onb_notifs_body) {
            Ask(notifs, stringResource(R.string.onb_notifs_ask)) { askNotifs.launch(android.Manifest.permission.POST_NOTIFICATIONS) }
        })
        add(Slide("start", Glyphs.plus, R.string.onb_start_title, R.string.onb_start_body))
    }
    val pager = rememberPagerState { slides.size }
    val haptics = rememberHaptics()
    LaunchedEffect(pager.currentPage) { if (pager.currentPage > 0) haptics(Haptic.Tick) }
    fun finish() {
        if (!preview) Onboarding.finish()
        onDone()
    }
    BackHandler {
        if (pager.currentPage > 0) scope.launch { pager.animateScrollToPage(pager.currentPage - 1) } else if (preview) onDone()
    }
    val last = pager.currentPage == slides.lastIndex
    Column(Modifier.fillMaxSize().background(cs.background).imePadding()) {
        Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
        // Where you are: a dot per slide, the current one a pill.
        Row(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.Center) {
            slides.indices.forEach { i ->
                val on = i == pager.currentPage
                val w by animateDpAsState(if (on) 22.dp else 7.dp, motion.fastSpatialSpec(), label = "dot")
                val c by animateColorAsState(if (on) cs.primary else cs.outlineVariant, motion.fastEffectsSpec(), label = "dotColor")
                Box(Modifier.padding(horizontal = 3.dp).height(7.dp).width(w).clip(CircleShape).background(c))
            }
        }
        HorizontalPager(pager, Modifier.weight(1f)) { i ->
            val s = slides[i]
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
            ) {
                Spacer(Modifier.height(24.dp))
                val shown = pager.currentPage == i
                val scale by androidx.compose.animation.core.animateFloatAsState(if (shown) 1f else 0.82f, motion.defaultSpatialSpec(), label = "medal")
                Box(
                    Modifier.size(132.dp).graphicsLayer { scaleX = scale; scaleY = scale }
                        .clip((if (i % 2 == 0) MaterialShapes.Cookie9Sided else MaterialShapes.Sunny).toShape()).background(cs.primaryContainer),
                    contentAlignment = Alignment.Center,
                ) { LineIcon(s.glyph, cs.onPrimaryContainer, size = 60.dp, stroke = 1.9f) }
                Spacer(Modifier.height(28.dp))
                Text(stringResource(s.title), textAlign = TextAlign.Center, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 28.sp, letterSpacing = (-0.02).em, color = cs.onBackground))
                Text(stringResource(s.body), textAlign = TextAlign.Center, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 15.5.sp, lineHeight = 22.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 12.dp))
                s.extra?.let { Spacer(Modifier.height(22.dp)); Box(Modifier.fillMaxWidth()) { it() } }
                Spacer(Modifier.height(24.dp))
            }
        }
        // On the last slide "Overslaan" makes way and the main button grows into its place, as one movement:
        // both widths come from the same animated fraction, so nothing jumps.
        val gone by androidx.compose.animation.core.animateFloatAsState(if (last) 1f else 0f, motion.defaultSpatialSpec(), label = "skipGone")
        androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp)) {
            val gap = 10.dp
            val full = maxWidth
            val skipW = ((full - gap) / 2.6f) * (1f - gone)
            Row(Modifier.fillMaxWidth()) {
                if (skipW > 0.5.dp) Box(Modifier.width(skipW).graphicsLayer { alpha = (1f - gone * 1.6f).coerceIn(0f, 1f) }) {
                    SoftButton(stringResource(R.string.onb_skip), { scope.launch { pager.animateScrollToPage(slides.lastIndex) } }, Modifier.requiredWidth((full - gap) / 2.6f).align(Alignment.CenterStart))
                }
                Spacer(Modifier.width(gap * (1f - gone)))
                MainButton(
                    stringResource(if (last) R.string.onb_finish else R.string.common_next),
                    { if (last) finish() else scope.launch { pager.animateScrollToPage(pager.currentPage + 1) } },
                    Modifier.weight(1f),
                )
            }
        }
        Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
    }
}
