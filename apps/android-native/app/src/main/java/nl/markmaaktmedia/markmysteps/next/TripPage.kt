package nl.markmaaktmedia.markmysteps.next

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.animateScrollBy
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.runtime.collectAsState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.isImeVisible
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
import androidx.compose.foundation.layout.windowInsetsPadding
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
    // A light tick under the finger on every tap, as Tandem and PixelPlayer do.
    val haptics = rememberHaptics()
    clickable(source, ripple(), onClick = { haptics(Haptic.Tap); onClick() }).graphicsLayer { scaleX = scale; scaleY = scale }
}

@Composable
fun TripPage(base: Trip, dark: Boolean, onBack: () -> Unit, startExtra: String? = null) {
    val haptics = rememberHaptics()
    val cs = MaterialTheme.colorScheme
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    // A trip from the server brings its stops and photos in only when it is opened.
    val trip by androidx.compose.runtime.produceState(base, base.id, Data.version) {
        if (base.remoteId != null) runCatching { Remote.stops(base) }.getOrNull()?.let { (stops, legs) ->
            value = base.copy(stops = stops, outbound = legs.first, back = legs.second)
        }
    }
    // The id of the photo open in the viewer: the tapped photo itself, never a position in a list.
    var viewing by remember { androidx.compose.runtime.mutableStateOf<String?>(null) }
    // Opened from a tile's speech bubble: the viewer starts on the comments.
    var viewingComments by remember { androidx.compose.runtime.mutableStateOf(false) }
    // The day stories, comments and reactions, shared by the timeline; read again once the viewer closes.
    val talk = remember(base.id) { TripTalk(base) }
    androidx.compose.runtime.LaunchedEffect(base.id, Data.version) { talk.load() }
    var viewedOnce by remember { androidx.compose.runtime.mutableStateOf(false) }
    androidx.compose.runtime.LaunchedEffect(viewing) { if (viewing != null) viewedOnce = true else if (viewedOnce) { viewingComments = false; talk.loadTalk() } }
    val marks = remember(base.id) { TimelineMarks() }
    var people by remember { androidx.compose.runtime.mutableStateOf(Data.peopleFor == base.id) }
    androidx.compose.runtime.LaunchedEffect(Unit) { if (Data.peopleFor == base.id) Data.peopleFor = null }
    // The photo book or the summary over the page (PhotoBook.kt, Summary.kt), from the people sheet.
    var extra by remember { androidx.compose.runtime.mutableStateOf(startExtra?.takeIf { it == "book" || it == "summary" }) }
    var bigMap by remember { androidx.compose.runtime.mutableStateOf(false) }
    val tiles = remember(base.id) { TileBounds() }
    var openPhoto by remember { androidx.compose.runtime.mutableStateOf<String?>(null) }
    var mapSheet by remember { androidx.compose.runtime.mutableStateOf(false) }
    // The trip's settings, a page that slides over this one (TripSettingsPage.kt).
    var tripSettings by remember { androidx.compose.runtime.mutableStateOf<Boolean?>(null) }
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

    // ---- The map's own state, shared by the map in the page and the one full screen (MapData.kt) ----
    val context = androidx.compose.ui.platform.LocalContext.current
    val mapState = remember(base.id) { TripMapState(base.remoteId) }
    val me = Data.me?.id
    val myRole = trip.members.firstOrNull { it.userId == me }?.role
    // A guest only looks: no drawing on the line, no points of their own, no blue dot of theirs on this trip.
    val canEdit = trip.remoteId != null && me != null && (trip.ownerId == me || (myRole != null && myRole != "GUEST"))
    val trackingHere = Tracker.tripId != null && Tracker.tripId == trip.remoteId
    // Your own dot (and the button to it) only on a trip that is under way or being recorded, as the web.
    val ongoing = trip.ongoingDay != null || (Api.dryRun && MapDebug.ongoing)
    val showLocate = canEdit && (trackingHere || ongoing)
    var cameraInline by remember { androidx.compose.runtime.mutableStateOf<MapCamera?>(null) }
    var cameraBig by remember { androidx.compose.runtime.mutableStateOf<MapCamera?>(null) }
    var mapNote by remember { androidx.compose.runtime.mutableStateOf<Pair<String, Boolean>?>(null) }
    androidx.compose.runtime.LaunchedEffect(mapNote) { if (mapNote != null) { kotlinx.coroutines.delay(5000); mapNote = null } }
    var daySheet by remember { androidx.compose.runtime.mutableStateOf(false) }
    var lineAt by remember { androidx.compose.runtime.mutableStateOf<LonLat?>(null) }
    var trainFor by remember { androidx.compose.runtime.mutableStateOf<Pair<LonLat, Pair<String, String>?>?>(null) }
    var pointsFor by remember { androidx.compose.runtime.mutableStateOf<String?>(null) }
    var pickFor by remember { androidx.compose.runtime.mutableStateOf<((Remote.Place) -> Unit)?>(null) }
    androidx.compose.runtime.LaunchedEffect(canEdit) { if (canEdit && Api.dryRun && MapDebug.openPoints) { MapDebug.openPoints = false; kotlinx.coroutines.delay(800); pointsFor = trip.remoteId } }
    // Whose lines are on at first: the organiser's and your own (when you travel along), as the web; when neither
    // recorded anything, everyone's, so the map is never empty while there is a line to show.
    mapState.defaultUsers = { lines ->
        val wanted = setOfNotNull(trip.ownerId, me.takeIf { canEdit })
        val drawn = lines.filter { it.points.size >= 2 }.map { it.userId }.toSet()
        if (drawn.isNotEmpty() && drawn.none { it in wanted }) drawn else wanted
    }
    androidx.compose.runtime.LaunchedEffect(base.remoteId) { base.remoteId?.let { mapState.photoUsers = MapPhotosPref.get(it) } }
    androidx.compose.runtime.LaunchedEffect(base.remoteId, Data.version) {
        val id = base.remoteId ?: return@LaunchedEffect
        launch { runCatching { MapRemote.days(id) }.onSuccess { mapState.days = it } }
        mapState.reloadRoutes()
    }
    // Where the companions are: asked every 30 s while the page is in front, and only once for a trip long over.
    val lifecycleOwner = androidx.lifecycle.compose.LocalLifecycleOwner.current
    val lifeState by lifecycleOwner.lifecycle.currentStateFlow.collectAsState()
    val inFront = lifeState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)
    androidx.compose.runtime.LaunchedEffect(base.remoteId, inFront) {
        val id = base.remoteId ?: return@LaunchedEffect
        if (!inFront) return@LaunchedEffect
        while (true) {
            runCatching { MapRemote.live(id) }.onSuccess { mapState.live = it }
            // Test mode only: a companion at the last stop, to see a face on the map without a trip under way.
            if (Api.dryRun && MapDebug.fakeLive && mapState.live.isEmpty()) trip.members.firstOrNull { it.userId != me && it.role != "GUEST" }?.let { m ->
                trip.stops.lastOrNull()?.let { s -> mapState.live = listOf(MapRemote.LiveFix(m.userId, m.name, m.hasAvatar, s.at, java.time.Instant.now().minusSeconds(420), null)) }
            }
            if (!ongoing && mapState.live.isEmpty()) break
            kotlinx.coroutines.delay(30_000)
        }
    }
    // Your own spot: tracking's last position when it is fresh, else asked once (only when location was given before).
    var ownFix by remember { androidx.compose.runtime.mutableStateOf<LonLat?>(null) }
    androidx.compose.runtime.LaunchedEffect(showLocate) { if (showLocate && Tracker.hasPermission(context)) currentLocation(context)?.let { ownFix = it } }
    val trackerFix = Tracker.lastFix?.takeIf { System.currentTimeMillis() - it.third < 30 * 60_000 }?.let { it.first to it.second }
    val selfAt = if (showLocate) trackerFix ?: ownFix else null
    androidx.compose.runtime.SideEffect { mapState.self = selfAt }
    var locating by remember { androidx.compose.runtime.mutableStateOf(false) }
    val locationRequest = rememberLocationRequest(
        "Je locatie op de kaart",
        "Om te laten zien waar je nu bent, heeft de app je locatie nodig. Die blijft op je telefoon; je route bijhouden is iets apart. Android vraagt je zo om toestemming.",
        onRefused = { msg, permanent -> mapNote = msg to permanent },
    )
    fun locate() {
        val camera = if (bigMap) cameraBig else cameraInline
        mapState.self?.let { camera?.flyTo(it, 13.0) }
        locationRequest.run(context) {
            locating = mapState.self == null
            scope.launch {
                val at = currentLocation(context)
                val wasKnown = mapState.self != null
                locating = false
                if (at != null) { ownFix = at; if (!wasKnown) (if (bigMap) cameraBig else cameraInline)?.flyTo(at, 13.0) }
                else if (!wasKnown) mapNote = "Je locatie is nu niet te vinden. Staat locatie aan op je telefoon?" to false
            }
        }
    }
    // The question on an ongoing trip you are not recording yet ("X is bezig. Route bijhouden?").
    var promptGone by remember { androidx.compose.runtime.mutableStateOf(false) }
    var promptReady by remember { androidx.compose.runtime.mutableStateOf(false) }
    androidx.compose.runtime.LaunchedEffect(Unit) { kotlinx.coroutines.delay(1200); promptReady = true }
    val promptAsked = remember(base.id) { base.remoteId?.let { TrackPromptPref.dismissed(context, it) } ?: true }
    val trackRequest = rememberLocationRequest(
        "Locatie voor je route",
        "Om je route bij te houden heeft de app je locatie nodig, ook met het scherm uit. Je ziet een melding zolang hij loopt. Android vraagt je zo om toestemming.",
        notifications = true,
        onRefused = { msg, permanent -> mapNote = msg to permanent },
    )
    // Picking one day frames that day and its line; the whole trip again frames the whole trip.
    var dayPicked by remember { androidx.compose.runtime.mutableStateOf(false) }
    androidx.compose.runtime.LaunchedEffect(mapState.day) {
        if (!dayPicked) return@LaunchedEffect
        mapState.reloadRoutes()
        val camera = if (bigMap) cameraBig else cameraInline
        val d = mapState.day
        if (d == null) camera?.reset() else {
            val coords = mapState.routes.orEmpty().flatMap { it.points } +
                media.orEmpty().filter { it.takenAt == d && it.lat != null && it.lon != null }.map { it.lon!! to it.lat!! }
            camera?.focusOn(coords.ifEmpty { trip.stops.filter { s -> s.start != null && !d.isBefore(s.start) && !d.isAfter(s.start.plusDays(s.nights.toLong())) }.map { it.at } })
        }
    }
    // The photos on the map: whose the map settings say, and of the day on show.
    val mapPhotos = remember(media, mapState.photoUsers, mapState.day) {
        media.orEmpty().filter { (mapState.photoUsers?.contains(it.userId) ?: true) && (mapState.day == null || it.takenAt == mapState.day) }
    }
    // A photo tapped on the map: the timeline comes to it first, so the viewer grows out of its tile there and
    // closing flies back into the timeline, as the web's map brings the timeline to that photo.
    fun openFromMap(id: String) {
        scope.launch {
            if (tab != 0) { tab = 0; kotlinx.coroutines.delay(450) }
            // Where the tile is, also far below the screen (boundsInRoot is cut off at the screen's edge, so it would be empty).
            tiles.tiles[id]?.takeIf { it.isAttached }?.let { c ->
                val middle = c.localToRoot(androidx.compose.ui.geometry.Offset(0f, c.size.height / 2f)).y
                scroll.scrollBy(middle - with(density) { screenH.dp.toPx() } / 2f)
            }
            // A few frames for the rows near it to become real photos, so the viewer grows out of the right tile.
            repeat(3) { androidx.compose.runtime.withFrameNanos { } }
            viewing = id
        }
    }

    // Frame the trip: the middle of its stops, and a zoom that fits their spread.
    val points = trip.stops.map { it.at }.ifEmpty { trip.route }.ifEmpty { listOf(HomeAirport) }
    val lon = points.map { it.first }.average()
    val lat = points.map { it.second }.average()
    val spread = points.maxOf { p -> angle(p, lon to lat) }.coerceAtLeast(0.6)
    val zoom = (34.0 / spread).coerceIn(4.0, 70.0).toFloat()

    SlideHost(tripSettings, onClose = { tripSettings = null }, base = {
    Box(Modifier.fillMaxSize().background(cs.background)) {
        Column(Modifier.fillMaxSize().verticalScroll(scroll)) {
            Box(Modifier.fillMaxWidth().height(mapH)) {
                // The map (a heavy native view) starts once the page has slid in, so opening a trip stays smooth;
                // until then the page colour holds its place, and the map fades in over it.
                var mapReady by remember { androidx.compose.runtime.mutableStateOf(false) }
                androidx.compose.runtime.LaunchedEffect(Unit) { kotlinx.coroutines.delay(380); mapReady = true }
                if (mapReady) TripMap(
                    trip, dark, Modifier.fillMaxSize(), fadeIn = true, bottomInsetDp = 30, topInsetDp = 112, photos = mapPhotos,
                    onPhoto = { m -> openFromMap(m.id) }, state = mapState, onCamera = { cameraInline = it },
                    onLongPress = if (canEdit && tab == 0) ({ at -> lineAt = at }) else null,
                    onSelf = if (canEdit) ({ pointsFor = trip.remoteId }) else null,
                )
                // Open the map full screen, from its own corner as on the web; the day, your own spot and a word when
                // the photos are off in the corners too. They fade away as the map scrolls under the top buttons.
                Box(Modifier.matchParentSize().padding(start = 14.dp, end = 14.dp, bottom = 44.dp).graphicsLayer { alpha = (1f - scroll.value / (mapH.toPx() * 0.45f)).coerceIn(0f, 1f) }) {
                    MapCorners(
                        mapState, showLocate, locating, mapNote, onDays = { daySheet = true }, onLocate = { locate() },
                        onPhotosOff = { mapSheet = true }, onNote = { if (mapNote?.second == true) openAppSettings(context) },
                    ) {
                        RoundButton(onClick = { bigMap = true }) {
                            LineIcon(listOf(P("M4 9V4h5"), P("M20 9V4h-5"), P("M4 15v5h5"), P("M20 15v5h-5")), cs.onSurface, size = 20.dp, stroke = 2.2f)
                        }
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
                    // Drawn round, not clipped: a clip makes this sheet one rounded layer, and touches far down a long
                    // timeline (some 8000 px into it) fell outside that layer's outline, so a tap on a photo did nothing.
                    .background(cs.background, RoundedCornerShape(topStart = 32.dp, topEnd = 32.dp))
                    .padding(horizontal = 16.dp),
            ) {
                Box(Modifier.align(Alignment.CenterHorizontally).padding(top = 10.dp).size(width = 36.dp, height = 4.dp).clip(CircleShape).background(cs.outlineVariant))
                CoverCard(trip, photos = media?.size, modifier = Modifier.padding(top = 14.dp), onPeople = if (trip.remoteId != null) ({ people = true }) else null)
                Facts(trip, Modifier.padding(top = 4.dp), photos = media?.size, stopsKnown = base.remoteId == null || trip !== base)

                Row(Modifier.fillMaxWidth().padding(top = 18.dp), horizontalArrangement = Arrangement.spacedBy(ButtonGroupDefaults.ConnectedSpaceBetween)) {
                    listOf("Tijdlijn", "Routeplanner").forEachIndexed { i, label ->
                        ToggleButton(
                            checked = tab == i,
                            onCheckedChange = { if (tab != i) haptics(Haptic.Tick); tab = i },
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
                    // Tijdlijn and Routeplanner slide the way of the tab you picked, like Afgelopen reizen and Gedeeld.
                    val tabMotion = MaterialTheme.motionScheme
                    androidx.compose.animation.AnimatedContent(
                        tab,
                        transitionSpec = {
                            val dir = if (targetState > initialState) 1 else -1
                            (androidx.compose.animation.slideInHorizontally(tabMotion.defaultSpatialSpec()) { w -> dir * w / 5 } + androidx.compose.animation.fadeIn(tabMotion.defaultEffectsSpec())) togetherWith
                                (androidx.compose.animation.slideOutHorizontally(tabMotion.defaultSpatialSpec()) { w -> -dir * w / 5 } + androidx.compose.animation.fadeOut(tabMotion.fastEffectsSpec())) using
                                androidx.compose.animation.SizeTransform(clip = false)
                        },
                        label = "tripTab",
                    ) { which ->
                        Column {
                            if (which == 0) Timeline(
                                trip, dark, media, onPhoto = { m -> viewing = m.id }, bounds = tiles, hidden = openPhoto, onJump = { y -> scope.launch { scroll.animateScrollBy(y - with(density) { 120.dp.toPx() }) } },
                                talk = talk, onComments = { m -> viewingComments = true; viewing = m.id }, marks = marks,
                            ) else androidx.compose.runtime.key(trip.stops.size) {
                                Planner(
                                    trip, dark,
                                    // A tapped stop: up to the map, which flies there.
                                    onFlyTo = { at -> scope.launch { scroll.animateScrollTo(0); cameraInline?.flyTo(at, 10.0) } },
                                    onPickOnMap = if (trip.remoteId != null) ({ picked -> pickFor = picked }) else null,
                                )
                            }
                        }
                    }
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
                // One connected group, as Material 3 Expressive does it: round on the outside, tight where they meet.
                // The one whose panel is open turns into an orange pill, and back when the panel closes.
                data class TopButton(val open: Boolean, val go: () -> Unit, val icon: List<Shape24>, val size: androidx.compose.ui.unit.Dp, val stroke: Float)
                val buttons = buildList {
                    if (trip.remoteId != null) add(TopButton(people, { people = true }, Glyphs.friends, 22.dp, 1.9f))
                    add(TopButton(mapSheet, { mapSheet = true }, listOf(P("M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5Z"), P("M9 4v13.5"), P("M15 6.5V20")), 21.dp, 1.9f))
                    if (trip.remoteId != null) add(TopButton(tripSettings == true, { tripSettings = true }, Glyphs.settings, 21.dp, 1.8f))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically) {
                    buttons.forEachIndexed { i, b ->
                        val spatial = MaterialTheme.motionScheme.defaultSpatialSpec<androidx.compose.ui.unit.Dp>()
                        val outer = 24.dp; val inner = 8.dp
                        val tl by androidx.compose.animation.core.animateDpAsState(if (b.open || i == 0) outer else inner, spatial, label = "tl")
                        val tr by androidx.compose.animation.core.animateDpAsState(if (b.open || i == buttons.lastIndex) outer else inner, spatial, label = "tr")
                        val w by androidx.compose.animation.core.animateDpAsState(if (b.open) 64.dp else 54.dp, spatial, label = "w")
                        val bg by androidx.compose.animation.animateColorAsState(if (b.open) cs.primary else cs.surfaceContainerHighest, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "bg")
                        val fg by androidx.compose.animation.animateColorAsState(if (b.open) cs.onPrimary else cs.onSurface, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "fg")
                        val shape = RoundedCornerShape(topStart = tl, bottomStart = tl, topEnd = tr, bottomEnd = tr)
                        Box(Modifier.size(width = w, height = 48.dp).clip(shape).background(bg).press(b.go), contentAlignment = Alignment.Center) {
                            LineIcon(b.icon, fg, size = b.size, stroke = b.stroke)
                        }
                    }
                }
            }
        }
        // Back to the top once the map has scrolled away, as on the web; arriving there shows the whole trip again.
        // It steps aside while typing and at the very end, where it would sit on the search results and their buttons.
        @OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
        val typing = WindowInsets.isImeVisible
        val atEnd = scroll.maxValue - scroll.value < with(density) { 140.dp.toPx() }
        androidx.compose.animation.AnimatedVisibility(
            scroll.value > with(density) { (mapH + 80.dp).toPx() } && viewing == null && !typing && !atEnd && tab == 0,
            modifier = Modifier.align(Alignment.BottomEnd).padding(end = 18.dp, bottom = 24.dp).windowInsetsPadding(WindowInsets.navigationBars),
            enter = androidx.compose.animation.fadeIn(MaterialTheme.motionScheme.defaultEffectsSpec()) + androidx.compose.animation.scaleIn(MaterialTheme.motionScheme.fastSpatialSpec(), initialScale = 0.6f),
            exit = androidx.compose.animation.fadeOut(MaterialTheme.motionScheme.fastEffectsSpec()) + androidx.compose.animation.scaleOut(MaterialTheme.motionScheme.fastSpatialSpec(), targetScale = 0.6f),
        ) {
            Box(Modifier.size(52.dp).clip(CircleShape).background(cs.primaryContainer).press { scope.launch { scroll.animateScrollTo(0) } }, contentAlignment = Alignment.Center) {
                LineIcon(listOf(P("M12 19V5"), P("m5 12 7-7 7 7")), cs.onPrimaryContainer, size = 22.dp, stroke = 2.2f)
            }
        }
        // A grip on the right edge to throw the timeline down with, and the day you are passing beside it.
        FastScroll(
            scroll, marks, enabled = tab == 0 && collapsed && viewing == null && !bigMap,
            topInset = with(density) { WindowInsets.statusBars.getTop(this).toDp() } + 72.dp,
            bottomInset = with(density) { WindowInsets.navigationBars.getBottom(this).toDp() } + 96.dp,
        )
        // The map full screen: it grows open and closes with back or the cross.
        androidx.compose.animation.AnimatedVisibility(
            bigMap,
            enter = androidx.compose.animation.fadeIn(MaterialTheme.motionScheme.defaultEffectsSpec()) + androidx.compose.animation.scaleIn(MaterialTheme.motionScheme.defaultSpatialSpec(), initialScale = 0.92f),
            exit = androidx.compose.animation.fadeOut(MaterialTheme.motionScheme.fastEffectsSpec()) + androidx.compose.animation.scaleOut(MaterialTheme.motionScheme.fastSpatialSpec(), targetScale = 0.92f),
        ) {
            // Predictive back: the full map shrinks with the finger and the trip page shows behind it.
            var backT by remember { androidx.compose.runtime.mutableFloatStateOf(0f) }
            androidx.activity.compose.PredictiveBackHandler { events ->
                try { events.collect { backT = it.progress }; bigMap = false } catch (e: kotlin.coroutines.cancellation.CancellationException) { backT = 0f; throw e }
            }
            Box(Modifier.fillMaxSize().graphicsLayer { val k = 1f - 0.12f * backT; scaleX = k; scaleY = k; shape = RoundedCornerShape((32 * backT).dp.toPx()); clip = true }.background(cs.background)) {
                // Clear of the clock and the cross at the top and of the gesture bar at the bottom.
                val topDp = with(density) { WindowInsets.statusBars.getTop(this).toDp().value.toInt() } + 72
                val bottomDp = with(density) { WindowInsets.navigationBars.getBottom(this).toDp().value.toInt() }
                TripMap(
                    // Clear of the day pill and the buttons at the bottom too.
                    trip, dark, Modifier.fillMaxSize(), bottomInsetDp = bottomDp + 60, topInsetDp = topDp, fadeIn = true, photos = mapPhotos,
                    onPhoto = { m -> bigMap = false; openFromMap(m.id) }, state = mapState, onCamera = { cameraBig = it },
                    onLongPress = if (canEdit) ({ at -> lineAt = at }) else null,
                    onSelf = if (canEdit) ({ pointsFor = trip.remoteId }) else null,
                )
                Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.navigationBars).padding(start = 14.dp, end = 14.dp, bottom = 16.dp)) {
                    MapCorners(
                        mapState, showLocate, locating, mapNote, onDays = { daySheet = true }, onLocate = { locate() },
                        onPhotosOff = { mapSheet = true }, onNote = { if (mapNote?.second == true) openAppSettings(context) },
                    ) {}
                }
                Column {
                    Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
                    Box(Modifier.padding(12.dp)) {
                        RoundButton(onClick = { bigMap = false }) { LineIcon(listOf(P("M18 6 6 18"), P("m6 6 12 12")), cs.onSurface, size = 22.dp, stroke = 2.2f) }
                    }
                }
            }
        }
        if (mapSheet) MapSheet(onDismiss = { mapSheet = false }, layers = trip.remoteId?.let { id ->
            // Only travellers who put something on this map: a switch for someone with nothing on it does nothing.
            val contributed = mapState.routes.orEmpty().filter { it.points.isNotEmpty() }.map { it.userId }.toSet() + media.orEmpty().map { it.userId } + mapState.live.map { it.userId }
            val members = trip.members.filter { it.userId in contributed }.ifEmpty { trip.members.filter { it.role != "GUEST" } }
            val primary = primaryTraveller(trip, mapState.routes)
            val photoSet = mapState.photoUsers ?: trip.members.map { it.userId }.toSet()
            fun savePhotos(set: Set<String>?) { mapState.photoUsers = set; MapPhotosPref.set(id, set) }
            MapLayers(
                members, mapState.routeUsers ?: emptySet(), photoSet, mapState.live,
                colorOf = { routeColor(trip, it, primary, dark) },
                onRoute = { uid -> val cur = mapState.routeUsers ?: emptySet(); mapState.routeUsers = if (uid in cur) cur - uid else cur + uid },
                onPhoto = { uid -> savePhotos(if (uid in photoSet) photoSet - uid else photoSet + uid) },
                onAllPhotos = { on -> savePhotos(if (on) null else emptySet()) },
            )
        })
        if (daySheet) DaySheet(mapState, onPick = { d -> dayPicked = true; mapState.day = d }, onDismiss = { daySheet = false })
        lineAt?.let { at ->
            LineMenuSheet(
                trip, mapState, at, onDismiss = { lineAt = null }, onTrain = { prefill -> trainFor = at to prefill },
                run = { block, done ->
                    scope.launch { mapNote = runCatching { block(); mapState.reloadRoutes() }.fold({ done to false }, { (it.message ?: "Dat lukte niet") to false }) }
                },
            )
        }
        trainFor?.let { (at, prefill) ->
            TrainSheet(prefill, onDraw = { from, to ->
                trip.remoteId?.let { id -> MapRemote.drawTrain(id, at, from, to); mapState.reloadRoutes(); mapNote = "Treinroute getekend" to false }
            }, onDismiss = { trainFor = null })
        }
        pointsFor?.let { id -> PointsEditor(id, onClose = { pointsFor = null; scope.launch { mapState.reloadRoutes() } }) }
        pickFor?.let { picked -> MapPickDialog(trip, dark, onPicked = { picked(it) }, onDismiss = { pickFor = null }) }
        // "X is bezig. Route bijhouden?" floats at the bottom of an ongoing trip until answered.
        TrackPrompt(
            trip,
            visible = promptReady && !promptGone && !promptAsked && trip.remoteId != null && ongoing && canTrack(trip) && !trackingHere && viewing == null && !bigMap,
            onLater = { trip.remoteId?.let { TrackPromptPref.dismiss(context, it) }; promptGone = true },
            onStart = {
                val id = trip.remoteId
                if (id != null) trackRequest.run(context) {
                    Tracker.start(context, id, trip.title, trip.start?.plusDays((trip.days - 1).toLong()))
                    haptics(Haptic.Confirm)
                    promptGone = true
                }
            },
            modifier = Modifier.align(Alignment.BottomCenter).windowInsetsPadding(WindowInsets.navigationBars).padding(16.dp),
        )
        if (people) PeopleSheet(
            trip, onDismiss = { people = false }, onChanged = { scope.launch { Data.load() } },
            onMake = if (!trip.upcoming && media?.isNotEmpty() == true) ({ which -> people = false; extra = which }) else null,
        )
        // While paging in the viewer the timeline brings that photo to the middle, so closing flies back into it.
        // Not for the photo just tapped: that tile is on screen already, and the page must not move under the opening photo.
        var paged by remember { androidx.compose.runtime.mutableStateOf(false) }
        androidx.compose.runtime.LaunchedEffect(viewing) { paged = false }
        androidx.compose.runtime.LaunchedEffect(openPhoto) {
            val id = openPhoto ?: return@LaunchedEffect
            if (id != viewing) paged = true
            if (!paged) return@LaunchedEffect
            val r = tiles.rect(id) ?: return@LaunchedEffect
            val screen = with(density) { screenH.dp.toPx() }
            if (r.top < screen * 0.15f || r.bottom > screen * 0.85f) scroll.animateScrollBy(r.center.y - screen / 2f)
        }
        // A tapped photo opens full screen over everything, the toolbar included.
        viewing?.let { id ->
            val photos = media.orEmpty()
            if (photos.any { it.id == id }) PhotoViewer(trip, photos, id, bounds = tiles, onCurrent = { openPhoto = it }, startComments = viewingComments, onClose = { viewing = null })
        }

        TripExtras(trip, dark, extra, onClose = { extra = null })
    }
    }) {
        TripSettingsPage(
            trip, onBack = { tripSettings = null }, onChanged = { scope.launch { Data.load() } },
            onPeople = { people = true }, onGone = { tripSettings = null; onBack() },
        )
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
    // Two faces then "+n", as on the cards; three people show all three.
    val faces = people.take(if (people.size + extra <= 3) 3 else 2)
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
private fun factsOf(trip: Trip, photos: Int?, stopsKnown: Boolean): List<Pair<String?, String>> = if (trip.upcoming) listOfNotNull(
    trip.startsInDays?.let { "$it" to (if (it == 1) "dag tot vertrek" else "dagen tot vertrek") },
    "${trip.days}" to "dagen",
    // As for a past trip: stops only for a route of two or more, travellers only when you are not alone.
    if (!stopsKnown) null to "stops" else trip.stops.size.takeIf { it > 1 }?.let { "$it" to "stops" },
    (trip.people.size + trip.extraPeople).takeIf { it > 1 }?.let { "$it" to "reizigers" },
    if (stopsKnown) trip.stops.mapNotNull { it.flag.takeIf { f -> f.isNotBlank() } }.distinct().size.takeIf { it > 0 }?.let { "$it" to (if (it == 1) "land" else "landen") } else null,
).take(4) else if (trip.remoteId != null && (!stopsKnown || photos == null)) List(4) { null to " " } else {
    // As the web (lib/tripFacts.ts): the first four that have something to say, in a fixed order: distance,
    // days, stops (only for a route of two or more), photos, travellers (more than you alone), countries.
    val travellers = trip.members.count { it.role != "GUEST" }.takeIf { it > 0 } ?: (trip.people.size + trip.extraPeople)
    val countries = trip.stops.mapNotNull { it.flag.takeIf { f -> f.isNotBlank() } }.distinct().size
    // Each figure that has something to say, by its id; the trip's own choice (Reisinstellingen > Feitjes)
    // comes first, topped up from the fixed order, as the web's resolveFacts.
    val facts = linkedMapOf<String, Pair<String?, String>>()
    trip.km?.takeIf { it > 0 }?.let { facts["km"] = "%,d".format(it).replace(',', '.') to "kilometer" }
    trip.days.takeIf { it > 0 }?.let { facts["days"] = "$it" to (if (it == 1) "dag" else "dagen") }
    trip.stops.size.takeIf { it > 1 }?.let { facts["stops"] = "$it" to "stops" }
    (photos ?: trip.photos).takeIf { it > 0 }?.let { facts["photos"] = "$it" to (if (it == 1) "foto" else "foto's") }
    travellers.takeIf { it > 1 }?.let { facts["travellers"] = "$it" to "reizigers" }
    countries.takeIf { it > 0 }?.let { facts["countries"] = "$it" to (if (it == 1) "land" else "landen") }
    val chosen = TripFactsPref.chosen[trip.id] ?: trip.remoteId?.let { TripFactsPref.chosen[it] }.orEmpty()
    (chosen + TripFactsPref.Ids).distinct().mapNotNull { facts[it] }.take(4)
}

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
private fun Facts(trip: Trip, modifier: Modifier = Modifier, photos: Int? = null, stopsKnown: Boolean = true) {
    val items = chosenFacts(trip, photos, stopsKnown) ?: factsOf(trip, photos, stopsKnown)
    // The tone of the cover above, so the figures belong to it and stand off the page.
    val cs = MaterialTheme.colorScheme
    val dark = cs.background.luminance() < 0.5f
    val tone = coverTone(trip)
    val tile by androidx.compose.animation.animateColorAsState(
        (tone ?: trip.color).copy(alpha = if (dark) 0.34f else 0.26f).compositeOver(cs.surfaceContainerLow),
        MaterialTheme.motionScheme.slowEffectsSpec(), label = "factsTone",
    )
    // Waiting tiles turn into the real ones in one soft fade, even when there are fewer of them.
    androidx.compose.animation.Crossfade(items, animationSpec = MaterialTheme.motionScheme.defaultEffectsSpec(), label = "facts") { items ->
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
                // A value not known yet keeps its exact height as a soft shape, then fades into the number.
                androidx.compose.animation.Crossfade(value, animationSpec = MaterialTheme.motionScheme.defaultEffectsSpec(), label = "fact") { v ->
                    val style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 21.sp, letterSpacing = (-0.02).em, color = MaterialTheme.colorScheme.onSurface)
                    if (v != null) Text(v, maxLines = 1, style = style)
                    else Text("0000", maxLines = 1, style = style.copy(color = Color.Transparent), modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f)))
                }
                Text(label, maxLines = 1, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant))
            }
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
