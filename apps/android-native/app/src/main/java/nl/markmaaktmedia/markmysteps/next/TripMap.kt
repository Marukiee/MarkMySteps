package nl.markmaaktmedia.markmysteps.next

import androidx.compose.runtime.getValue
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.animation.core.animateFloat
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.layout.onSizeChanged
import kotlinx.coroutines.launch
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.graphicsLayer

import android.graphics.Color as AColor
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMapOptions
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.TransitionOptions
import org.maplibre.android.style.layers.PropertyFactory.circleColor
import org.maplibre.android.style.layers.PropertyFactory.circleRadius
import org.maplibre.android.style.layers.PropertyFactory.circleStrokeColor
import org.maplibre.android.style.layers.PropertyFactory.circleStrokeWidth
import org.maplibre.android.style.layers.PropertyFactory.lineCap
import org.maplibre.android.style.layers.PropertyFactory.lineColor
import org.maplibre.android.style.layers.PropertyFactory.lineDasharray
import org.maplibre.android.style.layers.PropertyFactory.lineJoin
import org.maplibre.android.style.layers.PropertyFactory.lineOpacity
import org.maplibre.android.style.layers.PropertyFactory.lineWidth
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point
import java.time.LocalDate
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.math.atan
import kotlin.math.exp
import kotlin.math.hypot
import kotlin.math.ln
import kotlin.math.tan

/*
 * The trip's map: MapLibre with the same OpenFreeMap styles as the web app
 * (positron by day, dark at night), so it has the names, borders and roads.
 * On it every traveller's own line (the trip's colour for the organiser, each
 * companion in their own), flights as great-circle arcs, the planned legs
 * where nothing was recorded, a dot per stop and a small one per day trip.
 * Over it, drawn by Compose: the photos, your own blue dot, the companions'
 * faces where they are now, and the label of a tapped stop.
 *
 * The style is set once per look (trip, theme, style); everything else is
 * pushed into its sources as it changes, so the day filter, the layer
 * switches and the live positions never reload the map.
 */

private const val LIGHT = "https://tiles.openfreemap.org/styles/positron"
private const val DARK = "https://tiles.openfreemap.org/styles/dark"
/** Keyless Esri World Imagery, the web app's satellite style. */
internal const val SATELLITE = """{"version":8,"sources":{"sat":{"type":"raster","tiles":["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],"tileSize":256,"maxzoom":19}},"layers":[{"id":"sat","type":"raster","source":"sat"}]}"""

/** The style the maps use now: the chosen one, the dark map in the dark; null for satellite (not a URL). */
fun mapStyleUrl(dark: Boolean, styleId: String = MapStylePref.id): String? = when {
    styleId == "satellite" -> null
    dark -> DARK
    else -> "https://tiles.openfreemap.org/styles/$styleId"
}

/** The map style builder for the chosen style. */
fun mapStyleBuilder(dark: Boolean, styleId: String = MapStylePref.id): Style.Builder =
    mapStyleUrl(dark, styleId)?.let { Style.Builder().fromUri(it) } ?: Style.Builder().fromJson(SATELLITE)

/** How long a line takes to come up or go, as on the web. */
private const val FADE_MS = 260L

/** A tapped stop or day trip, for its label. */
private data class StopLabel(val id: String, val at: LonLat, val name: String, val when_: String)

@Composable
fun TripMap(
    trip: Trip, dark: Boolean, modifier: Modifier = Modifier, bottomInsetDp: Int = 60, topInsetDp: Int = 96, fadeIn: Boolean = false,
    photos: List<Media> = emptyList(), onPhoto: (Media) -> Unit = {},
    /** Shared with the page: the lines, the day, the layers, the live positions. Null draws the trip as it comes. */
    state: TripMapState? = null,
    /** The camera once the map is ready (and null when it goes), for the page's buttons. */
    onCamera: ((MapCamera?) -> Unit)? = null,
    /** A long press on the map, for the line menu. */
    onLongPress: ((LonLat) -> Unit)? = null,
    /** A tap on the map that hit nothing of its own (no stop, no photo). */
    onTap: ((LonLat) -> Unit)? = null,
    /** A tap on your own dot. */
    onSelf: (() -> Unit)? = null,
    /** A tap on a group of photos (it also zooms in), for the timeline to follow. */
    onCluster: ((Media) -> Unit)? = null,
) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val density = LocalDensity.current.density
    val color = legibleColor(trip.color, dark).toArgb()
    val view = remember {
        MapLibre.getInstance(context)
        MapView(context, MapLibreMapOptions.createFromAttributes(context).textureMode(true).attributionEnabled(false).logoEnabled(false)
            // The empty map's colour before tiles arrive follows the theme, so dark mode never flashes light.
            .foregroundLoadColor(if (dark) 0xFF14181D.toInt() else 0xFFF3ECE2.toInt())).apply {
            onCreate(null)
        }
    }

    // The map follows the screen's life: running while visible, gone with the page.
    DisposableEffect(lifecycle, view) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> view.onStart()
                Lifecycle.Event.ON_RESUME -> view.onResume()
                Lifecycle.Event.ON_PAUSE -> view.onPause()
                Lifecycle.Event.ON_STOP -> view.onStop()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) view.onStart()
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) view.onResume()
        onDispose {
            lifecycle.removeObserver(observer)
            view.onPause(); view.onStop(); view.onDestroy()
        }
    }

    val styleId = MapStylePref.id
    val key = "${trip.id}/$dark/$styleId"
    // A map that opens on its own (full screen) waits for its first tiles and then fades in, so the route is
    // never drawn on an empty background.
    var ready by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(!fadeIn) }
    val shown by androidx.compose.animation.core.animateFloatAsState(if (ready) 1f else 0f, androidx.compose.material3.MaterialTheme.motionScheme.defaultEffectsSpec(), label = "mapIn")
    // Fitting again whenever the view changes size: a fit made before the view had its final size framed the
    // route wrongly, cut off at the edges.
    val fit = androidx.compose.runtime.remember { arrayOfNulls<(Boolean) -> Unit>(1) }
    // The map takes the finger itself, also inside a scrolling page: a drag on it moves the map, not the page.
    DisposableEffect(view) {
        view.setOnTouchListener { v, e -> if (e.actionMasked == android.view.MotionEvent.ACTION_DOWN) v.parent?.requestDisallowInterceptTouchEvent(true); false }
        onDispose { view.setOnTouchListener(null) }
    }
    var mapRef by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf<org.maplibre.android.maps.MapLibreMap?>(null) }
    var cameraTick by androidx.compose.runtime.remember { androidx.compose.runtime.mutableIntStateOf(0) }
    // The style that is up now, and a count that goes up each time a new one is, so the data is pushed into it.
    var style by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf<Style?>(null) }
    var label by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf<StopLabel?>(null) }
    // The newest callbacks, read by listeners that are attached only once.
    val calls = androidx.compose.runtime.rememberUpdatedState(Triple(onLongPress, onTap, trip))
    DisposableEffect(view) {
        val l = android.view.View.OnLayoutChangeListener { _, l, t, r, b, ol, ot, or, ob -> if (r - l != or - ol || b - t != ob - ot) fit[0]?.invoke(false) }
        view.addOnLayoutChangeListener(l)
        if (fadeIn) view.addOnDidFinishLoadingMapListener { ready = true }
        onDispose { view.removeOnLayoutChangeListener(l) }
    }
    DisposableEffect(view) { onDispose { onCamera?.invoke(null) } }
    androidx.compose.foundation.layout.Box(modifier.graphicsLayer { alpha = shown }) {
    AndroidView(factory = { view }, modifier = Modifier.matchParentSize(), update = { map ->
        if (map.tag == key) return@AndroidView
        map.tag = key
        map.getMapAsync { m ->
            if (mapRef == null) {
                mapRef = m
                m.addOnCameraMoveListener { cameraTick++ }
                m.addOnCameraIdleListener { cameraTick++ }
                // A tap on a stop's dot opens its label; anywhere else closes it and goes to the page.
                m.addOnMapClickListener { ll ->
                    val p = m.projection.toScreenLocation(ll)
                    val r = 16 * density
                    val hit = runCatching { m.queryRenderedFeatures(android.graphics.RectF(p.x - r, p.y - r, p.x + r, p.y + r), "stop-dots", "daytrip-dots") }.getOrNull()?.firstOrNull()
                    val id = hit?.getStringProperty("id")
                    val t = calls.value.third
                    val found = id?.let { sid -> labelFor(t, sid) }
                    if (found != null) { label = if (label?.id == found.id) null else found; true }
                    else { label = null; calls.value.second?.invoke(ll.longitude to ll.latitude); false }
                }
                m.addOnMapLongClickListener { ll ->
                    val press = calls.value.first ?: return@addOnMapLongClickListener false
                    view.haptic(Haptic.LongPress)
                    press(ll.longitude to ll.latitude)
                    true
                }
            }
            m.uiSettings.isRotateGesturesEnabled = false
            m.uiSettings.isTiltGesturesEnabled = false
            m.uiSettings.isCompassEnabled = false
            style = null
            m.setStyle(mapStyleBuilder(dark, styleId)) { st ->
                dutchLabels(st)
                addLayers(st, color, dark)
                // The flights' bows count too, so the whole route with its arcs fits on screen.
                val bowPoints = trip.flightLegs.ifEmpty { trip.flights.map { listOf(it.first, it.second) } }.flatMap { hops -> hops.zipWithNext().flatMap { (a, b) -> flightArc(a, b, 12) } }
                // The trip itself decides the view: its stops and the route travelled. The flights to and from home
                // are left out (they would shrink a trip in Morocco to a corner of Europe); only a trip that is
                // nothing but flights is framed by its bows.
                fun framePoints(): List<LonLat> {
                    val t = calls.value.third
                    val own = t.stops.map { it.at } + t.route
                    return (if (own.size >= 2) own else own + bowPoints).ifEmpty { listOf(HomeAirport) }
                }
                // Room on every side, more at the bottom for the panel's corner and the expand button, so the
                // route sits nicely in the middle instead of against the edges.
                val pad = (44 * density).toInt()
                fun frame(points: List<LonLat>, animate: Boolean, maxZoom: Double) {
                    if (view.width <= 0 || view.height <= 0 || points.isEmpty()) return
                    val update = if (points.size == 1 || points.all { angle(it, points[0]) < 0.002 }) {
                        CameraUpdateFactory.newLatLngZoom(LatLng(points[0].second, points[0].first), minOf(maxZoom, if (animate) 13.0 else 9.0))
                    } else {
                        val bounds = LatLngBounds.Builder().apply { points.forEach { include(LatLng(it.second, it.first)) } }.build()
                        CameraUpdateFactory.newLatLngBounds(bounds, pad, ((topInsetDp + 28) * density).toInt(), pad, ((bottomInsetDp + 56) * density).toInt())
                    }
                    if (animate) {
                        m.animateCamera(update, 700, object : org.maplibre.android.maps.MapLibreMap.CancelableCallback {
                            override fun onCancel() {}
                            override fun onFinish() { if (m.cameraPosition.zoom > maxZoom) m.animateCamera(CameraUpdateFactory.zoomTo(maxZoom), 300) }
                        })
                    } else {
                        m.moveCamera(update)
                        // A city trip opens at city level, not on a street corner.
                        if (m.cameraPosition.zoom > maxZoom) m.moveCamera(CameraUpdateFactory.zoomTo(maxZoom))
                    }
                }
                fit[0] = { animate -> frame(framePoints(), animate, 11.5) }
                fit[0]?.invoke(false)
                style = st
                onCamera?.invoke(object : MapCamera {
                    override fun flyTo(at: LonLat, zoom: Double) { m.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(at.second, at.first), zoom), 700) }
                    override fun focusOn(points: List<LonLat>) = frame(points, true, 13.0)
                    override fun reset() { fit[0]?.invoke(true) }
                })
            }
        }
    })
    // Everything that changes without a new style is pushed into the sources here.
    val routes = state?.routes
    val routeUsers = state?.routeUsers
    val day = state?.day
    val hidden = state?.hiddenLegs?.toMap().orEmpty()
    androidx.compose.runtime.LaunchedEffect(style, routes, routeUsers, day, trip.stops, hidden, photos) {
        val st = style ?: return@LaunchedEffect
        runCatching { render(st, trip, state, color, dark, photos) }
    }
    // A stop that went out of the day (or out of the plan) takes its label with it.
    androidx.compose.runtime.LaunchedEffect(day, trip.stops) { label = label?.let { l -> labelFor(trip, l.id)?.takeIf { visibleOn(trip, l.id, day) } } }
    PhotoMarkers(mapRef, cameraTick, photos, trip, onPhoto, onCluster)
    state?.let { s ->
        LiveFaces(mapRef, cameraTick, s.live.filter { it.userId != Data.me?.id })
        s.self?.let { SelfDot(mapRef, cameraTick, it, onSelf) }
    }
    StopLabelCard(mapRef, cameraTick, label, onClose = { label = null })
    }
}

private fun lineOf(points: List<LonLat>) = LineString.fromLngLats(points.map { Point.fromLngLat(it.first, it.second) })

private fun hex(c: Int) = String.format("#%06X", 0xFFFFFF and c)

/** The sources and layers that are there from the start; every traveller's line is added as it comes. */
private fun addLayers(style: Style, color: Int, dark: Boolean) {
    val empty = { FeatureCollection.fromFeatures(emptyList<Feature>()) }
    for (id in listOf("planned", "flights", "airports", "stops")) style.addSource(GeoJsonSource(id, empty()))
    val ground = if (dark) AColor.BLACK else AColor.WHITE
    // The plan where nothing was recorded: a solid line for a leg that was travelled, dots for one to come.
    style.addLayer(LineLayer("planned-line", "planned").withProperties(
        lineColor(color), lineWidth(3f), lineCap(Property.LINE_CAP_ROUND), lineJoin(Property.LINE_JOIN_ROUND),
    ).withFilter(Expression.eq(Expression.get("future"), Expression.literal(false))))
    style.addLayer(LineLayer("planned-future", "planned").withProperties(
        lineColor(color), lineWidth(3.5f), lineCap(Property.LINE_CAP_ROUND), lineJoin(Property.LINE_JOIN_ROUND), lineDasharray(arrayOf(0.1f, 2.2f)),
    ).withFilter(Expression.eq(Expression.get("future"), Expression.literal(true))))
    // A flight is a grey dashed bow, as on the web: the arc is drawn, not recorded, so it never takes the
    // trip's colour. Short dashes with clear gaps (a round cap adds half the width to each end), so it reads
    // as dashes and not as one line.
    val flightGrey = if (dark) AColor.parseColor("#9AA4B3") else AColor.parseColor("#8A94A3")
    style.addLayer(LineLayer("flight-line", "flights").withProperties(
        lineColor(flightGrey), lineWidth(2.2f), lineDasharray(arrayOf(1.2f, 3.4f)), lineCap(Property.LINE_CAP_ROUND),
    ))
    style.addLayer(CircleLayer("airport-dots", "airports").withProperties(
        circleRadius(4.5f), circleColor(flightGrey), circleStrokeColor(ground), circleStrokeWidth(2f),
    ))
    // A day trip is a smaller ring in the trip's colour; a stop the full dot.
    style.addLayer(CircleLayer("daytrip-dots", "stops").withProperties(
        circleRadius(4.5f), circleColor(ground), circleStrokeColor(color), circleStrokeWidth(2.5f),
    ).withFilter(Expression.eq(Expression.get("kind"), Expression.literal("day"))))
    style.addLayer(CircleLayer("stop-dots", "stops").withProperties(
        circleRadius(6f), circleColor(color), circleStrokeColor(ground), circleStrokeWidth(2.5f),
    ).withFilter(Expression.eq(Expression.get("kind"), Expression.literal("stop"))))
}

/** Whether a stop's stay covers [day] (every stop on the whole trip). */
private fun covers(s: Stop, day: LocalDate?): Boolean {
    if (day == null || s.start == null) return true
    return !day.isBefore(s.start) && !day.isAfter(s.start.plusDays(s.nights.toLong()))
}

private fun visibleOn(trip: Trip, id: String, day: LocalDate?): Boolean {
    trip.stops.firstOrNull { it.id == id || "stop:${it.name}" == id }?.let { return covers(it, day) }
    val dt = trip.stops.flatMap { it.dayTrips }.firstOrNull { it.id == id } ?: return false
    return day == null || dt.day == null || dt.day == day
}

private val Months = listOf("jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec")

/** The label of a stop or a day trip by its id: name and when, as the web's stop popup. */
private fun labelFor(trip: Trip, id: String): StopLabel? {
    trip.stops.firstOrNull { (it.id ?: "stop:${it.name}") == id }?.let { s -> return StopLabel(id, s.at, s.name, s.dates) }
    for (s in trip.stops) for (dt in s.dayTrips) if (dt.id == id) {
        val at = dt.at ?: return null
        return StopLabel(id, at, dt.name, dt.day?.let { "Dagtrip · ${it.dayOfMonth} ${Months[it.monthValue - 1]}" } ?: "Dagtrip")
    }
    return null
}

/**
 * As the web's legIsRecorded: a planned leg was travelled for real when something recorded (a fix or a photo)
 * lies near both of its ends.
 */
private fun recorded(from: LonLat, to: LonLat, points: List<LonLat>): Boolean {
    val kx = 111.32 * cos(Math.toRadians((from.second + to.second) / 2)); val ky = 110.57
    fun km(a: LonLat, b: LonLat) = hypot((a.first - b.first) * kx, (a.second - b.second) * ky)
    val reach = minOf(60.0, maxOf(12.0, km(from, to) * 0.12))
    var atFrom = false; var atTo = false
    for (p in points) {
        if (!atFrom && km(p, from) <= reach) atFrom = true
        if (!atTo && km(p, to) <= reach) atTo = true
        if (atFrom && atTo) return true
    }
    return false
}

/** The colour of a traveller's line: the trip's own for the organiser (or the only one), each companion their own. */
fun routeColor(trip: Trip, userId: String, primary: String?, dark: Boolean): androidx.compose.ui.graphics.Color =
    if (userId == primary || userId == "trip") legibleColor(trip.color, dark) else legibleColor(personColor(userId), dark)

/** Whose line takes the trip's colour: the organiser's when they recorded one, else the first that is there. */
fun primaryTraveller(trip: Trip, routes: List<MapRemote.RouteLine>?): String? =
    routes?.firstOrNull { it.userId == trip.ownerId && it.points.size >= 2 }?.userId ?: routes?.firstOrNull { it.points.size >= 2 }?.userId

private fun render(style: Style, trip: Trip, state: TripMapState?, color: Int, dark: Boolean, photos: List<Media>) {
    val day = state?.day
    val today = LocalDate.now()
    val routes = state?.routes
    // Every traveller's line, or (before the server answered, or for an invented trip) the trip's own route.
    val primary = primaryTraveller(trip, routes)
    val lines: List<Triple<String, Int, List<List<LonLat>>>> = if (routes != null) {
        routes.filter { it.points.size >= 2 }.map { Triple(it.userId, routeColor(trip, it.userId, primary, dark).toArgb(), listOf(it.points)) }
    } else {
        val pieces = if (trip.remoteId != null) trip.segments else trip.segments.ifEmpty { listOf(trip.route) }
        listOf(Triple("trip", color, pieces.filter { it.size >= 2 }))
    }
    val shownUsers = state?.routeUsers
    fun on(user: String) = routes == null || shownUsers == null || user in shownUsers

    // As the web app (lib/mapRoute.ts splitTrack): the recorded line is cut wherever two
    // fixes lie more than 400 km apart. A jump the plan calls a flight is left to that
    // flight's bow, one too far for anything but a plane gets a bow of its own, and the
    // rest (a train through a tunnel) stays a plain line from one end to the other.
    val stops = trip.stops.filter { covers(it, day) }
    val legs = trip.flightLegs.ifEmpty { trip.flights.map { listOf(it.first, it.second) } }
    fun near(a: LonLat, b: LonLat, km: Double) = angle(a, b) * 111.2 <= km
    // One day shows that day's flights only: a hop that starts or ends at a place of that day.
    val allHops = legs.flatMap { it.zipWithNext() }
    val hops = if (day == null) allHops else allHops.filter { (a, b) -> stops.any { near(it.at, a, 120.0) || near(it.at, b, 120.0) } }
    fun planned(a: LonLat, b: LonLat): Boolean {
        val reach = maxOf(60.0, angle(a, b) * 111.2 * 0.25)
        return allHops.any { (f, t) -> (near(a, f, reach) && near(b, t, reach)) || (near(a, t, reach) && near(b, f, reach)) }
    }
    // There and back between the same airports is one bow, not two on top of each other (with their dashes
    // out of step that read as one thick line); both bow the same way, to the north.
    val drawnHops = hops.fold(mutableListOf<Pair<LonLat, LonLat>>()) { acc, (a, b) ->
        if (acc.none { (f, t) -> (near(a, f, 30.0) && near(b, t, 30.0)) || (near(a, t, 30.0) && near(b, f, 30.0)) }) acc += a to b
        acc
    }
    val bows = drawnHops.map { (a, b) -> flightArc(a, b) }.toMutableList()
    val real = mutableListOf<LonLat>()
    for ((user, lineColor, pieces) in lines) {
        val ground = mutableListOf<List<LonLat>>()
        for (piece in pieces) {
            var run = mutableListOf<LonLat>()
            piece.forEachIndexed { i, b ->
                val a = piece.getOrNull(i - 1)
                if (a != null) {
                    val km = angle(a, b) * 111.2
                    if (km > 400 || planned(a, b) && km > 150) {
                        if (run.size >= 2) ground += run
                        if (!planned(a, b) && on(user)) { if (km > 1800) bows += flightArc(a, b) else ground += listOf(a, b) }
                        run = mutableListOf()
                    }
                }
                run += b
            }
            if (run.size >= 2) ground += run
        }
        if (on(user)) real += pieces.flatten()
        userLine(style, user, lineColor, dark, ground, on(user))
    }
    // A line whose traveller left the list (another day) goes quiet too.
    for (layer in style.layers) {
        val id = layer.id
        if (id.startsWith("route-u-") && id.endsWith("-line")) {
            val user = id.removePrefix("route-u-").removeSuffix("-line")
            if (lines.none { it.first == user }) {
                (style.getSource("route-u-$user") as? GeoJsonSource)?.setGeoJson(FeatureCollection.fromFeatures(emptyList<Feature>()))
            }
        }
    }
    real += photos.mapNotNull { m -> if (m.lat != null && m.lon != null) m.lon to m.lat else null }

    // The plan, where nothing recorded it: from stop to stop (not a flight, not a line hidden by hand) and out to
    // each day trip and back. A leg still to come is dotted.
    val planned = mutableListOf<Feature>()
    val pts = if (trip.stops.isNotEmpty()) null else trip.stopPoints.takeIf { day == null }
    if (pts != null) {
        pts.zipWithNext().forEach { (a, b) -> if (!recorded(a, b, real)) planned += Feature.fromGeometry(lineOf(listOf(a, b))).apply { addBooleanProperty("future", trip.upcoming) } }
    } else {
        stops.forEachIndexed { i, s ->
            val prev = stops.getOrNull(i - 1) ?: return@forEachIndexed
            val hiddenNow = s.id?.let { state?.hiddenLegs?.get(it) } ?: s.hideLeg
            if (s.mode == Mode.Flight || hiddenNow || recorded(prev.at, s.at, real)) return@forEachIndexed
            val future = s.start?.isAfter(today) ?: trip.upcoming
            planned += Feature.fromGeometry(lineOf(listOf(prev.at, s.at))).apply { addBooleanProperty("future", future) }
        }
        for (s in stops) for (dt in s.dayTrips) {
            val at = dt.at ?: continue
            if (day != null && dt.day != null && dt.day != day) continue
            if (recorded(s.at, at, real)) continue
            planned += Feature.fromGeometry(lineOf(listOf(s.at, at))).apply { addBooleanProperty("future", dt.day?.isAfter(today) ?: trip.upcoming) }
        }
    }
    (style.getSource("planned") as? GeoJsonSource)?.setGeoJson(FeatureCollection.fromFeatures(planned))
    (style.getSource("flights") as? GeoJsonSource)?.setGeoJson(FeatureCollection.fromFeatures(bows.map { Feature.fromGeometry(lineOf(it)) }))

    // Stops and day trips, each with its id so a tap can find its label.
    val dots = mutableListOf<Feature>()
    val stopAt = if (pts != null) pts.map { "" to it } else stops.map { (it.id ?: "stop:${it.name}") to it.at }
    stopAt.forEach { (id, at) -> dots += Feature.fromGeometry(Point.fromLngLat(at.first, at.second)).apply { addStringProperty("id", id); addStringProperty("kind", "stop") } }
    if (pts == null) for (s in stops) for (dt in s.dayTrips) {
        val at = dt.at ?: continue
        if (day != null && dt.day != null && dt.day != day) continue
        dots += Feature.fromGeometry(Point.fromLngLat(at.first, at.second)).apply { addStringProperty("id", dt.id); addStringProperty("kind", "day") }
    }
    (style.getSource("stops") as? GeoJsonSource)?.setGeoJson(FeatureCollection.fromFeatures(dots))
    // Where a flight starts and ends, a small grey airport dot, as on the web, unless the city's own pin is
    // already there (within 55 km), so the bow never starts out of nowhere.
    val ends = bows.flatMap { listOfNotNull(it.firstOrNull(), it.lastOrNull()) }
        .distinctBy { "%.2f,%.2f".format(java.util.Locale.ROOT, it.first, it.second) }
        .filter { p -> stopAt.none { haversineKm(it.second, p) <= 55.0 } }
    (style.getSource("airports") as? GeoJsonSource)?.setGeoJson(FeatureCollection.fromFeatures(ends.map { Feature.fromGeometry(Point.fromLngLat(it.first, it.second)) }))
}

/**
 * One traveller's line, with the soft band under it that keeps it readable on busy streets. Made the first
 * time it is needed and kept: switching it off fades it out where it lies, switching it on fades it up.
 */
private fun userLine(style: Style, user: String, color: Int, dark: Boolean, ground: List<List<LonLat>>, on: Boolean) {
    val id = "route-u-$user"
    val data = FeatureCollection.fromFeatures(ground.map { Feature.fromGeometry(lineOf(it)) })
    val source = style.getSource(id) as? GeoJsonSource
    val fade = TransitionOptions(FADE_MS, 0)
    if (source == null) {
        style.addSource(GeoJsonSource(id, data))
        val halo = LineLayer("$id-halo", id).withProperties(
            lineColor(if (dark) AColor.BLACK else AColor.WHITE), lineWidth(7f), lineOpacity(0f),
            lineCap(Property.LINE_CAP_ROUND), lineJoin(Property.LINE_JOIN_ROUND),
        )
        val line = LineLayer("$id-line", id).withProperties(
            lineColor(color), lineWidth(3.5f), lineOpacity(0f), lineCap(Property.LINE_CAP_ROUND), lineJoin(Property.LINE_JOIN_ROUND),
        )
        halo.lineOpacityTransition = fade; line.lineOpacityTransition = fade
        // Under the flights and the dots, over the plan.
        style.addLayerBelow(halo, "flight-line")
        style.addLayerBelow(line, "flight-line")
    } else source.setGeoJson(data)
    (style.getLayer("$id-line") as? LineLayer)?.let { it.lineOpacityTransition = fade; it.setProperties(lineColor(color), lineOpacity(if (on) 1f else 0f)) }
    (style.getLayer("$id-halo") as? LineLayer)?.let { it.lineOpacityTransition = fade; it.setProperties(lineOpacity(if (on) 0.7f else 0f)) }
}

/** Your own position, as a phone's map draws it: a blue dot with a white rim and a soft pulse around it. */
@Composable
private fun SelfDot(map: org.maplibre.android.maps.MapLibreMap?, tick: Int, at: LonLat, onTap: (() -> Unit)?) {
    val m = map ?: return
    @Suppress("UNUSED_EXPRESSION") tick
    val p = m.projection.toScreenLocation(LatLng(at.second, at.first))
    val pulse = androidx.compose.animation.core.rememberInfiniteTransition(label = "self")
    val k by pulse.animateFloat(0f, 1f, androidx.compose.animation.core.infiniteRepeatable(androidx.compose.animation.core.tween<Float>(1800, easing = androidx.compose.animation.core.LinearOutSlowInEasing)), label = "pulse")
    val appear = remember { androidx.compose.animation.core.Animatable(0f) }
    val motion = androidx.compose.material3.MaterialTheme.motionScheme
    androidx.compose.runtime.LaunchedEffect(Unit) { appear.animateTo(1f, motion.defaultSpatialSpec()) }
    val blue = androidx.compose.ui.graphics.Color(0xFF3884FF)
    val size = 44.dp
    val half = with(LocalDensity.current) { (size / 2).toPx() }
    androidx.compose.foundation.layout.Box(
        Modifier.offset { androidx.compose.ui.unit.IntOffset((p.x - half).toInt(), (p.y - half).toInt()) }.size(size)
            .graphicsLayer { scaleX = appear.value; scaleY = appear.value }
            .then(if (onTap != null) Modifier.clip(androidx.compose.foundation.shape.CircleShape).clickable(onClick = onTap) else Modifier),
        contentAlignment = androidx.compose.ui.Alignment.Center,
    ) {
        androidx.compose.foundation.layout.Box(Modifier.size(size).graphicsLayer { val s = 0.35f + 0.65f * k; scaleX = s; scaleY = s; alpha = (1f - k) * 0.45f }.clip(androidx.compose.foundation.shape.CircleShape).background(blue))
        androidx.compose.foundation.layout.Box(Modifier.size(18.dp).clip(androidx.compose.foundation.shape.CircleShape).background(androidx.compose.ui.graphics.Color.White).padding(3.dp).clip(androidx.compose.foundation.shape.CircleShape).background(blue))
    }
}

/**
 * Where the companions are now, each as their own face on the spot of their latest position (centred on it,
 * so it never sits beside its point) with how long ago underneath. A new position glides there, so a face
 * never jumps between two polls.
 */
@Composable
private fun LiveFaces(map: org.maplibre.android.maps.MapLibreMap?, tick: Int, fixes: List<MapRemote.LiveFix>) {
    val m = map ?: return
    @Suppress("UNUSED_EXPRESSION") tick
    val density = LocalDensity.current
    val motion = androidx.compose.material3.MaterialTheme.motionScheme
    val cs = androidx.compose.material3.MaterialTheme.colorScheme
    // The ages tick on their own between polls.
    var now by remember { androidx.compose.runtime.mutableLongStateOf(System.currentTimeMillis()) }
    androidx.compose.runtime.LaunchedEffect(Unit) { while (true) { kotlinx.coroutines.delay(15_000); now = System.currentTimeMillis() } }
    fixes.forEach { fix ->
        androidx.compose.runtime.key(fix.userId) {
            val lat = remember { androidx.compose.animation.core.Animatable(fix.at.second.toFloat()) }
            val lng = remember { androidx.compose.animation.core.Animatable(fix.at.first.toFloat()) }
            androidx.compose.runtime.LaunchedEffect(fix.at) {
                kotlinx.coroutines.coroutineScope {
                    launch { lat.animateTo(fix.at.second.toFloat(), androidx.compose.animation.core.tween(1200)) }
                    launch { lng.animateTo(fix.at.first.toFloat(), androidx.compose.animation.core.tween(1200)) }
                }
            }
            val appear = remember { androidx.compose.animation.core.Animatable(0f) }
            androidx.compose.runtime.LaunchedEffect(Unit) { appear.animateTo(1f, motion.defaultSpatialSpec()) }
            val p = m.projection.toScreenLocation(LatLng(lat.value.toDouble(), lng.value.toDouble()))
            val face = 40.dp
            val half = with(density) { (face / 2).toPx() }
            val ring = personColor(fix.userId)
            androidx.compose.foundation.layout.Box(
                Modifier.offset { androidx.compose.ui.unit.IntOffset((p.x - half).toInt(), (p.y - half).toInt()) }.size(face)
                    .graphicsLayer { scaleX = appear.value; scaleY = appear.value; alpha = appear.value.coerceIn(0f, 1f) }
                    .clip(androidx.compose.foundation.shape.CircleShape).background(ring).padding(3.dp),
            ) {
                Avatar(fix.userId, fix.name, fix.hasAvatar, ring, Modifier.matchParentSize())
            }
            val mins = ((now - fix.time.toEpochMilli()) / 60_000).coerceAtLeast(0)
            val age = when { mins < 2 -> "nu"; mins < 60 -> "$mins min"; mins < 48 * 60 -> "${mins / 60} uur"; else -> "${mins / 1440} d" }
            androidx.compose.material3.Text(
                age, maxLines = 1,
                style = androidx.compose.ui.text.TextStyle(fontFamily = Outfit, fontWeight = androidx.compose.ui.text.font.FontWeight(700), fontSize = 10.5.sp, color = cs.onSurface),
                modifier = Modifier.offset { androidx.compose.ui.unit.IntOffset((p.x - with(density) { 18.dp.toPx() }).toInt(), (p.y + half - with(density) { 4.dp.toPx() }).toInt()) }
                    .graphicsLayer { alpha = appear.value.coerceIn(0f, 1f) }
                    .width(36.dp)
                    .clip(androidx.compose.foundation.shape.CircleShape).background(cs.surfaceContainerHighest).padding(vertical = 1.dp),
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }
    }
}


/** The label over a tapped stop: its name, when you were there, and a cross; it grows out of the dot and back in. */
@Composable
private fun StopLabelCard(map: org.maplibre.android.maps.MapLibreMap?, tick: Int, label: StopLabel?, onClose: () -> Unit) {
    val m = map ?: return
    @Suppress("UNUSED_EXPRESSION") tick
    // The last label stays drawn while it shrinks away.
    var last by remember { androidx.compose.runtime.mutableStateOf(label) }
    if (label != null) last = label
    val l = last ?: return
    val motion = androidx.compose.material3.MaterialTheme.motionScheme
    val k by androidx.compose.animation.core.animateFloatAsState(if (label != null) 1f else 0f, if (label != null) motion.fastSpatialSpec() else motion.fastEffectsSpec(), label = "stopLabel")
    if (k == 0f && label == null) return
    val cs = androidx.compose.material3.MaterialTheme.colorScheme
    val density = LocalDensity.current
    val p = m.projection.toScreenLocation(LatLng(l.at.second, l.at.first))
    var w by remember { androidx.compose.runtime.mutableIntStateOf(0) }
    var h by remember { androidx.compose.runtime.mutableIntStateOf(0) }
    val gap = with(density) { 14.dp.toPx() }
    androidx.compose.foundation.layout.Row(
        Modifier.offset { androidx.compose.ui.unit.IntOffset((p.x - w / 2f).toInt(), (p.y - gap - h).toInt()) }
            .onSizeChanged { w = it.width; h = it.height }
            .graphicsLayer { scaleX = 0.7f + 0.3f * k; scaleY = 0.7f + 0.3f * k; alpha = k; transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0.5f, 1f) }
            .widthIn(max = 240.dp)
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(18.dp)).background(cs.surfaceContainerHighest)
            .border(1.dp, cs.outlineVariant, androidx.compose.foundation.shape.RoundedCornerShape(18.dp))
            .padding(start = 14.dp, top = 8.dp, bottom = 8.dp, end = 4.dp),
        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
    ) {
        androidx.compose.foundation.layout.Column(Modifier.weight(1f, fill = false)) {
            androidx.compose.material3.Text(l.name, maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                style = androidx.compose.ui.text.TextStyle(fontFamily = Outfit, fontWeight = androidx.compose.ui.text.font.FontWeight(650), fontSize = 15.sp, color = cs.onSurface))
            if (l.when_.isNotBlank()) androidx.compose.material3.Text(l.when_, maxLines = 1,
                style = androidx.compose.ui.text.TextStyle(fontFamily = Inter, fontWeight = androidx.compose.ui.text.font.FontWeight(500), fontSize = 12.5.sp, color = cs.onSurfaceVariant))
        }
        androidx.compose.foundation.layout.Box(
            Modifier.size(36.dp).clip(androidx.compose.foundation.shape.CircleShape).clickable(onClick = onClose),
            contentAlignment = androidx.compose.ui.Alignment.Center,
        ) { LineIcon(listOf(P("M18 6 6 18"), P("m6 6 12 12")), cs.onSurfaceVariant, size = 16.dp, stroke = 2.2f) }
    }
}


/**
 * A flight as the web app draws it (lib/arc.ts): the great circle, bowed away
 * from the ground in Mercator space, more for a long flight than a short hop,
 * always to the north so two flights along one corridor never cross.
 */
fun flightArc(from: LonLat, to: LonLat, steps: Int = 48, lift: Double = 1.0): List<LonLat> {
    val rad = Math.PI / 180
    val deg = 180 / Math.PI
    val lon1 = from.first * rad; val lat1 = from.second * rad
    val lon2 = to.first * rad; val lat2 = to.second * rad
    val d = 2 * asin(minOf(1.0, sqrt(sin((lat2 - lat1) / 2).let { it * it } + cos(lat1) * cos(lat2) * sin((lon2 - lon1) / 2).let { it * it })))
    if (d < 1e-9) return listOf(from, to)
    val base = (0..steps).map { i ->
        val f = i.toDouble() / steps
        val a = sin((1 - f) * d) / sin(d)
        val b = sin(f * d) / sin(d)
        val x = a * cos(lat1) * cos(lon1) + b * cos(lat2) * cos(lon2)
        val y = a * cos(lat1) * sin(lon1) + b * cos(lat2) * sin(lon2)
        val z = a * sin(lat1) + b * sin(lat2)
        doubleArrayOf(atan2(y, x) * deg, atan2(z, sqrt(x * x + y * y)) * deg)
    }
    // Unwrapped, or a flight over the Pacific runs back across the whole map.
    for (i in 1 until base.size) {
        while (base[i][0] - base[i - 1][0] > 180) base[i][0] -= 360.0
        while (base[i][0] - base[i - 1][0] < -180) base[i][0] += 360.0
    }
    fun mercY(lat: Double) = ln(tan(Math.PI / 4 + (lat.coerceIn(-85.0, 85.0) * rad) / 2)) * deg
    fun unmercY(y: Double) = (2 * atan(exp(y * rad)) - Math.PI / 2) * deg
    val ax = base[0][0]; val ay = mercY(base[0][1])
    val bx = base[steps][0]; val by = mercY(base[steps][1])
    val chord = hypot(bx - ax, by - ay).takeIf { it > 0 } ?: 1.0
    var nx = -(by - ay) / chord
    var ny = (bx - ax) / chord
    if (ny < 0) { nx = -nx; ny = -ny }
    val bow = lift * chord * (0.06 + 0.16 * minOf(1.0, (d * deg) / 70))
    return base.mapIndexed { i, (lng, lat) ->
        val k = bow * sin(Math.PI * i / steps)
        (lng + nx * k) to unmercY(mercY(lat) + ny * k)
    }
}

/** Distance over the earth's surface in kilometres. */
private fun haversineKm(a: LonLat, b: LonLat): Double {
    val r = 6371.0
    val dLat = Math.toRadians(b.second - a.second); val dLon = Math.toRadians(b.first - a.first)
    val h = kotlin.math.sin(dLat / 2).let { it * it } + kotlin.math.cos(Math.toRadians(a.second)) * kotlin.math.cos(Math.toRadians(b.second)) * kotlin.math.sin(dLon / 2).let { it * it }
    return 2 * r * kotlin.math.asin(kotlin.math.sqrt(h))
}


/**
 * Your photos on the map, as on the web: round thumbnails where they were taken, grouped on a grid that
 * gets finer as you zoom in (the level rounded, so a pan never regroups them), with a count on a group. A
 * single photo opens it; a group zooms in to split it. Each sits on its first photo's own spot.
 */
@androidx.compose.runtime.Composable
private fun PhotoMarkers(map: org.maplibre.android.maps.MapLibreMap?, tick: Int, photos: List<Media>, trip: Trip, onPhoto: (Media) -> Unit, onCluster: ((Media) -> Unit)? = null) {
    val m = map ?: return
    val located = androidx.compose.runtime.remember(photos) { photos.filter { it.lat != null && it.lon != null && !it.video } }
    if (located.isEmpty()) return
    @Suppress("UNUSED_EXPRESSION") tick
    // The grouping only changes on a whole zoom step, so it is worked out once per step, not on every frame;
    // a frame only moves the markers to their places on screen.
    val level = kotlin.math.round(m.cameraPosition.zoom).toInt()
    val clusters = androidx.compose.runtime.remember(located, level) {
        val cell = 40.0 / Math.pow(2.0, level.toDouble())
        located.groupBy { "${kotlin.math.round(it.lat!! / cell)}:${kotlin.math.round(it.lon!! / cell)}" }.toList()
    }
    // A group that splits or merges does so softly: the new markers grow out of the spot of the group they came
    // from (or towards the one they join) instead of blinking in and out.
    val previous = androidx.compose.runtime.remember { mutableMapOf<String, LonLat>() }
    val density = androidx.compose.ui.platform.LocalDensity.current
    val cs = androidx.compose.material3.MaterialTheme.colorScheme
    val ring = legibleColor(trip.color, cs.background.luminance() < 0.5f)
    val motion = androidx.compose.material3.MaterialTheme.motionScheme
    clusters.forEach { (key, items) ->
        val first = items.first()
        val target = first.lon!! to first.lat!!
        androidx.compose.runtime.key(key) {
            // Where it starts: the nearest marker of the last grouping, so it slides out of (or into) it.
            val from = androidx.compose.runtime.remember { previous.values.minByOrNull { (it.first - target.first) * (it.first - target.first) + (it.second - target.second) * (it.second - target.second) } ?: target }
            val t = androidx.compose.runtime.remember { androidx.compose.animation.core.Animatable(if (from == target) 1f else 0f) }
            androidx.compose.runtime.LaunchedEffect(Unit) { t.animateTo(1f, motion.defaultSpatialSpec()) }
            val k = t.value
            val at = org.maplibre.android.geometry.LatLng(from.second + (target.second - from.second) * k, from.first + (target.first - from.first) * k)
            val p = m.projection.toScreenLocation(at)
            val size = 44.dp
            val half = with(density) { (size / 2).toPx() }
            androidx.compose.foundation.layout.Box(
                Modifier.offset { androidx.compose.ui.unit.IntOffset((p.x - half).toInt(), (p.y - half).toInt()) }.size(size)
                    .graphicsLayer { val sc = 0.6f + 0.4f * k; scaleX = sc; scaleY = sc; alpha = (0.3f + 0.7f * k).coerceIn(0f, 1f) }
                    .clip(androidx.compose.foundation.shape.CircleShape).background(cs.surfaceContainerHigh)
                    .border(3.dp, ring, androidx.compose.foundation.shape.CircleShape)
                    .clickable {
                        if (items.size == 1) onPhoto(first)
                        else {
                            m.animateCamera(org.maplibre.android.camera.CameraUpdateFactory.newLatLngZoom(org.maplibre.android.geometry.LatLng(first.lat, first.lon), (m.cameraPosition.zoom + 2.5).coerceAtMost(16.0)), 450)
                            onCluster?.invoke(first)
                        }
                    },
            ) {
                RemotePhoto(first.id, Modifier.matchParentSize())
            }
            if (items.size > 1) androidx.compose.material3.Text(
                if (items.size > 99) "99+" else "${items.size}",
                style = androidx.compose.ui.text.TextStyle(fontFamily = Outfit, fontWeight = androidx.compose.ui.text.font.FontWeight(700), fontSize = 11.sp, color = cs.onPrimary),
                modifier = Modifier.offset { androidx.compose.ui.unit.IntOffset((p.x + half * 0.45f).toInt(), (p.y - half * 1.15f).toInt()) }
                    .graphicsLayer { alpha = k }
                    .clip(androidx.compose.foundation.shape.CircleShape).background(ring).padding(horizontal = 6.dp, vertical = 1.dp),
            )
        }
    }
    androidx.compose.runtime.SideEffect {
        previous.clear()
        clusters.forEach { (key, items) -> previous[key] = items.first().lon!! to items.first().lat!! }
    }
}

/** Place names in Dutch where the map knows them (name:nl), else the Latin spelling, else the local name. */
fun dutchLabels(style: Style) {
    for (layer in style.layers) {
        if (layer !is org.maplibre.android.style.layers.SymbolLayer) continue
        val field = runCatching { layer.textField.expression?.toString() ?: layer.textField.value?.toString() }.getOrNull() ?: continue
        if (!field.contains("name")) continue
        layer.setProperties(org.maplibre.android.style.layers.PropertyFactory.textField(
            org.maplibre.android.style.expressions.Expression.coalesce(
                org.maplibre.android.style.expressions.Expression.get("name:nl"),
                org.maplibre.android.style.expressions.Expression.get("name:latin"),
                org.maplibre.android.style.expressions.Expression.get("name"),
            ),
        ))
    }
}
