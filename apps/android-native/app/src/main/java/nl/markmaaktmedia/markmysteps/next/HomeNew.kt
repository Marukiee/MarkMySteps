package nl.markmaaktmedia.markmysteps.next

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.runtime.LaunchedEffect
import kotlinx.coroutines.delay
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
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFFFFFFF),
    surfaceContainer = Color(0xFFF6F0E8),
    surfaceContainerHigh = Color(0xFFF1EAE0),
    surfaceContainerHighest = Color(0xFFEBE3D7),
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
    background = Color.Black,
    onBackground = Color(0xFFF1F3F5),
    surface = Color.Black,
    onSurface = Color(0xFFF1F3F5),
    onSurfaceVariant = Color(0xFFA2ACB6),
    surfaceContainerLowest = Color(0xFF0B0D0F),
    surfaceContainerLow = Color(0xFF14171A),
    surfaceContainer = Color(0xFF181B1F),
    surfaceContainerHigh = Color(0xFF202429),
    surfaceContainerHighest = Color(0xFF2A2F35),
    outlineVariant = Color(0xFF2B333D),
)

private val Pad = 16.dp

@Composable
fun HomeNew(dark: Boolean, onLogoTap: () -> Unit, startTrip: String? = null, startPage: String? = null) {
    MaterialExpressiveTheme(
        colorScheme = if (dark) DarkScheme else LightScheme,
        motionScheme = MotionScheme.expressive(),
    ) {
        var open by remember { mutableStateOf((DemoPast + DemoUpcoming).firstOrNull { it.id == startTrip }) }
        var page by remember { mutableIntStateOf(when (startPage) { "settings" -> 2; "travellers" -> 1; else -> 0 }) }
        BackHandler(enabled = open != null || page != 0) { if (open != null) open = null else page = 0 }
        val motion = MaterialTheme.motionScheme
        Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
            // Between tabs a fade-through, into a trip a scale and fade from the card: the
            // expressive motion scheme's own springs and tweens, nothing tuned by hand.
            AnimatedContent(
                targetState = open?.id ?: "page$page",
                transitionSpec = {
                    (fadeIn(motion.defaultEffectsSpec()) + scaleIn(motion.defaultSpatialSpec(), initialScale = 0.94f)) togetherWith
                        fadeOut(motion.fastEffectsSpec())
                },
                label = "page",
            ) { key ->
                val trip = (DemoPast + DemoUpcoming).firstOrNull { it.id == key }
                when {
                    trip != null -> TripPage(trip, dark, onBack = { open = null }, startExtra = startPage)
                    key == "page2" -> SettingsPage()
                    key == "page1" -> TravellersPage()
                    else -> HomeNewContent(dark, onLogoTap, onOpenTrip = { open = it })
                }
            }
            AnimatedVisibility(
                visible = open == null,
                modifier = Modifier.align(Alignment.BottomCenter),
                enter = slideInVertically(motion.defaultSpatialSpec()) { it } + fadeIn(motion.defaultEffectsSpec()),
                exit = slideOutVertically(motion.fastSpatialSpec()) { it } + fadeOut(motion.fastEffectsSpec()),
            ) {
                Toolbar(page, onNav = { page = it })
            }
        }
    }
}

@Composable
private fun HomeNewContent(dark: Boolean, onLogoTap: () -> Unit, onOpenTrip: (Trip) -> Unit) {
    val cs = MaterialTheme.colorScheme
    val screenH = LocalConfiguration.current.screenHeightDp
    val heroH = (screenH * 0.5f).coerceIn(320f, 560f).dp
    var tab by remember { mutableIntStateOf(0) }
    val scroll = rememberScrollState()

    Box(Modifier.fillMaxSize().background(cs.background)) {
        Column(Modifier.fillMaxSize().verticalScroll(scroll)) {
            Box(Modifier.fillMaxWidth().height(heroH)) {
                Globe(
                    trips = DemoPast + DemoUpcoming,
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
                    TopRow(onLogoTap)
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
                    Button(onClick = {}, shapes = ButtonDefaults.shapes(), contentPadding = PaddingValues(start = 16.dp, end = 20.dp, top = 12.dp, bottom = 12.dp)) {
                        LineIcon(Glyphs.plus, cs.onPrimary, size = 18.dp, stroke = 2.6f)
                        Spacer(Modifier.width(8.dp))
                        Text("Nieuwe reis", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp))
                    }
                }
                SectionTitle("Aankomend & onderweg", Modifier.padding(top = 22.dp, bottom = 12.dp).arrive(1))
                NextTripCard(DemoUpcoming, onOpen = { onOpenTrip(DemoUpcoming) }, modifier = Modifier.arrive(2))
                PastOrShared(tab, onTab = { tab = it }, modifier = Modifier.padding(top = 26.dp, bottom = 4.dp).arrive(3))
                // A trip can be shown big, as the first one here, or as a row with its photo blurred behind it.
                BigTripCard(DemoPast.first(), onOpen = { onOpenTrip(DemoPast.first()) }, modifier = Modifier.padding(top = 14.dp).arrive(4))
                DemoPast.drop(1).groupBy { it.year }.forEach { (year, trips) ->
                    SectionTitle(year, Modifier.padding(top = 18.dp, bottom = 10.dp), small = true)
                    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        trips.forEachIndexed { i, trip -> TripRow(trip, slab(i, trips.size), dark, onOpen = { onOpenTrip(trip) }, modifier = Modifier.arrive(5 + i)) }
                    }
                }
                Spacer(Modifier.height(120.dp))
                Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
            }
        }

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
private fun TopRow(onLogoTap: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(
            Modifier.clip(CircleShape).clickable(onClick = onLogoTap).padding(end = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            LineIcon(Glyphs.logo, cs.primary, size = 34.dp, stroke = 2.2f)
            Text("MarkMySteps", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(620), fontSize = 23.sp, letterSpacing = (-0.02).em, color = cs.onBackground))
        }
        Spacer(Modifier.weight(1f))
        Box(
            Modifier.size(42.dp).clip(MaterialShapes.Cookie9Sided.toShape()).background(cs.primaryContainer).bouncyClickable(),
            contentAlignment = Alignment.Center,
        ) {
            Text("M", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 17.sp, color = cs.onPrimaryContainer))
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
private fun NextTripCard(trip: Trip, onOpen: () -> Unit, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(32.dp)
    val base = trip.color
    val deep = Color(0xFF1B2440).copy(alpha = 0.55f).compositeOver(base)
    val left = trip.startsInDays ?: 0
    Box(modifier.fillMaxWidth().clip(shape).background(Brush.linearGradient(listOf(base, deep))).bouncyClickable(onOpen)) {
        LineIcon(
            Glyphs.compass, Color.White, size = 170.dp, stroke = 1.3f,
            modifier = Modifier.align(Alignment.TopEnd).offset(x = 46.dp, y = (-22).dp).rotate(-12f).alpha(0.16f),
        )
        MenuDots(Modifier.align(Alignment.TopEnd).padding(14.dp))
        Column(Modifier.fillMaxWidth().padding(20.dp)) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text("$left", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(800), fontSize = 60.sp, lineHeight = 60.sp, letterSpacing = (-0.03).em, color = Color.White))
                Column(Modifier.padding(start = 10.dp, bottom = 9.dp)) {
                    Text("dagen", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 17.sp, color = Color.White))
                    Text("tot vertrek", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = Color.White.copy(alpha = 0.8f)))
                }
            }
            Text(
                trip.title,
                style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 25.sp, letterSpacing = (-0.015).em, color = Color.White),
                modifier = Modifier.padding(top = 26.dp),
            )
            Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Chip("${shortMonthName(trip.month)} ${trip.year}")
                Chip("${trip.days} dagen")
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
private fun FaceStack(people: List<Person>, extra: Int, ring: Color) {
    val faces = people.take(2)
    val count = faces.size + if (extra > 0) 1 else 0
    val size = 32.dp
    val step = 21.dp
    Box(Modifier.width(size + step * (count - 1)).height(size)) {
        faces.forEachIndexed { i, p ->
            Box(
                Modifier.offset(x = step * i).size(size).background(ring, CircleShape).padding(2.dp).background(p.color, CircleShape),
                contentAlignment = Alignment.Center,
            ) { Text(p.initial, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 12.sp, color = Color.White)) }
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
    val options = listOf("Afgelopen" to DemoPast.size, "Gedeeld" to DemoSharedCount)
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

/** The trip menu on a card with a picture behind it: three dots on a soft dark disc. */
@Composable
private fun MenuDots(modifier: Modifier = Modifier) {
    Box(modifier.size(40.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.22f)).bouncyClickable(), contentAlignment = Alignment.Center) {
        LineIcon(Glyphs.dotsCircles, Color.White, size = 20.dp, filled = true)
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
private fun BigTripCard(trip: Trip, onOpen: () -> Unit, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(32.dp)
    Box(modifier.fillMaxWidth().aspectRatio(16f / 11f).clip(shape).bouncyClickable(onOpen)) {
        Scenery(trip.cover ?: Scene.Mountains, Modifier.matchParentSize())
        Box(Modifier.matchParentSize().background(Brush.verticalGradient(0.35f to Color.Transparent, 1f to Color(0xC010151B))))
        MenuDots(Modifier.align(Alignment.TopEnd).padding(14.dp))
        Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(20.dp)) {
            Text(trip.title, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 26.sp, letterSpacing = (-0.015).em, color = Color.White))
            Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Chip("${shortMonthName(trip.month)} ${trip.year}")
                Chip("${trip.days} dagen")
                trip.km?.let { Chip("%,d km".format(it).replace(',', '.')) }
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
private fun TripRow(trip: Trip, shape: Shape, dark: Boolean, onOpen: () -> Unit, modifier: Modifier = Modifier) {
    val cs = MaterialTheme.colorScheme
    Box(modifier.fillMaxWidth().clip(shape).background(cs.surfaceContainerLow).bouncyClickable(onOpen)) {
        val cover = trip.cover
        if (cover != null) {
            Scenery(cover, Modifier.matchParentSize().graphicsLayer { scaleX = 1.3f; scaleY = 1.3f }.blur(22.dp))
            Box(Modifier.matchParentSize().background(if (dark) Color(0xA8101418) else Color(0xBDFFFFFF)))
        }
        Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            if (cover != null) {
                Scenery(cover, Modifier.size(64.dp).clip(RoundedCornerShape(18.dp)))
            }
            Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                Text(trip.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 18.sp, color = cs.onSurface))
                val km = trip.km?.let { " · " + "%,d".format(it).replace(',', '.') + " km" } ?: ""
                Text("${trip.month} ${trip.year} · ${trip.days} dagen$km", maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = cs.onSurfaceVariant))
            }
            Box(Modifier.size(40.dp).clip(CircleShape).bouncyClickable(), contentAlignment = Alignment.Center) {
                LineIcon(Glyphs.dotsCircles, cs.onSurfaceVariant, size = 20.dp, filled = true)
            }
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
        HorizontalFloatingToolbar(
            expanded = true,
            colors = FloatingToolbarDefaults.standardFloatingToolbarColors(toolbarContainerColor = cs.surfaceContainerHigh),
        ) {
            items.forEachIndexed { i, (icon, label) ->
                val on = i == active
                val bg by animateColorAsState(if (on) cs.primary else Color.Transparent, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "navBg")
                Row(
                    Modifier.height(48.dp).clip(CircleShape).background(bg).bouncyClickable { onNav(i) }.padding(horizontal = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    LineIcon(icon, if (on) cs.onPrimary else cs.onSurfaceVariant, size = 22.dp, stroke = if (on) 2.1f else 1.8f)
                    AnimatedVisibility(
                        visible = on,
                        enter = expandHorizontally(MaterialTheme.motionScheme.fastSpatialSpec()) + fadeIn(MaterialTheme.motionScheme.fastEffectsSpec()),
                        exit = shrinkHorizontally(MaterialTheme.motionScheme.fastSpatialSpec()) + fadeOut(MaterialTheme.motionScheme.fastEffectsSpec()),
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
