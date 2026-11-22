package nl.markmaaktmedia.markmysteps.next

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
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
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import kotlin.math.max
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
    // A trip from the server brings its stops and photos in only when it is opened.
    val trip by androidx.compose.runtime.produceState(base, base.id, Data.version) {
        if (base.remoteId != null) runCatching { Remote.stops(base) }.getOrNull()?.let { (stops, legs) ->
            value = base.copy(stops = stops, outbound = legs.first, back = legs.second)
        }
    }
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
                Globe(
                    trips = listOf(trip),
                    style = GlobeStyle(
                        sphere = if (dark) Color(0xFF101418) else Color(0xFFDCE6EC),
                        land = if (dark) Color(0xFF29313A) else Color(0xFFEFE7D8),
                        dark = dark,
                        routeWidth = 3f,
                    ),
                    modifier = Modifier.fillMaxSize(),
                    centerLon = lon,
                    centerLat = lat - spread * 0.18,
                    zoom = zoom,
                    showStops = true,
                    turnable = false,
                )
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
                Row(Modifier.fillMaxWidth().padding(top = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(trip.title, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 28.sp, letterSpacing = (-0.02).em, color = cs.onBackground))
                        Text(trip.dates, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 14.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 2.dp))
                    }
                    People(trip.people, trip.extraPeople)
                }

                Facts(trip, Modifier.padding(top = 18.dp), photos = media?.size)

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

                Column(Modifier.padding(top = 16.dp).animateContentSize(MaterialTheme.motionScheme.defaultSpatialSpec())) {
                    if (tab == 0) Timeline(trip, dark, media) else androidx.compose.runtime.key(trip.stops.size) { Planner(trip, dark) }
                }
                Spacer(Modifier.height(24.dp))
                Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
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
                RoundButton(onClick = {}) { LineIcon(Glyphs.dotsCircles, cs.onSurface, size = 22.dp, filled = true) }
            }
        }
    }
}

@Composable
private fun RoundButton(onClick: () -> Unit = {}, content: @Composable () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Box(Modifier.size(48.dp).clip(CircleShape).background(cs.surfaceContainerHighest.copy(alpha = 0.92f)).press(onClick), contentAlignment = Alignment.Center) { content() }
}

@Composable
private fun People(people: List<Person>, extra: Int) {
    val cs = MaterialTheme.colorScheme
    val faces = people.take(3)
    val count = faces.size + if (extra > 0) 1 else 0
    if (count == 0) return
    Box(Modifier.width(36.dp + 24.dp * (count - 1)).height(36.dp)) {
        faces.forEachIndexed { i, p ->
            Box(Modifier.offset(x = 24.dp * i).size(36.dp).background(cs.background, CircleShape).padding(2.dp).background(p.color, CircleShape), contentAlignment = Alignment.Center) {
                Text(p.initial, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 13.sp, color = Color.White))
            }
        }
        if (extra > 0) {
            Box(Modifier.offset(x = 24.dp * faces.size).size(36.dp).background(cs.background, CircleShape).padding(2.dp).background(cs.secondaryContainer, CircleShape), contentAlignment = Alignment.Center) {
                Text("+$extra", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 12.sp, color = cs.onSecondaryContainer))
            }
        }
    }
}

/** Days, distance, stops and photos as one connected slab. */
@Composable
private fun Facts(trip: Trip, modifier: Modifier = Modifier, photos: Int? = null) {
    // Before a trip there is nothing driven or photographed yet: then how long until it starts and who comes.
    val items = if (trip.upcoming) listOf(
        "${trip.startsInDays ?: 0}" to "dagen tot vertrek",
        "${trip.days}" to "dagen",
        "${trip.stops.size}" to "stops",
        "${trip.people.size + trip.extraPeople}" to "reizigers",
    ) else listOf(
        "${trip.days}" to "dagen",
        (trip.km?.let { "%,d".format(it).replace(',', '.') } ?: "0") to "km",
        "${trip.stops.size}" to "stops",
        "${photos ?: trip.photos}" to "foto's",
    )
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        items.forEachIndexed { i, (value, label) ->
            val shape = RoundedCornerShape(
                topStart = if (i == 0) 24.dp else 6.dp, bottomStart = if (i == 0) 24.dp else 6.dp,
                topEnd = if (i == items.lastIndex) 24.dp else 6.dp, bottomEnd = if (i == items.lastIndex) 24.dp else 6.dp,
            )
            Column(
                Modifier.weight(if (i == 1 && !trip.upcoming) 1.3f else if (i == 0 && trip.upcoming) 1.5f else 1f).clip(shape).background(MaterialTheme.colorScheme.surfaceContainerLow).padding(horizontal = 12.dp, vertical = 12.dp),
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
