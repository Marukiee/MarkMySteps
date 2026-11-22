package nl.markmaaktmedia.markmysteps.next

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.animateScrollBy
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.ime
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
import androidx.compose.material3.MaterialShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.ToggleButton
import androidx.compose.material3.ToggleButtonDefaults
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import kotlin.math.max
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/*
 * A trip, opened, in the Material 3 Expressive proposal. The map at the top is
 * the globe zoomed in on the trip for now; in the app it becomes MapLibre's
 * native map, with the same route and dot rules. Below it a sheet with the
 * name, the facts as one connected slab, the timeline or the photos, and the
 * stops numbered in Material shapes in the trip's colour.
 */

private val StopShapes = listOf(
    MaterialShapes.Cookie9Sided, MaterialShapes.Sunny, MaterialShapes.Clover4Leaf,
    MaterialShapes.Cookie6Sided, MaterialShapes.SoftBurst, MaterialShapes.Flower, MaterialShapes.Pentagon,
)

private fun Modifier.press(onClick: () -> Unit = {}): Modifier = composed {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.96f else 1f, MaterialTheme.motionScheme.fastSpatialSpec(), label = "press")
    clickable(source, ripple(), onClick = onClick).graphicsLayer { scaleX = scale; scaleY = scale }
}

@Composable
fun TripPage(base: Trip, dark: Boolean, onBack: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    // A trip from the server brings its stops and photos in only when it is opened.
    val trip by androidx.compose.runtime.produceState(base, base.id, Data.version) {
        if (base.remoteId != null) runCatching { Remote.stops(base) }.getOrNull()?.let { (stops, legs) ->
            value = base.copy(stops = stops, outbound = legs.first, back = legs.second)
        }
    }
    var viewing by remember { androidx.compose.runtime.mutableStateOf<Int?>(null) }
    var people by remember { androidx.compose.runtime.mutableStateOf(false) }
    var bigMap by remember { androidx.compose.runtime.mutableStateOf(false) }
    val tiles = remember(base.id) { TileBounds() }
    var openPhoto by remember { androidx.compose.runtime.mutableStateOf<String?>(null) }
    var mapSheet by remember { androidx.compose.runtime.mutableStateOf(false) }
    var tripSheet by remember { androidx.compose.runtime.mutableStateOf(false) }
    val media by androidx.compose.runtime.produceState<List<Media>?>(null, base.id, Data.version) {
        if (base.remoteId != null) value = runCatching { Remote.media(base) }.getOrNull() ?: emptyList()
    }
    val screenH = LocalConfiguration.current.screenHeightDp
    val mapH = (screenH * 0.46f).dp
    var tab by remember { mutableIntStateOf(0) }
    val scroll = rememberScrollState()
    val density = LocalDensity.current
    // Once the map has scrolled away, a bar with the trip's name takes its place under the buttons.
    val collapsed = scroll.value > with(density) { (mapH - 90.dp).toPx() }
    val bar by animateFloatAsState(if (collapsed) 1f else 0f, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "bar")

    // Frame the trip: the middle of its stops, and a zoom that fits their spread.
    val points = trip.stops.map { it.at }.ifEmpty { trip.route }.ifEmpty { listOf(HomeAirport) }
    val lon = points.map { it.first }.average()
    val lat = points.map { it.second }.average()
    val spread = points.maxOf { p -> angle(p, lon to lat) }.coerceAtLeast(0.6)
    val zoom = (34.0 / spread).coerceIn(4.0, 70.0).toFloat()

    Box(Modifier.fillMaxSize().background(cs.background)) {
        Column(Modifier.fillMaxSize().verticalScroll(scroll)) {
            Box(Modifier.fillMaxWidth().height(mapH)) {
                TripMap(trip, dark, Modifier.fillMaxSize(), bottomInsetDp = 30)
                // Open the map full screen, from its own corner as on the web.
                Box(Modifier.align(Alignment.BottomEnd).padding(end = 14.dp, bottom = 44.dp)) {
                    RoundButton(onClick = { bigMap = true }) {
                        LineIcon(listOf(P("M4 9V4h5"), P("M20 9V4h-5"), P("M4 15v5h5"), P("M20 15v5h-5")), cs.onSurface, size = 20.dp, stroke = 2.2f)
                    }
                }
                Box(
                    Modifier.fillMaxWidth().height(110.dp)
                        .background(Brush.verticalGradient(listOf(cs.background.copy(alpha = 0.55f), Color.Transparent))),
                )
            }

            // The sheet, pulled up over the bottom of the map.
            Column(
                Modifier.offset(y = (-30).dp).fillMaxWidth()
                    .clip(RoundedCornerShape(topStart = 32.dp, topEnd = 32.dp))
                    .background(cs.background)
                    .padding(horizontal = 16.dp),
            ) {
                Box(Modifier.align(Alignment.CenterHorizontally).padding(top = 10.dp).size(width = 36.dp, height = 4.dp).clip(CircleShape).background(cs.outlineVariant))
                CoverCard(trip, photos = media?.size, modifier = Modifier.padding(top = 14.dp), onPeople = if (trip.remoteId != null) ({ people = true }) else null)
                Facts(trip, Modifier.padding(top = 4.dp), photos = media?.size)

                Row(Modifier.fillMaxWidth().padding(top = 18.dp), horizontalArrangement = Arrangement.spacedBy(ButtonGroupDefaults.ConnectedSpaceBetween)) {
                    listOf("Tijdlijn", "Routeplanner").forEachIndexed { i, label ->
                        ToggleButton(
                            checked = tab == i,
                            onCheckedChange = { tab = i },
                            modifier = Modifier.weight(1f).height(48.dp),
                            shapes = if (i == 0) ButtonGroupDefaults.connectedLeadingButtonShapes() else ButtonGroupDefaults.connectedTrailingButtonShapes(),
                            colors = ToggleButtonDefaults.toggleButtonColors(
                                containerColor = cs.surfaceContainerHigh,
                                contentColor = cs.onSurfaceVariant,
                                checkedContainerColor = cs.primary,
                                checkedContentColor = cs.onPrimary,
                            ),
                        ) { Text(label, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp)) }
                    }
                }

                // No animateContentSize here: it clips, which cut the places row off before the screen edge.
                Column(Modifier.padding(top = 16.dp)) {
                    if (tab == 0) Timeline(trip, dark, media, onPhoto = { m -> viewing = media?.indexOf(m)?.takeIf { it >= 0 } }, bounds = tiles, hidden = openPhoto) else androidx.compose.runtime.key(trip.stops.size) { Planner(trip, dark) }
                }
                Spacer(Modifier.height(24.dp))
                Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
                // Room for the keyboard, so a field near the end can scroll above it.
                Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.ime))
            }
        }

        // Back and the menu float over the map, in the corners where they belong.
        Column(Modifier.background(cs.surfaceContainer.copy(alpha = bar))) {
            Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                RoundButton(onBack) { LineIcon(listOf(P("M19 12H5"), P("m12 19-7-7 7-7")), cs.onSurface, size = 22.dp, stroke = 2.2f) }
                Text(
                    trip.title, maxLines = 1,
                    style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 19.sp, color = cs.onSurface),
                    modifier = Modifier.weight(1f).padding(horizontal = 14.dp).graphicsLayer { alpha = bar; translationY = (1f - bar) * 12.dp.toPx() },
                )
                // Their own buttons, as on the web: people and sharing, the map's settings, the trip's settings.
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (trip.remoteId != null) RoundButton(onClick = { people = true }) { LineIcon(Glyphs.friends, cs.onSurface, size = 22.dp, stroke = 1.9f) }
                    RoundButton(onClick = { mapSheet = true }) { LineIcon(listOf(P("M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5Z"), P("M9 4v13.5"), P("M15 6.5V20")), cs.onSurface, size = 21.dp, stroke = 1.9f) }
                    if (trip.remoteId != null) RoundButton(onClick = { tripSheet = true }) { LineIcon(Glyphs.settings, cs.onSurface, size = 21.dp, stroke = 1.8f) }
                }
            }
        }
        // The map full screen: it grows open and closes with back or the cross.
        androidx.compose.animation.AnimatedVisibility(
            bigMap,
            enter = androidx.compose.animation.fadeIn(MaterialTheme.motionScheme.defaultEffectsSpec()) + androidx.compose.animation.scaleIn(MaterialTheme.motionScheme.defaultSpatialSpec(), initialScale = 0.92f),
            exit = androidx.compose.animation.fadeOut(MaterialTheme.motionScheme.fastEffectsSpec()) + androidx.compose.animation.scaleOut(MaterialTheme.motionScheme.fastSpatialSpec(), targetScale = 0.92f),
        ) {
            androidx.activity.compose.BackHandler { bigMap = false }
            Box(Modifier.fillMaxSize().background(cs.background)) {
                TripMap(trip, dark, Modifier.fillMaxSize(), bottomInsetDp = 0)
                Column {
                    Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
                    Box(Modifier.padding(12.dp)) {
                        RoundButton(onClick = { bigMap = false }) { LineIcon(listOf(P("M18 6 6 18"), P("m6 6 12 12")), cs.onSurface, size = 22.dp, stroke = 2.2f) }
                    }
                }
            }
        }
        if (mapSheet) MapSheet(onDismiss = { mapSheet = false })
        if (tripSheet) TripSettingsSheet(trip, onDismiss = { tripSheet = false }, onChanged = { scope.launch { Data.load() } })
        if (people) PeopleSheet(trip, onDismiss = { people = false }, onChanged = { scope.launch { Data.load() } })
        // While paging in the viewer the timeline brings that photo to the middle, so closing flies back into it.
        androidx.compose.runtime.LaunchedEffect(openPhoto) {
            val id = openPhoto ?: return@LaunchedEffect
            val r = tiles.rect(id) ?: return@LaunchedEffect
            val screen = with(density) { screenH.dp.toPx() }
            if (r.top < screen * 0.15f || r.bottom > screen * 0.85f) scroll.animateScrollBy(r.center.y - screen / 2f)
        }
        // A tapped photo opens full screen over everything, the toolbar included.
        viewing?.let { start ->
            val photos = media.orEmpty()
            if (photos.isNotEmpty()) PhotoViewer(trip, photos, start.coerceIn(0, photos.lastIndex), bounds = tiles, onCurrent = { openPhoto = it }, onClose = { viewing = null })
        }
    }
}

@Composable
private fun RoundButton(onClick: () -> Unit = {}, content: @Composable () -> Unit) {
    val cs = MaterialTheme.colorScheme
    // Solid tone, no shadow (Expressive separates by colour), so it reads on any part of the map.
    Box(
        Modifier.size(48.dp).clip(CircleShape).background(cs.surfaceContainerHighest).press(onClick),
        contentAlignment = Alignment.Center,
    ) { content() }
}

@Composable
private fun People(people: List<Person>, extra: Int, ring: Color = MaterialTheme.colorScheme.background) {
    val cs = MaterialTheme.colorScheme
    val faces = people.take(if (people.size + extra <= 4) 4 else 3)
    val more = people.size - faces.size + extra
    val count = faces.size + if (more > 0) 1 else 0
    if (count == 0) return
    Box(Modifier.width(36.dp + 24.dp * (count - 1)).height(36.dp)) {
        faces.forEachIndexed { i, p ->
            Box(Modifier.offset(x = 24.dp * i).size(36.dp).background(ring, CircleShape).padding(2.dp)) {
                Avatar(p.userId, p.name, p.hasAvatar, p.color, Modifier.matchParentSize())
            }
        }
        if (more > 0) {
            Box(Modifier.offset(x = 24.dp * faces.size).size(36.dp).background(ring, CircleShape).padding(2.dp).background(cs.secondaryContainer, CircleShape), contentAlignment = Alignment.Center) {
                Text("+$more", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 12.sp, color = cs.onSecondaryContainer))
            }
        }
    }
}

/** The figures of a trip, as (value, label): before it starts, how long until it does and who comes. */
private fun factsOf(trip: Trip, photos: Int?): List<Pair<String, String>> = if (trip.upcoming) listOfNotNull(
    trip.startsInDays?.let { "$it" to (if (it == 1) "dag tot vertrek" else "dagen tot vertrek") },
    "${trip.days}" to "dagen",
    "${trip.stops.size}" to (if (trip.stops.size == 1) "stop" else "stops"),
    "${trip.people.size + trip.extraPeople}" to "reizigers",
) else listOfNotNull(
    trip.km?.takeIf { it > 0 }?.let { "%,d".format(it).replace(',', '.') to "kilometer" },
    "${trip.days}" to "dagen",
    "${trip.stops.size}" to (if (trip.stops.size == 1) "stop" else "stops"),
    "${photos ?: trip.photos}" to "foto's",
)

/**
 * The trip's cover at the top of the sheet, as on the web: the photo, the name
 * in Fraunces, the dates, and the figures as pills on the photo. Without a
 * photo the card is the trip's colour with the compass, like the next trip.
 */
@Composable
private fun CoverCard(trip: Trip, photos: Int?, modifier: Modifier = Modifier, onPeople: (() -> Unit)? = null) {
    val hasPhoto = trip.coverId != null || trip.cover != null
    Box(modifier.fillMaxWidth().height(236.dp).clip(RoundedCornerShape(topStart = 32.dp, topEnd = 32.dp, bottomStart = 6.dp, bottomEnd = 6.dp))) {
        if (hasPhoto) {
            Cover(trip, Modifier.fillMaxSize(), size = "preview")
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.35f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.62f))))
        } else {
            val deep = Color(0xFF1B2440).copy(alpha = 0.55f).compositeOver(trip.color)
            Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(trip.color, deep))))
            LineIcon(
                Glyphs.compass, Color.White, size = 190.dp, stroke = 1.3f,
                modifier = Modifier.align(Alignment.TopEnd).offset(x = 50.dp, y = (-26).dp).graphicsLayer { rotationZ = -12f; alpha = 0.16f },
            )
        }
        // The faces open people and sharing, as on the web.
        Box(Modifier.align(Alignment.TopEnd).padding(14.dp).clip(CircleShape).clickable(enabled = onPeople != null) { onPeople?.invoke() }) {
            People(trip.people, trip.extraPeople, ring = Color.White.copy(alpha = 0.9f))
        }
        Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(20.dp)) {
            Text(
                trip.title, maxLines = 2,
                style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 32.sp, lineHeight = 35.sp, letterSpacing = (-0.02).em, color = Color.White,
                    shadow = androidx.compose.ui.graphics.Shadow(Color.Black.copy(alpha = 0.3f), blurRadius = 10f)),
            )
            Text(trip.dates, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 15.sp, color = Color.White.copy(alpha = 0.88f)), modifier = Modifier.padding(top = 2.dp))
        }
    }
}

/** Days, distance, stops and photos as one connected slab. */
@Composable
private fun Facts(trip: Trip, modifier: Modifier = Modifier, photos: Int? = null) {
    val items = factsOf(trip, photos)
    // The tone of the cover above, so the figures belong to it and stand off the page.
    val cs = MaterialTheme.colorScheme
    val dark = cs.background.luminance() < 0.5f
    val tone = coverTone(trip)
    val tile by androidx.compose.animation.animateColorAsState(
        (tone ?: trip.color).copy(alpha = if (dark) 0.34f else 0.26f).compositeOver(cs.surfaceContainerLow),
        MaterialTheme.motionScheme.slowEffectsSpec(), label = "factsTone",
    )
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        items.forEachIndexed { i, (value, label) ->
            // Joined to the cover above it: tight on top, round only at the outer bottom corners.
            val shape = RoundedCornerShape(
                topStart = 6.dp, topEnd = 6.dp,
                bottomStart = if (i == 0) 24.dp else 6.dp, bottomEnd = if (i == items.lastIndex) 24.dp else 6.dp,
            )
            Column(
                Modifier.weight(if (i == 0 && trip.upcoming) 1.5f else 1f).clip(shape).background(tile).padding(horizontal = 12.dp, vertical = 12.dp),
            ) {
                Text(value, maxLines = 1, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 21.sp, letterSpacing = (-0.02).em, color = MaterialTheme.colorScheme.onSurface))
                Text(label, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant))
            }
        }
    }
}

/** The photos of the trip in a mosaic, one wide tile then rows of three. */
@Composable
private fun PhotoGrid(trip: Trip) {
    val scenes = Scene.entries
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Box(Modifier.fillMaxWidth().height(190.dp).clip(RoundedCornerShape(topStart = 26.dp, topEnd = 26.dp, bottomStart = 6.dp, bottomEnd = 6.dp))) {
            Scenery(trip.cover ?: Scene.Mountains, Modifier.fillMaxSize())
        }
        for (row in 0 until 3) {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                for (k in 0 until 3) {
                    val last = row == 2
                    val shape = RoundedCornerShape(
                        topStart = 6.dp, topEnd = 6.dp,
                        bottomStart = if (last && k == 0) 26.dp else 6.dp, bottomEnd = if (last && k == 2) 26.dp else 6.dp,
                    )
                    Box(Modifier.weight(1f).height(110.dp).clip(shape)) { Scenery(scenes[(row * 3 + k + 2) % scenes.size], Modifier.fillMaxSize()) }
                }
            }
        }
    }
}
