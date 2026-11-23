package nl.markmaaktmedia.markmysteps.next

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.runtime.LaunchedEffect
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.scaleIn
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.draw.blur
import kotlin.math.roundToInt
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.foundation.background
import dev.chrisbanes.haze.hazeEffect
import dev.chrisbanes.haze.hazeSource
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ButtonGroupDefaults
import androidx.compose.material3.FloatingToolbarDefaults
import androidx.compose.material3.HorizontalFloatingToolbar
import androidx.compose.material3.LinearWavyProgressIndicator
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MaterialShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.Text
import androidx.compose.material3.ToggleButton
import androidx.compose.material3.ToggleButtonDefaults
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.ripple
import androidx.compose.material3.toShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateDp
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.layout
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.composed
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/*
 * A proposal for a new look on Android, in the Material 3 Expressive language
 * of Tandem and PixelPlayer: the expressive theme and motion, icons in
 * Material shapes, a connected toggle group, a wavy progress bar, grouped
 * slabs and a floating toolbar with the new-trip button beside it. Outfit
 * carries the brand, the headings and the big numbers; the orange stays the
 * brand colour, and the dark theme is pure black.
 *
 * Only the look lives here. The trips themselves (Demo.kt now, the API later)
 * are plain data, so the iPhone app can show the same trips in its own
 * language, with Liquid Glass, without anything from this file.
 */

internal val LightScheme = lightColorScheme(
    primary = Color(0xFFE8613C),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFFFDBCF),
    onPrimaryContainer = Color(0xFF7A2610),
    secondaryContainer = Color(0xFFF6E1D6),
    onSecondaryContainer = Color(0xFF5C2E1C),
    tertiaryContainer = Color(0xFFD9ECE8),
    onTertiaryContainer = Color(0xFF14524B),
    background = Color(0xFFFBF7F2),
    onBackground = Color(0xFF1B2530),
    surface = Color(0xFFFBF7F2),
    onSurface = Color(0xFF1B2530),
    onSurfaceVariant = Color(0xFF5E6B77),
    // Warm tones a step darker than the page each, so cards and rows always stand off it (white on #FBF7F2 did not).
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFF3ECE2),
    surfaceContainer = Color(0xFFEFE7DB),
    surfaceContainerHigh = Color(0xFFEAE1D4),
    surfaceContainerHighest = Color(0xFFE4DACB),
    outlineVariant = Color(0xFFE4DCCE),
)

internal val DarkScheme = darkColorScheme(
    primary = Color(0xFFFF8A63),
    onPrimary = Color(0xFF3A1406),
    primaryContainer = Color(0xFF5A2717),
    onPrimaryContainer = Color(0xFFFFDBCE),
    secondaryContainer = Color(0xFF3B2A22),
    onSecondaryContainer = Color(0xFFFFDCCB),
    tertiaryContainer = Color(0xFF1C3B37),
    onTertiaryContainer = Color(0xFFB4ECE3),
    // The web's dark paper (#14181d), not OLED black: a normal dark mode.
    background = Color(0xFF14181D),
    onBackground = Color(0xFFEEF1F4),
    surface = Color(0xFF14181D),
    onSurface = Color(0xFFEEF1F4),
    onSurfaceVariant = Color(0xFFA7B2BD),
    surfaceContainerLowest = Color(0xFF0F141A),
    surfaceContainerLow = Color(0xFF1A2027),
    surfaceContainer = Color(0xFF1D242C),
    surfaceContainerHigh = Color(0xFF242C35),
    surfaceContainerHighest = Color(0xFF2D3640),
    outlineVariant = Color(0xFF2B333D),
)

private val Pad = 16.dp

@Composable
fun HomeNew(dark: Boolean, onLogoTap: () -> Unit, startTrip: String? = null, startPage: String? = null, previews: Previews = Previews()) {
    MaterialExpressiveTheme(
        colorScheme = animatedScheme(withWallpaperAccent(if (dark) DarkScheme else LightScheme, dark)),
        motionScheme = MotionScheme.expressive(),
    ) {
        // Once, signed in: the new look note, inside the theme so it has the app's own colours.
        if (Data.live) NewLookDialog()
        // First the sign-in, unless signed in already or a test opens a page straight away.
        var gate by androidx.compose.runtime.saveable.rememberSaveable {
            mutableStateOf(when {
                previews.mfa -> "login"
                startTrip != null || startPage != null -> "app"
                !Api.signedIn -> "login"
                // Signed up but not let in yet; or new here and the tour not done (Auth.kt).
                Api.pending -> "pending"
                !Onboarding.done -> "onboarding"
                else -> "app"
            })
        }
        val scope = androidx.compose.runtime.rememberCoroutineScope()
        var localSheet by remember { mutableStateOf(false) }
        // In after signing in, signing up or starting without a server: waiting for the admin, the tour, or the app.
        fun enter() {
            gate = when { Api.pending -> "pending"; !Onboarding.done -> "onboarding"; else -> "app" }
            if (gate != "pending") { Data.begin(); scope.launch { Data.load() } }
        }
        LaunchedEffect(Unit) { Data.load() }
        // The old app's sign-in came along (OldApp.kt): straight into the app, no sign-in page, no tour.
        LaunchedEffect(OldApp.adopted) { if (OldApp.adopted && gate == "login") { Onboarding.finish(); gate = "app"; Data.begin() } }
        // Every time the app comes to the front (also back from the background, not only a cold start), at most
        // every two minutes (Update.kt). Once per cold start every six hours missed a release Mark had just made.
        androidx.lifecycle.compose.LifecycleEventEffect(androidx.lifecycle.Lifecycle.Event.ON_START) { scope.launch { Updates.checkIfDue() } }
        val gateMotion = MaterialTheme.motionScheme
        AnimatedContent(
            gate,
            transitionSpec = { (fadeIn(gateMotion.slowEffectsSpec()) + scaleIn(gateMotion.defaultSpatialSpec(), initialScale = 0.96f)) togetherWith fadeOut(gateMotion.fastEffectsSpec()) },
            label = "gate",
        ) { which ->
        when (which) {
            "login" -> {
                LoginPage(dark, onDone = { enter() }, onDemo = { gate = "app" }, mfaPreview = previews.mfa, onRegister = { gate = "register" }, onLocal = { localSheet = true })
                if (localSheet) LocalModeSheet(onDismiss = { localSheet = false }, onStart = { localSheet = false; LocalMode.start(); enter() })
                return@AnimatedContent
            }
            "register" -> { RegisterPage(preview = false, onBack = { gate = "login" }, onApproved = { enter() }, onPending = { gate = "pending" }); return@AnimatedContent }
            "pending" -> { PendingPage(preview = false, onApproved = { enter() }, onSignOut = { Data.signOut(); gate = "login" }); return@AnimatedContent }
            "onboarding" -> { OnboardingPage(preview = false, local = LocalMode.on, onDone = { gate = "app"; scope.launch { Data.load() } }); return@AnimatedContent }
        }
        var open by remember { mutableStateOf(Data.all.firstOrNull { it.id == startTrip }) }
        // The adb extra "trip" may name a server trip, by id or title, which only exists once it has loaded.
        LaunchedEffect(Data.version) {
            if (open == null && startTrip != null) open = Data.all.firstOrNull { it.id == startTrip || it.title == startTrip }
        }
        // Kept over a rebuild of the screen (a switch of language), so you stay where you were.
        var page by androidx.compose.runtime.saveable.rememberSaveable { mutableIntStateOf(when (startPage) { "settings" -> 2; "travellers" -> 1; else -> 0 }) }
        // A trip you are not on (ask to look along), or a share link that is not one of your trips: pages of their own.
        var outside by remember { mutableStateOf(if (previews.access) "access:preview" else null) }
        /** A trip by its id: yours opens, anyone else's asks to look along. */
        fun openTripId(id: String) {
            val mine = Data.all.firstOrNull { it.id == id || it.remoteId == id }
            if (mine != null) { outside = null; open = mine } else outside = "access:$id"
        }
        // A share or trip link that opened the app, once there are trips to look it up in.
        LaunchedEffect(DeepLink.pending, Data.version, Data.live) {
            val uri = DeepLink.pending ?: return@LaunchedEffect
            if (!Data.live || Data.loading) return@LaunchedEffect
            DeepLink.pending = null
            when (val t = DeepLink.parse(uri)) {
                is DeepLink.Target.Trip -> openTripId(t.id)
                is DeepLink.Target.Share -> { open = null; outside = "share:${t.slug}|$uri" }
                null -> Unit
            }
        }
        val motion = MaterialTheme.motionScheme
        val target = open?.id ?: outside ?: "page$page"
        // Predictive back: the back gesture seeks this transition, so the page under the
        // finger shrinks and the one it goes back to already shows; letting go finishes
        // it, pulling back springs it into place again.
        val pages = remember { androidx.compose.animation.core.SeekableTransitionState(target) }
        val holder = androidx.compose.runtime.saveable.rememberSaveableStateHolder()
        // Reizigers opens at the top, bell in view, each time you come to it from another tab (back included).
        // A trip opened from it keeps the page as it was, so coming back from the trip lands where you were.
        androidx.compose.runtime.LaunchedEffect(page) { if (page != 1) holder.removeState("page1") }
        // A trip you left opens fresh the next time: at the top, its places row back at the first place.
        val lastTrip = remember { mutableStateOf<String?>(null) }
        androidx.compose.runtime.LaunchedEffect(open?.id) {
            lastTrip.value?.takeIf { it != open?.id }?.let { holder.removeState(it) }
            lastTrip.value = open?.id
        }
        val backScope = androidx.compose.runtime.rememberCoroutineScope()
        // Exactly as Tandem: one seekable transition drives every page change, the back gesture
        // included. While the finger drags the transition is seeked, letting go plays the same
        // transition on from there, pulling back snaps it home. Nothing is composed twice.
        var fromTabBack by remember { mutableStateOf(false) }
        LaunchedEffect(target) { if (pages.targetState != target) { pages.animateTo(target) }; fromTabBack = false }
        // Off to another tab, the home page forgets where it was scrolled: back on it, it starts at
        // the top. Back from a trip it keeps its place, so you can carry on down the list.
        LaunchedEffect(page) { if (page != 0) holder.removeState("page0") }
        val backTo: String? = when { open != null || outside != null -> "page$page"; page != 0 -> "page0"; else -> null }
        androidx.activity.compose.PredictiveBackHandler(enabled = backTo != null) { events ->
            val to = backTo ?: return@PredictiveBackHandler
            fromTabBack = open == null
            try {
                events.collect { e -> pages.seekTo(e.progress, to) }
                pages.animateTo(to)
                // Last, so the handler switching itself off cannot cut the animation short.
                if (open != null) open = null else if (outside != null) outside = null else page = 0
            } catch (e: kotlin.coroutines.cancellation.CancellationException) {
                kotlinx.coroutines.withContext(kotlinx.coroutines.NonCancellable) { pages.snapTo(target) }
                // A cancelled gesture must not leave the next tab switch playing the back animation.
                fromTabBack = false
                throw e
            }
        }
        val transition = androidx.compose.animation.core.rememberTransition(pages, label = "page")
        Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
            transition.AnimatedContent(
                transitionSpec = {
                    // The Material shared axis of the system apps, Tandem's exact spec: forward the new page
                    // comes in from a third away and fades up while the old one slides the other way and
                    // shrinks; back mirrors it and the leaving page goes all the way out, staying on top.
                    val back = (initialState.startsWith("page").not() && targetState.startsWith("page")) ||
                        (targetState == "page0" && initialState != "page0" && initialState.startsWith("page") && fromTabBack)
                    val ease = androidx.compose.animation.core.tween<Float>(SharedAxisMillis, easing = Emphasized)
                    val slide = androidx.compose.animation.core.tween<androidx.compose.ui.unit.IntOffset>(SharedAxisMillis, easing = Emphasized)
                    if (initialState.startsWith("page") && targetState.startsWith("page") && !fromTabBack) {
                        // Between tabs: a fade-through.
                        (fadeIn(motion.defaultEffectsSpec()) + scaleIn(motion.defaultSpatialSpec(), initialScale = 0.96f)) togetherWith fadeOut(motion.fastEffectsSpec())
                    } else if (!back) {
                        (slideInHorizontally(slide) { it / 3 } + fadeIn(ease)) togetherWith
                            (slideOutHorizontally(slide) { -it / 3 } + scaleOut(ease, targetScale = 0.92f))
                    } else {
                        ((slideInHorizontally(slide) { -it / 3 } + fadeIn(ease)) togetherWith
                            (slideOutHorizontally(androidx.compose.animation.core.tween(SharedAxisMillis, easing = androidx.compose.animation.core.Easing { f -> f * f * f })) { it } +
                                scaleOut(ease, targetScale = 0.85f)))
                            .apply { targetContentZIndex = -1f }
                    }
                },
                contentKey = { it },
            ) { key ->
                Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
                    holder.SaveableStateProvider(key) {
                        val trip = Data.all.firstOrNull { it.id == key }
                        when {
                            trip != null -> TripPage(trip, dark, onBack = { open = null }, startExtra = startPage)
                            key.startsWith("access:") -> TripAccessPage(key.removePrefix("access:"), onBack = { outside = null }, onOpenTrip = { id -> openTripId(id) })
                            key.startsWith("share:") -> key.removePrefix("share:").split('|', limit = 2).let { (slug, url) ->
                                ShareLinkPage(slug, url, onBack = { outside = null }, onOpenTrip = { id -> openTripId(id) })
                            }
                            key == "page2" -> SettingsPage(onSignIn = { Data.signOut(); page = 0; gate = "login" })
                            key == "page1" -> TravellersPage(onOpenTrip = { id -> openTripId(id) }, onOpenRequests = { Data.openSettings = "accounts"; page = 2 })
                            else -> AccountHost(onSignIn = { Data.signOut(); page = 0; gate = "login" }) { openAccount -> HomeNewContent(dark, onLogoTap, onOpenTrip = { open = it }, onProfile = openAccount, onPeople = { Data.peopleFor = it.id; open = it }, tempPassword = previews.tempPassword) }
                        }
                    }
                }
            }
            AnimatedVisibility(
                // Only once a page without the bar is really gone: during the back gesture from a trip it stays
                // away, and it slides in after the home page has settled, not at the first touch. With "Altijd" in
                // Weergave it stays on the trip page too, but never over something full screen (AppCore.kt).
                visible = if (AppPrefs.navBarAlways) Chrome.immersive == 0 else !Data.all.any { it.id == pages.targetState || it.id == pages.currentState } &&
                    !pages.targetState.startsWith("access:") && !pages.currentState.startsWith("access:") &&
                    !pages.targetState.startsWith("share:") && !pages.currentState.startsWith("share:"),
                modifier = Modifier.align(Alignment.BottomCenter),
                enter = slideInVertically(motion.defaultSpatialSpec()) { it } + fadeIn(motion.defaultEffectsSpec()),
                exit = slideOutVertically(motion.fastSpatialSpec()) { it } + fadeOut(motion.fastEffectsSpec()),
            ) {
                Toolbar(page, onNav = { fromTabBack = false; open = null; page = it })
            }
            // A photo book being made into a PDF, laid out out of sight (BookPdf.kt).
            BookJobHost()
            // No connection: a strip at the top says so, with the changes that wait (AppScreens.kt).
            OfflineBanner(Modifier.align(Alignment.TopCenter))
            // Someone put you on trips: said once, with the way into the trip.
            InviteDialog(previews.invite, onOpenTrip = { id -> openTripId(id) })
        }
        }
        // A new user's screen opened from the developer page: over everything, and nothing in it can sign in,
        // sign up or keep a choice (Api.previewing, Auth.kt).
        val preview = ScreenPreview.open
        androidx.compose.runtime.DisposableEffect(preview != null) {
            Api.previewing = preview != null
            onDispose { if (preview != null) Api.previewing = false }
        }
        Chrome.Immersive(preview != null)
        AnimatedContent(
            preview,
            transitionSpec = { (fadeIn(gateMotion.defaultEffectsSpec()) + scaleIn(gateMotion.defaultSpatialSpec(), initialScale = 0.96f)) togetherWith fadeOut(gateMotion.fastEffectsSpec()) },
            label = "preview",
        ) { kind ->
            if (kind == null) return@AnimatedContent
            val close = { ScreenPreview.open = null }
            androidx.activity.compose.BackHandler(onBack = close)
            Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
                when (kind) {
                    "onboarding" -> OnboardingPage(preview = true, local = false, onDone = close)
                    "onboarding-local" -> OnboardingPage(preview = true, local = true, onDone = close)
                    "register" -> RegisterPage(preview = true, onBack = close, onApproved = close, onPending = { ScreenPreview.open = "pending" })
                    "pending" -> PendingPage(preview = true, onApproved = close, onSignOut = close)
                    else -> {
                        var sheet by remember { mutableStateOf(false) }
                        LoginPage(dark, onDone = close, onDemo = close, onRegister = { ScreenPreview.open = "register" }, onLocal = { sheet = true })
                        if (sheet) LocalModeSheet(onDismiss = { sheet = false }, onStart = { sheet = false; ScreenPreview.open = "onboarding-local" })
                    }
                }
            }
        }
    }
}

private const val SharedAxisMillis = 350
private val Emphasized = androidx.compose.animation.core.CubicBezierEasing(0.2f, 0f, 0f, 1f)

@Composable
private fun HomeNewContent(dark: Boolean, onLogoTap: () -> Unit, onOpenTrip: (Trip) -> Unit, onProfile: () -> Unit = {}, onPeople: (Trip) -> Unit = {}, tempPassword: Boolean = false) {
    val cs = MaterialTheme.colorScheme
    val screenH = LocalConfiguration.current.screenHeightDp
    val heroH = (screenH * 0.5f).coerceIn(320f, 560f).dp
    var tab by remember { mutableIntStateOf(0) }
    var globeScale by remember { androidx.compose.runtime.mutableFloatStateOf(1f) }
    var newTrip by remember { mutableStateOf(false) }
    val scroll = rememberScrollState()

    Box(Modifier.fillMaxSize().background(cs.background)) {
        Column(Modifier.fillMaxSize().verticalScroll(scroll)) {
            Box(Modifier.fillMaxWidth().height(heroH)) {
                Globe(
                    tour = true,
                    onTripTap = onOpenTrip,
                    onScale = { globeScale = it },
                    centerLon = 14.0,
                    trips = Data.all.filter { !it.shared },
                    style = GlobeStyle(
                        sphere = if (dark) Color(0xFF101418) else Color(0xFFEADFCE),
                        land = if (dark) Color(0xFF29313A) else Color(0xFFD8C9AD),
                        dark = dark,
                    ),
                    modifier = Modifier.fillMaxSize(),
                )
                Box(
                    Modifier.fillMaxWidth().height(heroH * 0.38f).align(Alignment.BottomCenter)
                        .background(Brush.verticalGradient(0f to Color.Transparent, 0.8f to cs.background)),
                )
                Column(Modifier.padding(horizontal = Pad)) {
                    Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
                    TopRow(onLogoTap, needle = { (globeScale - 1f) * 660f }, onProfile = onProfile)
                }
            }

            // With the update card there, the card and the page under it move up over the globe's faded edge,
            // so the card does not sit alone in the empty band and the trips are not pushed far down.
            val update = Updates.updater?.state?.collectAsState()?.value
            val cardShown = update != null && update !is nl.markmaaktmedia.markupdate.UpdateState.Idle &&
                update !is nl.markmaaktmedia.markupdate.UpdateState.Checking && update !is nl.markmaaktmedia.markupdate.UpdateState.UpToDate
            val lift by androidx.compose.animation.core.animateDpAsState(if (cardShown) 120.dp else 0.dp, MaterialTheme.motionScheme.defaultSpatialSpec(), label = "updateLift")
            Column(Modifier.layout { m, c ->
                val p = m.measure(c)
                val up = lift.roundToPx()
                layout(p.width, (p.height - up).coerceAtLeast(0)) { p.place(0, -up) }
            }.padding(horizontal = Pad)) {
                // A newer build: the update card all of Marks apps share, at the top of the page (Update.kt).
                MmsUpdateCard(Modifier.padding(top = 8.dp, bottom = 6.dp))
                // After an admin reset: choose your own password, until you did.
                TempPasswordBar(Data.live && (Data.me?.mustChange == true || tempPassword), onOpen = onProfile, modifier = Modifier.padding(top = 4.dp, bottom = 10.dp))
                // The new-trip button stays where it was: beside the heading.
                Row(Modifier.fillMaxWidth().padding(top = 8.dp).arrive(0), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        stringResource(R.string.nav_trips),
                        style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 32.sp, letterSpacing = (-0.02).em, color = cs.onBackground),
                        modifier = Modifier.weight(1f),
                    )
                    Button(onClick = { if (Data.live) newTrip = true }, shapes = ButtonDefaults.shapes(), contentPadding = PaddingValues(start = 16.dp, end = 20.dp, top = 12.dp, bottom = 12.dp)) {
                        LineIcon(Glyphs.plus, cs.onPrimary, size = 18.dp, stroke = 2.6f)
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.home_new_trip), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp))
                    }
                }
                // The first time after signing in nothing is read yet: quiet shapes of the
                // real cards' size stand in, and fade over into the trips once they are there.
                val listMotion = MaterialTheme.motionScheme
                AnimatedContent(
                    Data.loading,
                    transitionSpec = { fadeIn(listMotion.slowEffectsSpec()) togetherWith fadeOut(listMotion.defaultEffectsSpec()) },
                    label = "loading",
                ) { loading ->
                    if (loading) HomePlaceholders() else Column {
                        if (Data.upcoming.isNotEmpty()) SectionTitle(stringResource(R.string.home_upcoming), Modifier.padding(top = 22.dp, bottom = 12.dp).arrive(1))
                        // Every trip of your own under way or to come, not only the first.
                        val upMotion = MaterialTheme.motionScheme
                        Data.upcoming.forEachIndexed { i, next ->
                            // Big by default; "Klein" from its menu makes it a row like the trips below. The change
                            // morphs in place and everything under it slides along.
                            androidx.compose.runtime.key(next.id) {
                                TripCardMorph(
                                    next, big = CardSizePref.big(next.id, autoBig = true), dark = dark, upcoming = true, autoBig = true,
                                    rowTop = 28.dp, rowBottom = 28.dp, onOpen = { onOpenTrip(next) }, onPeopleTrip = onPeople,
                                    modifier = Modifier.padding(top = if (i == 0) 0.dp else 10.dp).arrive(2 + i),
                                )
                            }
                        }
                        if (Data.live && Data.trips.isEmpty()) EmptyTrips()
                        PastOrShared(tab, onTab = { tab = it }, modifier = Modifier.padding(top = 26.dp, bottom = 4.dp).arrive(3))
                        // A trip can be shown big, as the first one here, or as a row with its photo blurred behind it.
                        // Between Afgelopen reizen and Gedeeld the list slides the way of the tab you picked
                        // (Material's shared X axis), instead of swapping in place.
                        val tabMotion = MaterialTheme.motionScheme
                        AnimatedContent(
                            tab,
                            transitionSpec = {
                                val dir = if (targetState > initialState) 1 else -1
                                // In and out overlap with the same timing, so there is never an empty frame between the lists.
                                (slideInHorizontally(tabMotion.defaultSpatialSpec()) { w -> dir * w / 5 } + fadeIn(tabMotion.defaultEffectsSpec())) togetherWith
                                    (slideOutHorizontally(tabMotion.defaultSpatialSpec()) { w -> -dir * w / 5 } + fadeOut(tabMotion.defaultEffectsSpec())) using
                                    androidx.compose.animation.SizeTransform(clip = false)
                            },
                            label = "tabList",
                        ) { which ->
                            Column {
                            val list = if (which == 0) Data.past else Data.sharedTrips
                            // Each trip big or as a row: its own choice from the menu, else the default from Weergave
                            // (Automatisch: the latest one big, the rest rows). Rows next to each other join into a slab.
                            // Every trip is its own item, so changing its size morphs it in place (card to row and
                            // back) while the trips around it slide along, instead of the list being rebuilt.
                            val first = list.firstOrNull()
                            fun isBig(t: Trip) = CardSizePref.big(t.id, autoBig = t.id == first?.id)
                            val sizeMotion = MaterialTheme.motionScheme
                            @Composable
                            fun Item(trip: Trip, big: Boolean, prevBig: Boolean?, nextBig: Boolean?, order: Int) {
                                val gap by animateDpAsState(when { prevBig == null -> 0.dp; big || prevBig -> 10.dp; else -> 3.dp }, sizeMotion.defaultSpatialSpec(), label = "gap")
                                androidx.compose.runtime.key(trip.id) {
                                    // Rows next to each other join into a slab: tight corners inside, round at its ends.
                                    val startOfRun = prevBig != false; val endOfRun = nextBig != false
                                    TripCardMorph(
                                        trip, big = big, dark = dark, upcoming = false, autoBig = trip.id == first?.id,
                                        rowTop = if (startOfRun) 26.dp else 6.dp, rowBottom = if (endOfRun) 26.dp else 6.dp,
                                        onOpen = { onOpenTrip(trip) }, onPeopleTrip = onPeople,
                                        // Arrives once with the page; changing its size never plays that again.
                                        modifier = Modifier.padding(top = gap).arrive(4 + order),
                                    )
                                }
                            }
                            // The latest trip keeps its own place above the years, big or small, so changing its size
                            // morphs it where it is instead of moving it into another list.
                            if (first != null) Box(Modifier.padding(top = 14.dp)) { Item(first, isBig(first), null, null, 0) }
                            list.drop(1).groupBy { it.year }.forEach { (year, trips) ->
                                SectionTitle(year, Modifier.padding(top = 18.dp, bottom = 10.dp), small = true)
                                Column {
                                    trips.forEachIndexed { i, trip ->
                                        Item(trip, isBig(trip), trips.getOrNull(i - 1)?.let { isBig(it) }, trips.getOrNull(i + 1)?.let { isBig(it) }, i)
                                    }
                                }
                            }
                            if ((if (which == 0) Data.past else Data.sharedTrips).isEmpty()) {
                                    Text(
                                        if (which == 0) stringResource(R.string.home_no_past) else stringResource(R.string.home_no_shared),
                                        style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant),
                                        modifier = Modifier.padding(top = 18.dp, start = 4.dp),
                                    )
                            }
                        }
                        }
                    }
                }
                Spacer(Modifier.height(120.dp))
                Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
            }
        }

        // Every trip's cover is fetched ahead once the list is known (the big cards in their bigger size), so
        // scrolling down never meets empty tiles that only fill in after you have passed them.
        androidx.compose.runtime.LaunchedEffect(Data.version, Data.loading) {
            if (Data.loading) return@LaunchedEffect
            // The tiles on screen ask first; the rest of the list queues behind them.
            kotlinx.coroutines.delay(400)
            val all = Data.all
            Photos.prefetch(all.mapNotNull { t -> t.coverId.takeIf { !CardSizePref.big(t.id, autoBig = false) || true } }, "thumbnail")
            Photos.prefetch(all.filter { CardSizePref.big(it.id, autoBig = it == Data.past.firstOrNull() || it in Data.upcoming) }.mapNotNull { it.coverId }, "preview")
        }
        if (newTrip) NewTripSheet(onDismiss = { newTrip = false }, onCreated = { id ->
            newTrip = false
            Data.all.firstOrNull { it.id == id }?.let(onOpenTrip)
        })
        // No band behind the clock here: the homepage runs full screen under it (Mark found the fading band ugly).

    }
}

/** Outer corners round, inner ones tight: one slab of rows, as groupedShape in Tandem. */
private fun slab(i: Int, n: Int): Shape {
    val big = 26.dp
    val small = 6.dp
    return RoundedCornerShape(
        topStart = if (i == 0) big else small,
        topEnd = if (i == 0) big else small,
        bottomStart = if (i == n - 1) big else small,
        bottomEnd = if (i == n - 1) big else small,
    )
}

/** Tandem's bouncyClickable: the ripple at full size, the content dipping on a spring. */
private fun Modifier.bouncyClickable(onClick: () -> Unit = {}, feel: Haptic? = Haptic.Tap, rippled: Boolean = true): Modifier = composed {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(
        if (pressed) 0.96f else 1f,
        MaterialTheme.motionScheme.fastSpatialSpec(),
        label = "press",
    )
    // A light tick under the finger on every tap, as Tandem and PixelPlayer do.
    val haptics = rememberHaptics()
    clickable(source, if (rippled) ripple() else null, onClick = { feel?.let { haptics(it) }; onClick() }).graphicsLayer {
        scaleX = scale
        scaleY = scale
    }
}

@Composable
private fun TopRow(onLogoTap: () -> Unit, needle: () -> Float = { 0f }, onProfile: () -> Unit = {}) {
    val cs = MaterialTheme.colorScheme
    Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(
            Modifier.clip(CircleShape).clickable(onClick = onLogoTap).padding(end = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            // The compass turns with the globe's zoom, as on the web; while the trips are read the first
            // time it spins instead: two turns per 2.8 s with a wind-up and an ease-off (the web's spinner).
            val spin = androidx.compose.animation.core.rememberInfiniteTransition(label = "spin").animateFloat(
                0f, 720f,
                androidx.compose.animation.core.infiniteRepeatable(androidx.compose.animation.core.tween<Float>(2800, easing = androidx.compose.animation.core.CubicBezierEasing(0.6f, 0f, 0.3f, 1f))),
                label = "turns",
            )
            val loading = Data.loading
            LineIcon(Glyphs.logo, cs.primary, size = 34.dp, stroke = 2.1f, modifier = Modifier.graphicsLayer { rotationZ = if (loading) spin.value else needle() })
            Text("MarkMySteps", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(620), fontSize = 23.sp, letterSpacing = (-0.02).em, color = cs.onBackground))
        }
        Spacer(Modifier.weight(1f))
        // Your own face; a tap opens Instellingen.
        Box(
            Modifier.size(42.dp).clip(MaterialShapes.Cookie9Sided.toShape()).background(cs.primaryContainer).bouncyClickable(onProfile),
            contentAlignment = Alignment.Center,
        ) {
            Avatar(Data.me?.id, Data.me?.name ?: "Mark", Data.me?.hasAvatar == true, cs.primary, Modifier.matchParentSize(), MaterialShapes.Cookie9Sided.toShape(), instant = true)
        }
    }
}

@Composable
private fun SectionTitle(text: String, modifier: Modifier = Modifier, small: Boolean = false) {
    val cs = MaterialTheme.colorScheme
    Text(
        text,
        style = TextStyle(
            fontFamily = Outfit, fontWeight = FontWeight(600),
            fontSize = if (small) 15.sp else 21.sp, letterSpacing = (-0.01).em,
            color = if (small) cs.onSurfaceVariant else cs.onBackground,
        ),
        modifier = modifier,
    )
}

/** About the next-trip card's shape (its height follows its content), for where its corner lies on the photo. */
private const val NextCardRatio = 1.6f

/**
 * The next trip as a big card: its colour edge to edge (or its photo, drawn by [TripCardMorph] under this), the
 * days left as a big number, the name and the chips. Its own height follows its content.
 */
@Composable
private fun NextTripContent(trip: Trip, onOpen: () -> Unit, onPeopleTrip: (Trip) -> Unit, autoBig: Boolean) {
    val base = trip.color
    val deep = Color(0xFF1B2440).copy(alpha = 0.55f).compositeOver(base)
    // Under way it counts the days of the trip, before it the days to go; one day is "dag", not "dagen".
    val (big, top, bottom) = when {
        trip.ongoingDay != null -> Triple("${trip.ongoingDay}", stringResource(R.string.home_day_nth), stringResource(R.string.home_of_days, trip.days))
        else -> (trip.startsInDays ?: 0).let { n -> Triple("$n", if (n == 1) stringResource(R.string.home_day) else stringResource(R.string.home_days), stringResource(R.string.home_to_go)) }
    }
    Box(Modifier.fillMaxWidth()) {
        if (trip.coverId != null) {
            Box(Modifier.matchParentSize().background(Brush.verticalGradient(0f to Color.Black.copy(alpha = 0.35f), 0.5f to Color.Black.copy(alpha = 0.2f), 1f to Color.Black.copy(alpha = 0.62f))))
        } else {
            Box(Modifier.matchParentSize().background(Brush.linearGradient(listOf(base, deep))))
            LineIcon(
                Glyphs.compass, Color.White, size = 170.dp, stroke = 1.3f,
                modifier = Modifier.align(Alignment.TopEnd).offset(x = 46.dp, y = (-22).dp).rotate(-12f).alpha(0.16f),
            )
        }
        MenuDots(trip, Modifier.align(Alignment.TopEnd).padding(14.dp), onOpen = onOpen, onPeople = if (trip.remoteId != null) ({ onPeopleTrip(trip) }) else null, autoBig = autoBig, lightCover = lightCorner(trip, NextCardRatio, shade = 0.35f))
        Column(Modifier.fillMaxWidth().padding(20.dp)) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(big, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(800), fontSize = 60.sp, lineHeight = 60.sp, letterSpacing = (-0.03).em, color = Color.White))
                Column(Modifier.padding(start = 10.dp, bottom = 9.dp)) {
                    Text(top, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 17.sp, color = Color.White))
                    Text(bottom, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = Color.White.copy(alpha = 0.8f)))
                }
            }
            Row(Modifier.padding(top = 26.dp), verticalAlignment = Alignment.CenterVertically) {
                // At most two lines, then an ellipsis, on every card and row (as on the iPhone).
                Text(
                    trip.title, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false),
                    style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 25.sp, letterSpacing = (-0.015).em, color = Color.White),
                )
                // Under way: a green dot that pulses every 1.8 s, as on the web.
                if (trip.ongoingDay != null) OngoingDot(Modifier.padding(start = 10.dp))
            }
            Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Chip("${shortMonthName(trip.month)} ${trip.year}")
                Chip(androidx.compose.ui.res.pluralStringResource(R.plurals.home_days_chip, trip.days, trip.days))
                Spacer(Modifier.weight(1f))
                FaceStack(trip.people, trip.extraPeople, ring = deep)
            }
        }
    }
}

@Composable
private fun Chip(text: String) {
    Text(
        text,
        style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 12.5.sp, color = Color.White),
        modifier = Modifier.glass(CircleShape).padding(horizontal = 11.dp, vertical = 6.dp),
    )
}

/** The photo behind a card's pills and ⋯, when the card has one, so they can blur it a little. */
private val LocalCardHaze = androidx.compose.runtime.staticCompositionLocalOf<dev.chrisbanes.haze.HazeState?> { null }

/**
 * White and half see-through, over a light blur of the photo behind it where there is one. [veil] is how
 * white: the approved 0.18, more where the photo behind is light, so what sits on it stays readable.
 */
@Composable
private fun Modifier.glass(shape: Shape, veil: Float = GlassVeil): Modifier {
    val haze = LocalCardHaze.current
    return this.clip(shape).then(
        if (haze != null) Modifier.hazeEffect(haze) {
            blurRadius = 14.dp
            tints = listOf(dev.chrisbanes.haze.HazeTint(Color.White.copy(alpha = veil)))
        } else Modifier.background(Color.White.copy(alpha = veil)),
    )
}

/** The glass's own white, and the stronger one over a light corner of a photo. */
private const val GlassVeil = 0.18f
private const val GlassVeilLight = 0.66f
/** The dots on the stronger glass: the dark ink of the "+n" faces, the same in light and dark mode (the photo decides). */
private val GlassInk = Color(0xFF1B2530)

/**
 * Whether the top right corner of a card's cover, where the ⋯ sits, is too light for white dots: the corner of
 * the thumbnail as the card crops it, under the card's own darkening at the top ([shade], black alpha) and the
 * glass's white, measured as relative luminance. White dots need 3:1, so above a luminance of 0.3 the glass
 * turns whiter and the dots dark. A light sky behind white dots read at 1.44:1.
 */
@Composable
private fun lightCorner(trip: Trip, cardRatio: Float, shade: Float = 0f): Boolean {
    val id = trip.coverId ?: return false
    val light by androidx.compose.runtime.produceState(false, id, cardRatio, shade) {
        val bitmap = Photos.load(id, "thumbnail") ?: return@produceState
        value = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) { cornerLuminance(bitmap, cardRatio, shade) > 0.3f }
    }
    return light
}

/** The mean relative luminance of where the ⋯ sits on a card of [cardRatio] (width over height), as drawn. */
private fun cornerLuminance(b: android.graphics.Bitmap, cardRatio: Float, shade: Float): Float {
    val bw = b.width.toFloat(); val bh = b.height.toFloat()
    if (bw <= 0f || bh <= 0f) return 0f
    // ContentScale.Crop: the part of the picture that shows on the card.
    val (vw, vh) = if (bw / bh > cardRatio) bh * cardRatio to bh else bw to bw / cardRatio
    val ox = (bw - vw) / 2f; val oy = (bh - vh) / 2f
    // The disc on a card about 380 dp wide: 14 dp from the edges, 40 dp across, with a little room around it.
    val cardW = 380f; val cardH = cardW / cardRatio
    val x0 = (ox + vw * (1f - 58f / cardW)).toInt().coerceIn(0, b.width - 1)
    val x1 = (ox + vw * (1f - 10f / cardW)).toInt().coerceIn(x0 + 1, b.width)
    val y0 = (oy + vh * (10f / cardH)).toInt().coerceIn(0, b.height - 1)
    val y1 = (oy + vh * (58f / cardH)).toInt().coerceIn(y0 + 1, b.height)
    fun lin(c: Float) = if (c <= 0.04045f) c / 12.92f else Math.pow(((c + 0.055f) / 1.055f).toDouble(), 2.4).toFloat()
    var sum = 0f; var n = 0
    val step = maxOf(1, (x1 - x0) / 12)
    for (y in y0 until y1 step step) for (x in x0 until x1 step step) {
        val p = b.getPixel(x, y)
        // Blended as Compose draws them, in sRGB: the card's darkening first, then the glass's white over it.
        fun ch(v: Int) = lin(GlassVeil + (1f - GlassVeil) * (v / 255f) * (1f - shade))
        sum += 0.2126f * ch((p shr 16) and 0xFF) + 0.7152f * ch((p shr 8) and 0xFF) + 0.0722f * ch(p and 0xFF)
        n++
    }
    return if (n == 0) 0f else sum / n
}

@Composable
private fun FaceStack(people: List<Person>, extraIn: Int, ring: Color) {
    // Two faces, then how many more: three people show two faces and "+1".
    val faces = people.take(if (people.size + extraIn <= 3) 3 else 2)
    val extra = people.size - faces.size + extraIn
    val count = faces.size + if (extra > 0) 1 else 0
    val size = 32.dp
    val step = 21.dp
    Box(Modifier.width(size + step * (count - 1)).height(size)) {
        faces.forEachIndexed { i, p ->
            Box(
                Modifier.offset(x = step * i).size(size).background(ring, CircleShape).padding(2.dp),
                contentAlignment = Alignment.Center,
            ) { Avatar(p.userId, p.name, p.hasAvatar, p.color, Modifier.matchParentSize()) }
        }
        if (extra > 0) {
            Box(
                Modifier.offset(x = step * faces.size).size(size).background(ring, CircleShape).padding(2.dp)
                    .background(Color.White.copy(alpha = 0.92f), CircleShape),
                contentAlignment = Alignment.Center,
            ) { Text("+$extra", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 11.5.sp, color = Color(0xFF1B2530))) }
        }
    }
}

/** Past or shared: a connected toggle group, the open one filled and fully round. */
@Composable
private fun PastOrShared(tab: Int, onTab: (Int) -> Unit, modifier: Modifier = Modifier) {
    val haptics = rememberHaptics()
    val options = listOf(stringResource(R.string.home_past) to Data.past.size, stringResource(R.string.home_shared) to Data.shared)
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(ButtonGroupDefaults.ConnectedSpaceBetween)) {
        options.forEachIndexed { i, (label, count) ->
            ToggleButton(
                checked = tab == i,
                onCheckedChange = { if (tab != i) haptics(Haptic.Tick); onTab(i) },
                modifier = Modifier.weight(1f).height(52.dp),
                shapes = when (i) {
                    0 -> ButtonGroupDefaults.connectedLeadingButtonShapes()
                    else -> ButtonGroupDefaults.connectedTrailingButtonShapes()
                },
                colors = ToggleButtonDefaults.toggleButtonColors(
                    containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                    contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    checkedContainerColor = MaterialTheme.colorScheme.primary,
                    checkedContentColor = MaterialTheme.colorScheme.onPrimary,
                ),
            ) {
                Text(label, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp))
                Spacer(Modifier.width(8.dp))
                // The count in the label's own colour, a lighter weight to set it apart (dimming it fell under the contrast line).
                Text("$count", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(500), fontSize = 15.sp))
            }
        }
    }
}

/**
 * The trip menu, as Material 3 Expressive's segmented menu: rounded groups with a gap between them, as on the
 * web. Open and share; the card's size with a tick on the chosen one; rename and delete (or leave a trip
 * someone else made). No shadow: the groups stand off the page by their own tone and a fine edge.
 */
@Composable
private fun MenuDots(trip: Trip, modifier: Modifier = Modifier, onOpen: () -> Unit = {}, onPeople: (() -> Unit)? = null, light: Boolean = true, autoBig: Boolean = false, lightCover: Boolean = false) {
    var menu by remember { mutableStateOf(false) }
    var menuOut by remember { androidx.compose.runtime.mutableFloatStateOf(0f) }
    var renaming by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var leaving by remember { mutableStateOf(false) }
    val cs = MaterialTheme.colorScheme
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val remote = trip.remoteId != null
    val mine = remote && (trip.ownerId.isNullOrBlank() || trip.ownerId == Data.me?.id)
    val motion = MaterialTheme.motionScheme
    val veil by animateFloatAsState(if (lightCover) GlassVeilLight else GlassVeil, motion.defaultEffectsSpec(), label = "dotsVeil")
    val dots by animateColorAsState(if (lightCover) GlassInk else Color.White, motion.defaultEffectsSpec(), label = "dotsInk")
    Box(modifier) {
        Box(
            // A solid tonal disc on photos, so the dots read on a bright sky too.
            // Same white glass on every photo; over a light corner it is less see-through and the dots go dark.
            // Hidden as a whole (its glass too) while the menu is out: the menu is this button then.
            Modifier.graphicsLayer { alpha = 1f - menuOut }.size(40.dp).then(if (light) Modifier.glass(CircleShape, veil = veil) else Modifier.clip(CircleShape)).bouncyClickable({ menu = true }, feel = null).a11y(stringResource(R.string.a11y_more)), // the menu ticks as it opens
            contentAlignment = Alignment.Center,
        ) { LineIcon(Glyphs.dotsCircles, if (light) dots else cs.onSurfaceVariant, size = 20.dp, filled = true) }
        val chosen = CardSizePref.overrides[trip.id] ?: CardSizePref.AUTO
        AppMenu(menu, onDismiss = { menu = false }, groups = listOf(
            listOf(
                MenuEntry(stringResource(R.string.home_size_auto), Glyphs.cardAuto, selected = chosen == CardSizePref.AUTO, inline = true) { CardSizePref.set(trip.id, null) },
                MenuEntry(stringResource(R.string.home_size_large), Glyphs.cardLarge, selected = chosen == CardSizePref.LARGE, inline = true) { CardSizePref.set(trip.id, CardSizePref.LARGE) },
                MenuEntry(stringResource(R.string.home_size_small), Glyphs.cardRow, selected = chosen == CardSizePref.COMPACT, inline = true) { CardSizePref.set(trip.id, CardSizePref.COMPACT) },
            ) + when {
                !remote -> emptyList()
                mine -> listOf(MenuEntry(stringResource(R.string.home_rename), Glyphs.pencil) { renaming = true }, MenuEntry(stringResource(R.string.home_delete), Glyphs.trash, danger = true) { deleting = true })
                else -> listOf(MenuEntry(stringResource(R.string.home_leave), Glyphs.signOut, danger = true) { leaving = true })
            },
        ), buttonColor = if (light) Color.White.copy(alpha = veil.coerceIn(0.5f, 0.95f)) else Color.Transparent, onShowing = { menuOut = it })
    }
    if (renaming) {
        var title by remember { mutableStateOf(trip.title) }
        var busy by remember { mutableStateOf(false) }
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { if (!busy) renaming = false },
            title = { Text(stringResource(R.string.home_rename), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 20.sp)) },
            text = { TripField(title, { title = it.take(120) }) },
            confirmButton = {
                DialogButtons(stringResource(R.string.home_save), danger = false, enabled = !busy && title.isNotBlank() && title.trim() != trip.title, onConfirm = {
                    busy = true
                    scope.launch { runCatching { Remote.renameTrip(trip, title) }; Data.load(); busy = false; renaming = false }
                }, onDismiss = { renaming = false })
            },
        )
    }
    if (deleting) {
        // As on the web: the trip's name typed out first, because it cannot be undone.
        var typed by remember { mutableStateOf("") }
        var busy by remember { mutableStateOf(false) }
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { if (!busy) deleting = false },
            title = { Text(stringResource(R.string.home_delete_title), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 20.sp)) },
            text = {
                Column {
                    Text(stringResource(R.string.home_delete_body, trip.title), style = TextStyle(fontFamily = Inter, fontSize = 15.sp))
                    Text(stringResource(R.string.home_delete_type), style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 14.dp, bottom = 8.dp))
                    TripField(typed, { typed = it }, placeholder = trip.title)
                }
            },
            confirmButton = {
                DialogButtons(stringResource(R.string.home_delete), danger = true, enabled = !busy && typed.trim() == trip.title.trim(), onConfirm = {
                    busy = true
                    scope.launch { runCatching { Remote.deleteTrip(trip) }; CardSizePref.set(trip.id, null); Data.load(); busy = false; deleting = false }
                }, onDismiss = { deleting = false })
            },
        )
    }
    if (leaving) {
        var busy by remember { mutableStateOf(false) }
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { if (!busy) leaving = false },
            title = { Text(stringResource(R.string.home_leave_title), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 20.sp)) },
            text = { Text(stringResource(R.string.home_leave_body, trip.title), style = TextStyle(fontFamily = Inter, fontSize = 15.sp)) },
            confirmButton = {
                DialogButtons(stringResource(R.string.home_leave_confirm), danger = true, enabled = !busy, onConfirm = {
                    busy = true
                    scope.launch { runCatching { Remote.leaveTrip(trip) }; Data.load(); busy = false; leaving = false }
                }, onDismiss = { leaving = false })
            },
        )
    }
}

/** A text field in the app's own style: a tonal rounded box, as the name field of Nieuwe reis. */
@Composable
private fun TripField(value: String, onChange: (String) -> Unit, placeholder: String = "") {
    val cs = MaterialTheme.colorScheme
    Box(Modifier.fillMaxWidth().height(54.dp).clip(RoundedCornerShape(18.dp)).background(cs.surfaceContainerHighest).padding(horizontal = 16.dp), contentAlignment = Alignment.CenterStart) {
        if (value.isEmpty() && placeholder.isNotEmpty()) Text(placeholder, style = TextStyle(fontFamily = Inter, fontSize = 16.sp, color = cs.onSurfaceVariant.copy(alpha = 0.7f)))
        androidx.compose.foundation.text.BasicTextField(value, onChange, singleLine = true, textStyle = TextStyle(fontFamily = Inter, fontSize = 16.sp, color = cs.onSurface),
            cursorBrush = androidx.compose.ui.graphics.SolidColor(cs.primary), modifier = Modifier.fillMaxWidth().clearOfKeyboard(room = 40.dp))
    }
}

/**
 * How a block arrives the first time the page shows: up a little and in, each
 * a beat after the one above, on the motion scheme's spatial spring.
 */
private fun Modifier.arrive(order: Int): Modifier = composed {
    val shown = remember { Animatable(0f) }
    val spatial = MaterialTheme.motionScheme.defaultSpatialSpec<Float>()
    LaunchedEffect(Unit) {
        delay(order * 45L)
        shown.animateTo(1f, spatial)
    }
    graphicsLayer {
        alpha = shown.value.coerceIn(0f, 1f)
        translationY = (1f - shown.value) * 28.dp.toPx()
    }
}

/**
 * A trip shown big, over its photo (drawn by [TripCardMorph] under this): the name and facts at the bottom, the
 * menu in the corner. It fills the height it is given, so while the card grows the name stays at its foot.
 */
@Composable
private fun BigTripContent(trip: Trip, onOpen: () -> Unit, onPeopleTrip: (Trip) -> Unit, autoBig: Boolean) {
    Box(Modifier.fillMaxSize()) {
        if (trip.coverId == null && trip.remoteId != null) {
            // No photo: the trip's own colour with the compass in the corner, as the next-trip card, clear of the title.
            val deep = Color(0xFF1B2440).copy(alpha = 0.55f).compositeOver(trip.color)
            Box(Modifier.matchParentSize().background(Brush.linearGradient(listOf(trip.color, deep))))
            LineIcon(
                Glyphs.compass, Color.White, size = 190.dp, stroke = 1.3f,
                modifier = Modifier.align(Alignment.TopEnd).offset(x = 50.dp, y = (-26).dp).rotate(-12f).alpha(0.16f),
            )
        } else {
            Box(Modifier.matchParentSize().background(Brush.verticalGradient(0.35f to Color.Transparent, 1f to Color(0xC010151B))))
        }
        MenuDots(trip, Modifier.align(Alignment.TopEnd).padding(14.dp), onOpen = onOpen, onPeople = if (trip.remoteId != null) ({ onPeopleTrip(trip) }) else null, autoBig = autoBig, lightCover = lightCorner(trip, 16f / 11f))
        Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(20.dp)) {
            Text(trip.title, maxLines = 2, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 26.sp, letterSpacing = (-0.015).em, color = Color.White))
            Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Chip("${shortMonthName(trip.month)} ${trip.year}")
                Chip(androidx.compose.ui.res.pluralStringResource(R.plurals.home_days_chip, trip.days, trip.days))
                trip.km?.takeIf { it > 0 }?.let { Chip("%,d km".format(Lang.locale, it)) }
                Spacer(Modifier.weight(1f))
                FaceStack(trip.people, trip.extraPeople, ring = Color(0xFF2A2F36))
            }
        }
    }
}

/**
 * A trip as a row in its year's slab, without its thumbnail: [TripCardMorph] draws that photo in the empty slot
 * at the start, so it can grow into the big card's photo. The facts and a menu.
 */
@Composable
private fun TripRowContent(trip: Trip, onOpen: () -> Unit, onPeopleTrip: (Trip) -> Unit, autoBig: Boolean) {
    val cs = MaterialTheme.colorScheme
    Row(Modifier.fillMaxWidth().padding(RowInset), verticalAlignment = Alignment.CenterVertically) {
        // Every row has its thumbnail, so all titles line up; a trip without a photo shows its colour and compass.
        Spacer(Modifier.size(RowThumb))
        Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
            Text(trip.title, maxLines = 2, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 18.sp, lineHeight = 21.sp, color = cs.onSurface))
            // No distance measured: say nothing rather than "0 km".
            val km = trip.km?.takeIf { it > 0 }?.let { " · " + "%,d".format(Lang.locale, it) + " km" } ?: ""
            Text(stringResource(R.string.home_trip_line_new, DateText.longMonth(trip.month), trip.year, pluralStringResource(R.plurals.home_trip_days, trip.days, trip.days), km), maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = cs.onSurfaceVariant))
        }
        MenuDots(trip, onOpen = onOpen, onPeople = if (trip.remoteId != null) ({ onPeopleTrip(trip) }) else null, light = false, autoBig = autoBig)
    }
}

/** The row's thumbnail and the room around it, shared by the row and the morph that draws the photo. */
private val RowThumb = 64.dp
private val RowInset = 10.dp

/**
 * A trip that changes size from its menu (Auto, Groot, Klein) as one element, not as one card fading out and
 * another fading in: its height runs from the row's to the big card's, its photo grows out of the row's
 * thumbnail to edge to edge, the corners round off, and the row's text fades over into the card's. The trips
 * under it move along with its height, so nothing jumps; the thumbnail already on screen stands in while the
 * sharper photo of the big card loads, so the photo never pops in late. [rowTop] and [rowBottom] are the row's
 * corners (tight inside a slab of rows, round at its ends); they follow the neighbours softly too.
 */
@Composable
private fun TripCardMorph(
    trip: Trip, big: Boolean, dark: Boolean, upcoming: Boolean, autoBig: Boolean,
    rowTop: androidx.compose.ui.unit.Dp, rowBottom: androidx.compose.ui.unit.Dp,
    onOpen: () -> Unit, onPeopleTrip: (Trip) -> Unit, modifier: Modifier = Modifier,
) {
    val cs = MaterialTheme.colorScheme
    val motion = MaterialTheme.motionScheme
    // Calm and without overshoot: the expressive spring bounced, so the bottom edge went past and came back.
    val calm = androidx.compose.animation.core.spring<Float>(dampingRatio = 1f, stiffness = 380f)
    val calmDp = androidx.compose.animation.core.spring<androidx.compose.ui.unit.Dp>(dampingRatio = 1f, stiffness = 380f)
    val t by animateFloatAsState(if (big) 1f else 0f, calm, label = "cardSize")
    val k = t.coerceIn(0f, 1f)
    val top by animateDpAsState(rowTop, calmDp, label = "rowTop")
    val bottom by animateDpAsState(rowBottom, calmDp, label = "rowBottom")
    val round = 32.dp
    val shape = RoundedCornerShape(
        topStart = androidx.compose.ui.unit.lerp(top, round, k), topEnd = androidx.compose.ui.unit.lerp(top, round, k),
        bottomStart = androidx.compose.ui.unit.lerp(bottom, round, k), bottomEnd = androidx.compose.ui.unit.lerp(bottom, round, k),
    )
    // The row takes on the tone of its cover photo, tinted enough to read on; it flows
    // over from the plain surface once the photo is there instead of popping in.
    val tone = coverTone(trip)
    val bg by animateColorAsState(
        tone?.let { it.copy(alpha = if (dark) 0.34f else 0.24f).compositeOver(cs.surfaceContainerLow) } ?: cs.surfaceContainerLow,
        motion.slowEffectsSpec(), label = "rowTone",
    )
    // Both faces are there only while it changes; at rest just the one on show (one menu, one set of texts).
    val moving = if (big) t < 0.999f else t > 0.001f
    val showRow = !big || moving
    val showCard = big || moving
    val rowAlpha = (1f - k / 0.5f).coerceIn(0f, 1f)
    val cardAlpha = ((k - 0.4f) / 0.6f).coerceIn(0f, 1f)
    // The big past card blurs its photo behind its pills and the ⋯; the next-trip card never did.
    val haze = dev.chrisbanes.haze.rememberHazeState()
    val blurs = !upcoming && (trip.coverId != null || trip.remoteId == null)
    // The last height of each face, for the frames in which one of them is not there.
    val heights = remember { intArrayOf(0, 0) }
    val density = androidx.compose.ui.platform.LocalDensity.current
    val thumb = with(density) { RowThumb.roundToPx() }
    val inset = with(density) { RowInset.roundToPx() }
    androidx.compose.ui.layout.Layout(
        contents = listOf(
            {
                // The one photo: the thumbnail in the row, the sharper one on the big card, the thumbnail standing in.
                Cover(
                    trip, Modifier.clip(RoundedCornerShape(androidx.compose.ui.unit.lerp(18.dp, 0.dp, k))).then(if (blurs) Modifier.hazeSource(haze) else Modifier),
                    size = if (big || moving) "preview" else "thumbnail", placeholder = "thumbnail",
                )
            },
            { if (showRow) TripRowContent(trip, onOpen, onPeopleTrip, autoBig) },
            {
                if (showCard) androidx.compose.runtime.CompositionLocalProvider(LocalCardHaze provides haze.takeIf { blurs }) {
                    if (upcoming) NextTripContent(trip, onOpen, onPeopleTrip, autoBig) else BigTripContent(trip, onOpen, onPeopleTrip, autoBig)
                }
            },
        ),
        modifier = modifier.fillMaxWidth().clip(shape).background(bg).bouncyClickable(onOpen),
    ) { (cover, row, card), c ->
        val w = c.maxWidth
        val loose = androidx.compose.ui.unit.Constraints(minWidth = w, maxWidth = w)
        val rowP = row.firstOrNull()?.measure(loose)
        if (rowP != null) heights[0] = rowP.height
        val hr = heights[0].takeIf { it > 0 } ?: (thumb + 2 * inset)
        // The past card is 16:11 and is laid out at the height of the moment; the next-trip card is as tall as
        // its content and is cut off by the corners while it grows.
        val cardLoose = if (upcoming) card.firstOrNull()?.measure(loose) else null
        if (cardLoose != null) heights[1] = cardLoose.height
        val hb = if (upcoming) heights[1].takeIf { it > 0 } ?: (w * 0.6f).roundToInt() else (w * 11f / 16f).roundToInt()
        val h = (hr + (hb - hr) * t).roundToInt().coerceAtLeast(1)
        val cardP = if (upcoming) cardLoose else card.firstOrNull()?.measure(androidx.compose.ui.unit.Constraints.fixed(w, h))
        // The photo: from the row's thumbnail spot to the whole card.
        val cw = (thumb + (w - thumb) * k).roundToInt()
        val ch = (thumb + (h - thumb) * k).roundToInt()
        val coverP = cover.firstOrNull()?.measure(androidx.compose.ui.unit.Constraints.fixed(cw, ch))
        layout(w, h) {
            coverP?.place((inset * (1f - k)).roundToInt(), ((hr - thumb) / 2f * (1f - k)).roundToInt())
            rowP?.placeWithLayer(0, 0) { alpha = rowAlpha }
            cardP?.placeWithLayer(0, 0) { alpha = cardAlpha }
        }
    }
}

fun shortMonthName(month: String): String = DateText.shortMonthOf(month)

/**
 * The floating toolbar with the three tabs, the open one widening into a pill
 * with its name. The new-trip button stays beside the heading, where it was.
 */
@Composable
private fun Toolbar(active: Int, onNav: (Int) -> Unit, modifier: Modifier = Modifier) {
    val cs = MaterialTheme.colorScheme
    val items = listOf(Glyphs.compass to stringResource(R.string.nav_trips), Glyphs.friends to stringResource(R.string.nav_travellers), Glyphs.settings to stringResource(R.string.nav_settings))
    val haptics = rememberHaptics()
    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        // Its own light tone and the floating toolbar's soft shadow, so it stands off
        // whatever scrolls under it (the one place Mark wants a shadow).
        HorizontalFloatingToolbar(
            expanded = true,
            colors = FloatingToolbarDefaults.standardFloatingToolbarColors(toolbarContainerColor = cs.surfaceContainerHighest),
            expandedShadowElevation = 8.dp,
        ) {
            // One fixed motion for the pill moving to another tab, so a single tap and quick taps back and forth
            // look the same (springs carried their speed into the next tap and looked different every time).
            val navEase = androidx.compose.animation.core.CubicBezierEasing(0.2f, 0f, 0f, 1f)
            items.forEachIndexed { i, (icon, label) ->
                val on = i == active
                // The orange itself fades out: towards plain transparent (black) it passed through brown.
                val bg by animateColorAsState(if (on) cs.primary else cs.primary.copy(alpha = 0f), androidx.compose.animation.core.tween(260, easing = navEase), label = "navBg")
                Row(
                    // No grey ripple: the pill moving over is the answer to the tap.
                    Modifier.height(48.dp).clip(CircleShape).background(bg).bouncyClickable({ if (!on) haptics(Haptic.Tick); onNav(i) }, feel = null, rippled = false)
                        .a11y(label, androidx.compose.ui.semantics.Role.Tab, selected = on).padding(horizontal = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    // The icon's colour moves with the pill, so it never turns white on beige before the pill is there.
                    val fg by animateColorAsState(if (on) cs.onPrimary else cs.onSurfaceVariant, androidx.compose.animation.core.tween(260, easing = navEase), label = "navFg")
                    LineIcon(icon, fg, size = 22.dp, stroke = if (on) 2.1f else 1.9f)
                    AnimatedVisibility(
                        visible = on,
                        // The pill grows out of its middle, both sides at once, while icon and label stay together.
                        enter = expandHorizontally(androidx.compose.animation.core.tween(260, easing = navEase), expandFrom = Alignment.CenterHorizontally) + fadeIn(androidx.compose.animation.core.tween(200, delayMillis = 60)),
                        exit = shrinkHorizontally(androidx.compose.animation.core.tween(260, easing = navEase), shrinkTowards = Alignment.CenterHorizontally) + fadeOut(androidx.compose.animation.core.tween(120)),
                    ) {
                        Text(
                            label,
                            style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 14.sp, color = cs.onPrimary),
                            modifier = Modifier.padding(start = 8.dp),
                        )
                    }
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
    }
}


/** Stand-ins of the real cards' size while the trips are read: a slow, soft breathing, no shimmer racing across. */
@Composable
private fun HomePlaceholders() {
    val cs = MaterialTheme.colorScheme
    val pulse by androidx.compose.animation.core.rememberInfiniteTransition(label = "pulse").animateFloat(
        initialValue = 0.55f, targetValue = 1f,
        animationSpec = androidx.compose.animation.core.infiniteRepeatable<Float>(
            androidx.compose.animation.core.tween<Float>(1100, easing = androidx.compose.animation.core.FastOutSlowInEasing),
            androidx.compose.animation.core.RepeatMode.Reverse,
        ),
        label = "alpha",
    )
    val tone = cs.surfaceContainerHigh
    Column(Modifier.graphicsLayer { alpha = pulse }) {
        Box(Modifier.padding(top = 26.dp, bottom = 14.dp).size(width = 180.dp, height = 18.dp).clip(CircleShape).background(tone))
        Box(Modifier.fillMaxWidth().height(196.dp).clip(RoundedCornerShape(32.dp)).background(tone))
        Box(Modifier.padding(top = 26.dp).fillMaxWidth().height(52.dp).clip(CircleShape).background(tone))
        Box(Modifier.padding(top = 18.dp).fillMaxWidth().aspectRatio(16f / 11f).clip(RoundedCornerShape(32.dp)).background(tone))
        Column(Modifier.padding(top = 18.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            repeat(3) { i -> Box(Modifier.fillMaxWidth().height(84.dp).clip(slab(i, 3)).background(tone)) }
        }
    }
}


/** Signed in without a single trip yet: say so, and where to begin. */
@Composable
private fun EmptyTrips() {
    val cs = MaterialTheme.colorScheme
    Column(Modifier.padding(top = 24.dp).fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(cs.surfaceContainerLow).padding(22.dp)) {
        LineIcon(Glyphs.compass, cs.primary, size = 34.dp, stroke = 2f)
        Text(stringResource(R.string.home_empty_title), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 20.sp, color = cs.onSurface), modifier = Modifier.padding(top = 12.dp))
        Text(stringResource(R.string.home_empty_body), style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 14.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 4.dp))
    }
}


/** The web's "onderweg" dot: green, its halo breathing out every 1.8 s. */
@Composable
fun OngoingDot(modifier: Modifier = Modifier) {
    val t by androidx.compose.animation.core.rememberInfiniteTransition(label = "ongoing").animateFloat(
        0f, 1f, androidx.compose.animation.core.infiniteRepeatable(androidx.compose.animation.core.tween<Float>(1800)), label = "pulse",
    )
    Box(modifier.size(18.dp), contentAlignment = Alignment.Center) {
        Box(Modifier.size(18.dp).graphicsLayer { scaleX = 0.5f + t; scaleY = 0.5f + t; alpha = 1f - t }.clip(CircleShape).background(Color(0xFF3DDC84)))
        Box(Modifier.size(9.dp).clip(CircleShape).background(Color(0xFF3DDC84)))
    }
}


/** Behind the clock and the battery once a page scrolls under them: the page colour, fading out below. */
@Composable
fun StatusScrim(scroll: androidx.compose.foundation.ScrollState) {
    val cs = MaterialTheme.colorScheme
    val shown by animateFloatAsState(if (scroll.value > 20) 1f else 0f, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "statusScrim")
    Column(Modifier.fillMaxWidth().alpha(shown)) {
        Spacer(Modifier.fillMaxWidth().windowInsetsTopHeight(WindowInsets.statusBars).background(cs.background))
        Spacer(Modifier.fillMaxWidth().height(18.dp).background(Brush.verticalGradient(listOf(cs.background, Color.Transparent))))
    }
}


/** The colour scheme glides to a new theme instead of every colour switching in one frame. */
@Composable
private fun animatedScheme(target: androidx.compose.material3.ColorScheme): androidx.compose.material3.ColorScheme {
    val spec = androidx.compose.animation.core.tween<Color>(380)
    @Composable fun a(c: Color) = animateColorAsState(c, spec, label = "scheme").value
    return target.copy(
        primary = a(target.primary), onPrimary = a(target.onPrimary),
        primaryContainer = a(target.primaryContainer), onPrimaryContainer = a(target.onPrimaryContainer),
        secondaryContainer = a(target.secondaryContainer), onSecondaryContainer = a(target.onSecondaryContainer),
        tertiaryContainer = a(target.tertiaryContainer), onTertiaryContainer = a(target.onTertiaryContainer),
        background = a(target.background), onBackground = a(target.onBackground),
        surface = a(target.surface), onSurface = a(target.onSurface), onSurfaceVariant = a(target.onSurfaceVariant),
        surfaceContainerLowest = a(target.surfaceContainerLowest), surfaceContainerLow = a(target.surfaceContainerLow),
        surfaceContainer = a(target.surfaceContainer), surfaceContainerHigh = a(target.surfaceContainerHigh),
        surfaceContainerHighest = a(target.surfaceContainerHighest), outlineVariant = a(target.outlineVariant),
    )
}
