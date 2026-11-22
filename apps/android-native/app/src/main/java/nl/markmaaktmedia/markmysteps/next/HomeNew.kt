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
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.foundation.background
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

private val LightScheme = lightColorScheme(
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

private val DarkScheme = darkColorScheme(
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
fun HomeNew(dark: Boolean, onLogoTap: () -> Unit, startTrip: String? = null, startPage: String? = null) {
    MaterialExpressiveTheme(
        colorScheme = animatedScheme(if (dark) DarkScheme else LightScheme),
        motionScheme = MotionScheme.expressive(),
    ) {
        // First the sign-in, unless signed in already or a test opens a page straight away.
        var gate by androidx.compose.runtime.saveable.rememberSaveable {
            mutableStateOf(if (Api.signedIn || startTrip != null || startPage != null) "app" else "login")
        }
        val scope = androidx.compose.runtime.rememberCoroutineScope()
        LaunchedEffect(Unit) { Data.load() }
        val gateMotion = MaterialTheme.motionScheme
        AnimatedContent(
            gate,
            transitionSpec = { (fadeIn(gateMotion.slowEffectsSpec()) + scaleIn(gateMotion.defaultSpatialSpec(), initialScale = 0.96f)) togetherWith fadeOut(gateMotion.fastEffectsSpec()) },
            label = "gate",
        ) { which ->
        if (which == "login") {
            LoginPage(dark, onDone = { Data.begin(); gate = "app"; scope.launch { Data.load() } }, onDemo = { gate = "app" })
            return@AnimatedContent
        }
        var open by remember { mutableStateOf(Data.all.firstOrNull { it.id == startTrip }) }
        // The adb extra "trip" may name a server trip, by id or title, which only exists once it has loaded.
        LaunchedEffect(Data.version) {
            if (open == null && startTrip != null) open = Data.all.firstOrNull { it.id == startTrip || it.title == startTrip }
        }
        var page by remember { mutableIntStateOf(when (startPage) { "settings" -> 2; "travellers" -> 1; else -> 0 }) }
        val motion = MaterialTheme.motionScheme
        val target = open?.id ?: "page$page"
        // Predictive back: the back gesture seeks this transition, so the page under the
        // finger shrinks and the one it goes back to already shows; letting go finishes
        // it, pulling back springs it into place again.
        val pages = remember { androidx.compose.animation.core.SeekableTransitionState(target) }
        val holder = androidx.compose.runtime.saveable.rememberSaveableStateHolder()
        val backScope = androidx.compose.runtime.rememberCoroutineScope()
        // Exactly as Tandem: one seekable transition drives every page change, the back gesture
        // included. While the finger drags the transition is seeked, letting go plays the same
        // transition on from there, pulling back snaps it home. Nothing is composed twice.
        var fromTabBack by remember { mutableStateOf(false) }
        LaunchedEffect(target) { if (pages.targetState != target) { pages.animateTo(target) }; fromTabBack = false }
        // Off to another tab, the home page forgets where it was scrolled: back on it, it starts at
        // the top. Back from a trip it keeps its place, so you can carry on down the list.
        LaunchedEffect(page) { if (page != 0) holder.removeState("page0") }
        val backTo: String? = when { open != null -> "page$page"; page != 0 -> "page0"; else -> null }
        androidx.activity.compose.PredictiveBackHandler(enabled = backTo != null) { events ->
            val to = backTo ?: return@PredictiveBackHandler
            fromTabBack = open == null
            try {
                events.collect { e -> pages.seekTo(e.progress, to) }
                pages.animateTo(to)
                // Last, so the handler switching itself off cannot cut the animation short.
                if (open != null) open = null else page = 0
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
                            key == "page2" -> SettingsPage(onSignIn = { Data.signOut(); page = 0; gate = "login" })
                            key == "page1" -> TravellersPage()
                            else -> AccountHost(onSignIn = { Data.signOut(); page = 0; gate = "login" }) { openAccount -> HomeNewContent(dark, onLogoTap, onOpenTrip = { open = it }, onProfile = openAccount, onPeople = { Data.peopleFor = it.id; open = it }) }
                        }
                    }
                }
            }
            AnimatedVisibility(
                // Follows where the pages are going, so it is there (and tappable) as soon as a trip is being left.
                visible = !Data.all.any { it.id == pages.targetState },
                modifier = Modifier.align(Alignment.BottomCenter),
                enter = slideInVertically(motion.defaultSpatialSpec()) { it } + fadeIn(motion.defaultEffectsSpec()),
                exit = slideOutVertically(motion.fastSpatialSpec()) { it } + fadeOut(motion.fastEffectsSpec()),
            ) {
                Toolbar(page, onNav = { fromTabBack = false; page = it })
            }
        }
        }
    }
}

private const val SharedAxisMillis = 350
private val Emphasized = androidx.compose.animation.core.CubicBezierEasing(0.2f, 0f, 0f, 1f)

@Composable
private fun HomeNewContent(dark: Boolean, onLogoTap: () -> Unit, onOpenTrip: (Trip) -> Unit, onProfile: () -> Unit = {}, onPeople: (Trip) -> Unit = {}) {
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
                    trips = Data.all,
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

            Column(Modifier.padding(horizontal = Pad)) {
                // The new-trip button stays where it was: beside the heading.
                Row(Modifier.fillMaxWidth().padding(top = 8.dp).arrive(0), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "Reizen",
                        style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 32.sp, letterSpacing = (-0.02).em, color = cs.onBackground),
                        modifier = Modifier.weight(1f),
                    )
                    Button(onClick = { if (Data.live) newTrip = true }, shapes = ButtonDefaults.shapes(), contentPadding = PaddingValues(start = 16.dp, end = 20.dp, top = 12.dp, bottom = 12.dp)) {
                        LineIcon(Glyphs.plus, cs.onPrimary, size = 18.dp, stroke = 2.6f)
                        Spacer(Modifier.width(8.dp))
                        Text("Nieuwe reis", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp))
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
                        if (Data.upcoming.isNotEmpty()) SectionTitle("Aankomend & onderweg", Modifier.padding(top = 22.dp, bottom = 12.dp).arrive(1))
                        // Every trip of your own under way or to come, not only the first.
                        Data.upcoming.forEachIndexed { i, next ->
                            // Big by default; "Klein" from its menu makes it a row like the trips below.
                            val m = Modifier.padding(top = if (i == 0) 0.dp else 10.dp).arrive(2 + i)
                            if (CardSizePref.big(next.id, autoBig = true)) NextTripCard(next, onOpen = { onOpenTrip(next) }, onPeopleTrip = onPeople, modifier = m)
                            else TripRow(next, RoundedCornerShape(28.dp), dark, onOpen = { onOpenTrip(next) }, onPeopleTrip = onPeople, modifier = m, autoBig = true)
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
                                (slideInHorizontally(tabMotion.defaultSpatialSpec()) { w -> dir * w / 5 } + fadeIn(tabMotion.defaultEffectsSpec())) togetherWith
                                    (slideOutHorizontally(tabMotion.defaultSpatialSpec()) { w -> -dir * w / 5 } + fadeOut(tabMotion.fastEffectsSpec())) using
                                    androidx.compose.animation.SizeTransform(clip = false)
                            },
                            label = "tabList",
                        ) { which ->
                            Column {
                            val list = if (which == 0) Data.past else Data.sharedTrips
                            // Each trip big or as a row: its own choice from the menu, else the default from Weergave
                            // (Automatisch: the latest one big, the rest rows). Rows next to each other join into a slab.
                            val first = list.firstOrNull()
                            val firstBig = first != null && CardSizePref.big(first.id, autoBig = true)
                            if (first != null && firstBig) BigTripCard(first, onOpen = { onOpenTrip(first) }, onPeopleTrip = onPeople, modifier = Modifier.padding(top = 14.dp).arrive(4), autoBig = true)
                            (if (firstBig) list.drop(1) else list).groupBy { it.year }.forEach { (year, trips) ->
                                SectionTitle(year, Modifier.padding(top = 18.dp, bottom = 10.dp), small = true)
                                val runs = mutableListOf<MutableList<Trip>>()
                                trips.forEach { t ->
                                    val big = CardSizePref.big(t.id, autoBig = t.id == first?.id)
                                    val last = runs.lastOrNull()
                                    if (!big && last != null && !CardSizePref.big(last.last().id, autoBig = last.last().id == first?.id)) last += t else runs += mutableListOf(t)
                                }
                                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                    runs.forEach { run ->
                                        val lone = run.single().takeIf { run.size == 1 }
                                        if (lone != null && CardSizePref.big(lone.id, autoBig = lone.id == first?.id)) {
                                            BigTripCard(lone, onOpen = { onOpenTrip(lone) }, onPeopleTrip = onPeople, modifier = Modifier.arrive(5), autoBig = lone.id == first?.id)
                                        } else Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                            run.forEachIndexed { i, trip -> TripRow(trip, slab(i, run.size), dark, onOpen = { onOpenTrip(trip) }, onPeopleTrip = onPeople, modifier = Modifier.arrive(5 + i), autoBig = trip.id == first?.id) }
                                        }
                                    }
                                }
                            }
                            if ((if (which == 0) Data.past else Data.sharedTrips).isEmpty()) {
                                    Text(
                                        if (which == 0) "Nog geen afgelopen reizen" else "Nog niemand deelde een reis met je",
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

        if (newTrip) NewTripSheet(onDismiss = { newTrip = false }, onCreated = { id ->
            newTrip = false
            Data.all.firstOrNull { it.id == id }?.let(onOpenTrip)
        })
        // Behind the clock and the battery once the page scrolls under them.
        val scrim by animateFloatAsState(if (scroll.value > 40) 1f else 0f, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "scrim")
        Column(Modifier.fillMaxWidth().alpha(scrim)) {
            Spacer(Modifier.fillMaxWidth().windowInsetsTopHeight(WindowInsets.statusBars).background(cs.background))
            Spacer(Modifier.fillMaxWidth().height(18.dp).background(Brush.verticalGradient(listOf(cs.background, Color.Transparent))))
        }

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
private fun Modifier.bouncyClickable(onClick: () -> Unit = {}): Modifier = composed {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(
        if (pressed) 0.96f else 1f,
        MaterialTheme.motionScheme.fastSpatialSpec(),
        label = "press",
    )
    clickable(source, ripple(), onClick = onClick).graphicsLayer {
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
            Avatar(Data.me?.id, Data.me?.name ?: "Mark", Data.me?.hasAvatar == true, cs.primary, Modifier.matchParentSize(), MaterialShapes.Cookie9Sided.toShape())
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

/** The next trip: its colour edge to edge, the days left as a big number and a wavy bar. */
@Composable
private fun NextTripCard(trip: Trip, onOpen: () -> Unit, modifier: Modifier = Modifier, onPeopleTrip: (Trip) -> Unit = {}, autoBig: Boolean = true) {
    val shape = RoundedCornerShape(32.dp)
    val base = trip.color
    val deep = Color(0xFF1B2440).copy(alpha = 0.55f).compositeOver(base)
    // Under way it counts the days of the trip, before it the days to go; one day is "dag", not "dagen".
    val (big, top, bottom) = when {
        trip.ongoingDay != null -> Triple("${trip.ongoingDay}", "e dag", "van ${trip.days}, onderweg")
        else -> (trip.startsInDays ?: 0).let { n -> Triple("$n", if (n == 1) "dag" else "dagen", "tot vertrek") }
    }
    Box(modifier.fillMaxWidth().clip(shape).background(Brush.linearGradient(listOf(base, deep))).bouncyClickable(onOpen)) {
        if (trip.coverId != null) {
            Cover(trip, Modifier.matchParentSize(), size = "preview")
            Box(Modifier.matchParentSize().background(Brush.verticalGradient(0f to Color.Black.copy(alpha = 0.35f), 0.5f to Color.Black.copy(alpha = 0.2f), 1f to Color.Black.copy(alpha = 0.62f))))
        } else LineIcon(
            Glyphs.compass, Color.White, size = 170.dp, stroke = 1.3f,
            modifier = Modifier.align(Alignment.TopEnd).offset(x = 46.dp, y = (-22).dp).rotate(-12f).alpha(0.16f),
        )
        MenuDots(trip, Modifier.align(Alignment.TopEnd).padding(14.dp), onOpen = onOpen, onPeople = if (trip.remoteId != null) ({ onPeopleTrip(trip) }) else null, autoBig = autoBig)
        Column(Modifier.fillMaxWidth().padding(20.dp)) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(big, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(800), fontSize = 60.sp, lineHeight = 60.sp, letterSpacing = (-0.03).em, color = Color.White))
                Column(Modifier.padding(start = 10.dp, bottom = 9.dp)) {
                    Text(top, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 17.sp, color = Color.White))
                    Text(bottom, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = Color.White.copy(alpha = 0.8f)))
                }
            }
            Row(Modifier.padding(top = 26.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    trip.title,
                    style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 25.sp, letterSpacing = (-0.015).em, color = Color.White),
                )
                // Under way: a green dot that pulses every 1.8 s, as on the web.
                if (trip.ongoingDay != null) OngoingDot(Modifier.padding(start = 10.dp))
            }
            Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Chip("${shortMonthName(trip.month)} ${trip.year}")
                Chip(if (trip.days == 1) "1 dag" else "${trip.days} dagen")
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
        modifier = Modifier.background(Color.White.copy(alpha = 0.18f), CircleShape).padding(horizontal = 11.dp, vertical = 6.dp),
    )
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
    val options = listOf("Afgelopen reizen" to Data.past.size, "Gedeeld" to Data.shared)
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(ButtonGroupDefaults.ConnectedSpaceBetween)) {
        options.forEachIndexed { i, (label, count) ->
            ToggleButton(
                checked = tab == i,
                onCheckedChange = { onTab(i) },
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
                Text("$count", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 15.sp), modifier = Modifier.alpha(0.7f))
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
private fun MenuDots(trip: Trip, modifier: Modifier = Modifier, onOpen: () -> Unit = {}, onPeople: (() -> Unit)? = null, light: Boolean = true, autoBig: Boolean = false) {
    var menu by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var leaving by remember { mutableStateOf(false) }
    val cs = MaterialTheme.colorScheme
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val remote = trip.remoteId != null
    val mine = remote && (trip.ownerId.isNullOrBlank() || trip.ownerId == Data.me?.id)
    Box(modifier) {
        Box(
            // A solid tonal disc on photos, so the dots read on a bright sky too.
            Modifier.size(40.dp).clip(CircleShape).background(if (light) cs.surfaceContainerHighest else Color.Transparent).bouncyClickable { menu = true },
            contentAlignment = Alignment.Center,
        ) { LineIcon(Glyphs.dotsCircles, if (light) cs.onSurface else cs.onSurfaceVariant, size = 20.dp, filled = true) }
        val chosen = CardSizePref.overrides[trip.id] ?: CardSizePref.AUTO
        AppMenu(menu, onDismiss = { menu = false }, groups = listOf(
            listOfNotNull(
                MenuEntry("Openen", Glyphs.compass) { onOpen() },
                onPeople?.let { MenuEntry("Mensen en delen", Glyphs.friends) { it() } },
            ),
            listOf(
                MenuEntry(if (autoBig) "Automatisch (groot)" else "Automatisch (klein)", Glyphs.cardAuto, selected = chosen == CardSizePref.AUTO) { CardSizePref.set(trip.id, null) },
                MenuEntry("Groot", Glyphs.cardLarge, selected = chosen == CardSizePref.LARGE) { CardSizePref.set(trip.id, CardSizePref.LARGE) },
                MenuEntry("Klein", Glyphs.cardRow, selected = chosen == CardSizePref.COMPACT) { CardSizePref.set(trip.id, CardSizePref.COMPACT) },
            ),
            when {
                !remote -> emptyList()
                mine -> listOf(MenuEntry("Hernoemen", Glyphs.pencil) { renaming = true }, MenuEntry("Verwijderen", Glyphs.trash, danger = true) { deleting = true })
                else -> listOf(MenuEntry("Reis verlaten", Glyphs.signOut, danger = true) { leaving = true })
            },
        ))
    }
    if (renaming) {
        var title by remember { mutableStateOf(trip.title) }
        var busy by remember { mutableStateOf(false) }
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { if (!busy) renaming = false },
            title = { Text("Hernoemen", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 20.sp)) },
            text = { TripField(title, { title = it.take(120) }) },
            confirmButton = {
                androidx.compose.material3.TextButton(enabled = !busy && title.isNotBlank() && title.trim() != trip.title, onClick = {
                    busy = true
                    scope.launch { runCatching { Remote.renameTrip(trip, title) }; Data.load(); busy = false; renaming = false }
                }) { Text("Opslaan", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600))) }
            },
            dismissButton = { androidx.compose.material3.TextButton(onClick = { renaming = false }) { Text("Annuleren", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600))) } },
        )
    }
    if (deleting) {
        // As on the web: the trip's name typed out first, because it cannot be undone.
        var typed by remember { mutableStateOf("") }
        var busy by remember { mutableStateOf(false) }
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { if (!busy) deleting = false },
            title = { Text("Reis verwijderen?", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 20.sp)) },
            text = {
                Column {
                    Text("\"${trip.title}\" wordt definitief verwijderd, samen met de route, de notities en de foto-koppelingen. Dit kan niet ongedaan gemaakt worden.", style = TextStyle(fontFamily = Inter, fontSize = 15.sp))
                    Text("Typ de naam van de reis om te bevestigen.", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 14.dp, bottom = 8.dp))
                    TripField(typed, { typed = it }, placeholder = trip.title)
                }
            },
            confirmButton = {
                androidx.compose.material3.TextButton(enabled = !busy && typed.trim() == trip.title.trim(), onClick = {
                    busy = true
                    scope.launch { runCatching { Remote.deleteTrip(trip) }; CardSizePref.set(trip.id, null); Data.load(); busy = false; deleting = false }
                }) { Text("Verwijderen", color = if (typed.trim() == trip.title.trim()) cs.error else cs.onSurface.copy(alpha = 0.38f), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600))) }
            },
            dismissButton = { androidx.compose.material3.TextButton(onClick = { deleting = false }) { Text("Annuleren", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600))) } },
        )
    }
    if (leaving) {
        var busy by remember { mutableStateOf(false) }
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { if (!busy) leaving = false },
            title = { Text("Reis verlaten?", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 20.sp)) },
            text = { Text("Je verlaat \"${trip.title}\". Je kunt er altijd opnieuw op gezet worden.", style = TextStyle(fontFamily = Inter, fontSize = 15.sp)) },
            confirmButton = {
                androidx.compose.material3.TextButton(enabled = !busy, onClick = {
                    busy = true
                    scope.launch { runCatching { Remote.leaveTrip(trip) }; Data.load(); busy = false; leaving = false }
                }) { Text("Verlaten", color = cs.error, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600))) }
            },
            dismissButton = { androidx.compose.material3.TextButton(onClick = { leaving = false }) { Text("Annuleren", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600))) } },
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
            cursorBrush = androidx.compose.ui.graphics.SolidColor(cs.primary), modifier = Modifier.fillMaxWidth())
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

/** A trip shown big: its photo edge to edge, the name and facts on it. */
@Composable
private fun BigTripCard(trip: Trip, onOpen: () -> Unit, modifier: Modifier = Modifier, onPeopleTrip: (Trip) -> Unit = {}, autoBig: Boolean = true) {
    val shape = RoundedCornerShape(32.dp)
    Box(modifier.fillMaxWidth().aspectRatio(16f / 11f).clip(shape).bouncyClickable(onOpen)) {
        if (trip.coverId == null && trip.remoteId != null) {
            // No photo: the trip's own colour with the compass in the corner, as the next-trip card, clear of the title.
            val deep = Color(0xFF1B2440).copy(alpha = 0.55f).compositeOver(trip.color)
            Box(Modifier.matchParentSize().background(Brush.linearGradient(listOf(trip.color, deep))))
            LineIcon(
                Glyphs.compass, Color.White, size = 190.dp, stroke = 1.3f,
                modifier = Modifier.align(Alignment.TopEnd).offset(x = 50.dp, y = (-26).dp).rotate(-12f).alpha(0.16f),
            )
        } else {
            Cover(trip, Modifier.matchParentSize(), size = "preview")
            Box(Modifier.matchParentSize().background(Brush.verticalGradient(0.35f to Color.Transparent, 1f to Color(0xC010151B))))
        }
        MenuDots(trip, Modifier.align(Alignment.TopEnd).padding(14.dp), onOpen = onOpen, onPeople = if (trip.remoteId != null) ({ onPeopleTrip(trip) }) else null, autoBig = autoBig)
        Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(20.dp)) {
            Text(trip.title, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 26.sp, letterSpacing = (-0.015).em, color = Color.White))
            Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Chip("${shortMonthName(trip.month)} ${trip.year}")
                Chip(if (trip.days == 1) "1 dag" else "${trip.days} dagen")
                trip.km?.takeIf { it > 0 }?.let { Chip("%,d km".format(it).replace(',', '.')) }
                Spacer(Modifier.weight(1f))
                FaceStack(trip.people, trip.extraPeople, ring = Color(0xFF2A2F36))
            }
        }
    }
}

/**
 * A trip as a row in its year's slab: its photo blurred behind it under a veil
 * in the page colour, the photo itself as a thumbnail, the facts and a menu.
 */
@Composable
private fun TripRow(trip: Trip, shape: Shape, dark: Boolean, onOpen: () -> Unit, modifier: Modifier = Modifier, onPeopleTrip: (Trip) -> Unit = {}, autoBig: Boolean = false) {
    val cs = MaterialTheme.colorScheme
    // The row takes on the tone of its cover photo, tinted enough to read on; it flows
    // over from the plain surface once the photo is there instead of popping in.
    val tone = coverTone(trip)
    val bg by animateColorAsState(
        tone?.let { it.copy(alpha = if (dark) 0.34f else 0.24f).compositeOver(cs.surfaceContainerLow) } ?: cs.surfaceContainerLow,
        MaterialTheme.motionScheme.slowEffectsSpec(), label = "rowTone",
    )
    Box(modifier.fillMaxWidth().clip(shape).background(bg).bouncyClickable(onOpen)) {
        val cover = trip.cover ?: trip.coverId
        Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            // Every row has its thumbnail, so all titles line up; a trip without a photo shows its colour and compass.
            if (cover != null || trip.remoteId != null) {
                Cover(trip, Modifier.size(64.dp).clip(RoundedCornerShape(18.dp)))
            }
            Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                Text(trip.title, maxLines = 2, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 18.sp, lineHeight = 21.sp, color = cs.onSurface))
                // No distance measured: say nothing rather than "0 km".
                val km = trip.km?.takeIf { it > 0 }?.let { " · " + "%,d".format(it).replace(',', '.') + " km" } ?: ""
                Text("${trip.month} ${trip.year} · ${if (trip.days == 1) "1 dag" else "${trip.days} dagen"}$km", maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = cs.onSurfaceVariant))
            }
            MenuDots(trip, onOpen = onOpen, onPeople = if (trip.remoteId != null) ({ onPeopleTrip(trip) }) else null, light = false, autoBig = autoBig)
        }
    }
}

fun shortMonthName(month: String): String = mapOf(
    "januari" to "jan", "februari" to "feb", "maart" to "mrt", "april" to "apr", "mei" to "mei", "juni" to "jun",
    "juli" to "jul", "augustus" to "aug", "september" to "sep", "oktober" to "okt", "november" to "nov", "december" to "dec",
)[month] ?: month.take(3)

/**
 * The floating toolbar with the three tabs, the open one widening into a pill
 * with its name. The new-trip button stays beside the heading, where it was.
 */
@Composable
private fun Toolbar(active: Int, onNav: (Int) -> Unit, modifier: Modifier = Modifier) {
    val cs = MaterialTheme.colorScheme
    val items = listOf(Glyphs.compass to "Reizen", Glyphs.friends to "Reizigers", Glyphs.settings to "Instellingen")
    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        // Its own light tone and the floating toolbar's soft shadow, so it stands off
        // whatever scrolls under it (the one place Mark wants a shadow).
        HorizontalFloatingToolbar(
            expanded = true,
            colors = FloatingToolbarDefaults.standardFloatingToolbarColors(toolbarContainerColor = cs.surfaceContainerHighest),
            expandedShadowElevation = 8.dp,
        ) {
            items.forEachIndexed { i, (icon, label) ->
                val on = i == active
                val bg by animateColorAsState(if (on) cs.primary else Color.Transparent, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "navBg")
                Row(
                    Modifier.height(48.dp).clip(CircleShape).background(bg).bouncyClickable { onNav(i) }.padding(horizontal = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    // The icon's colour moves with the pill, so it never turns white on beige before the pill is there.
                    val fg by animateColorAsState(if (on) cs.onPrimary else cs.onSurfaceVariant, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "navFg")
                    LineIcon(icon, fg, size = 22.dp, stroke = if (on) 2.1f else 1.9f)
                    AnimatedVisibility(
                        visible = on,
                        // The label unfolds from the icon's side, so icon and text stay together while it grows.
                        enter = expandHorizontally(MaterialTheme.motionScheme.fastSpatialSpec(), expandFrom = Alignment.Start) + fadeIn(MaterialTheme.motionScheme.fastEffectsSpec()),
                        exit = shrinkHorizontally(MaterialTheme.motionScheme.fastSpatialSpec(), shrinkTowards = Alignment.Start) + fadeOut(MaterialTheme.motionScheme.fastEffectsSpec()),
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
        Text("Nog geen reizen", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 20.sp, color = cs.onSurface), modifier = Modifier.padding(top = 12.dp))
        Text("Begin met Nieuwe reis hierboven. Foto's uit Immich komen er vanzelf bij.", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 14.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 4.dp))
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
