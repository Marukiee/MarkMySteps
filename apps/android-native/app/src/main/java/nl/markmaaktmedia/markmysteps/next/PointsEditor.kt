package nl.markmaaktmedia.markmysteps.next

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.launch
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import androidx.compose.ui.res.stringResource

/*
 * The raw points of one day of your own route, on a map of their own, as the web's TrackPointsEditor: drag a
 * point to where you really were, tap the map to add one (its time falls between its neighbours), or pick one
 * to see when and how it was recorded and delete it. Opened from your own dot on the trip map and from
 * Instellingen › Voorkeuren › Route-tracking. Every change goes through Api.send (so test mode holds it).
 */

/** The blue of the raw track, as on the web. */
private const val TrackBlue = 0xFF3884FF.toInt()

/** A MapLibre view that lives as long as its screen, with the app's look (no logo, the theme's empty colour). */
@Composable
fun rememberMapView(dark: Boolean): MapView {
    val context = LocalContext.current
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    val view = remember {
        org.maplibre.android.MapLibre.getInstance(context)
        MapView(
            context,
            org.maplibre.android.maps.MapLibreMapOptions.createFromAttributes(context).textureMode(true).attributionEnabled(false).logoEnabled(false)
                .foregroundLoadColor(if (dark) 0xFF14181D.toInt() else 0xFFF3ECE2.toInt()),
        ).apply { onCreate(null) }
    }
    DisposableEffect(lifecycle, view) {
        val observer = androidx.lifecycle.LifecycleEventObserver { _, e ->
            when (e) {
                androidx.lifecycle.Lifecycle.Event.ON_START -> view.onStart()
                androidx.lifecycle.Lifecycle.Event.ON_RESUME -> view.onResume()
                androidx.lifecycle.Lifecycle.Event.ON_PAUSE -> view.onPause()
                androidx.lifecycle.Lifecycle.Event.ON_STOP -> view.onStop()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        if (lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED)) view.onStart()
        if (lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)) view.onResume()
        onDispose { lifecycle.removeObserver(observer); view.onPause(); view.onStop(); view.onDestroy() }
    }
    return view
}

private fun lineOf(points: List<LonLat>) = LineString.fromLngLats(points.map { Point.fromLngLat(it.first, it.second) })

/** Frames [points] in [m]: one point at street level, more with room around them. */
private fun frame(m: org.maplibre.android.maps.MapLibreMap, points: List<LonLat>, padPx: Int, maxZoom: Double, animate: Boolean) {
    if (points.isEmpty()) return
    val update = if (points.size == 1 || points.all { angle(it, points[0]) < 0.0005 }) CameraUpdateFactory.newLatLngZoom(LatLng(points[0].second, points[0].first), minOf(maxZoom, 14.0))
    else CameraUpdateFactory.newLatLngBounds(LatLngBounds.Builder().apply { points.forEach { include(LatLng(it.second, it.first)) } }.build(), padPx)
    if (animate) m.animateCamera(update, 600) else m.moveCamera(update)
    if (m.cameraPosition.zoom > maxZoom) m.moveCamera(CameraUpdateFactory.zoomTo(maxZoom))
}

/**
 * A plain map in the chosen style: framed around [around], with an accent pin at [pin] and a blue line along
 * [line]. [onTap] null makes it a still picture (the last position in Instellingen).
 */
@Composable
fun PlainMap(dark: Boolean, modifier: Modifier, around: List<LonLat>, pin: LonLat? = null, line: List<LonLat> = emptyList(), onTap: ((LonLat) -> Unit)? = null, zoom: Double = 13.0) {
    val view = rememberMapView(dark)
    val accent = MaterialTheme.colorScheme.primary.toArgb()
    var style by remember { mutableStateOf<Style?>(null) }
    var map by remember { mutableStateOf<org.maplibre.android.maps.MapLibreMap?>(null) }
    val tap = rememberUpdatedState(onTap)
    val density = androidx.compose.ui.platform.LocalDensity.current.density
    AndroidView(factory = {
        view.getMapAsync { m ->
            map = m
            m.uiSettings.isRotateGesturesEnabled = false
            m.uiSettings.isTiltGesturesEnabled = false
            m.uiSettings.isCompassEnabled = false
            if (onTap == null) m.uiSettings.setAllGesturesEnabled(false)
            m.addOnMapClickListener { ll -> tap.value?.invoke(ll.longitude to ll.latitude); tap.value != null }
            m.setStyle(mapStyleBuilder(dark)) { st ->
                dutchLabels(st)
                st.addSource(GeoJsonSource("plain-line", FeatureCollection.fromFeatures(emptyList<Feature>())))
                st.addSource(GeoJsonSource("plain-pin", FeatureCollection.fromFeatures(emptyList<Feature>())))
                st.addLayer(LineLayer("plain-line", "plain-line").withProperties(
                    PropertyFactory.lineColor(TrackBlue), PropertyFactory.lineWidth(2.5f), PropertyFactory.lineOpacity(0.9f),
                    PropertyFactory.lineCap(Property.LINE_CAP_ROUND), PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
                ))
                st.addLayer(CircleLayer("plain-pin", "plain-pin").withProperties(
                    PropertyFactory.circleRadius(8f), PropertyFactory.circleColor(accent),
                    PropertyFactory.circleStrokeColor(android.graphics.Color.WHITE), PropertyFactory.circleStrokeWidth(3f),
                ))
                if (around.size > 1) frame(m, around, (40 * density).toInt(), zoom, animate = false)
                else around.firstOrNull()?.let { m.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(it.second, it.first), if (onTap == null) zoom else 5.0)) }
                style = st
            }
        }
        view
    }, modifier = modifier)
    LaunchedEffect(style, pin, line) {
        val st = style ?: return@LaunchedEffect
        (st.getSource("plain-pin") as? GeoJsonSource)?.setGeoJson(FeatureCollection.fromFeatures(listOfNotNull(pin?.let { Feature.fromGeometry(Point.fromLngLat(it.first, it.second)) })))
        (st.getSource("plain-line") as? GeoJsonSource)?.setGeoJson(FeatureCollection.fromFeatures(if (line.size >= 2) listOf(Feature.fromGeometry(lineOf(line))) else emptyList()))
        // A still map follows a new position softly.
        if (onTap == null && pin != null) map?.animateCamera(CameraUpdateFactory.newLatLng(LatLng(pin.second, pin.first)), 600)
    }
}

/**
 * A layer over the whole screen, over everything (it is its own window): it rises in, and leaves the same calm
 * way by its cross, back, or the back gesture, which moves it down with the finger.
 */
@Composable
fun FullScreenLayer(onDismiss: () -> Unit, content: @Composable (close: () -> Unit) -> Unit) {
    val scope = rememberCoroutineScope()
    val shown = remember { Animatable(0f) }
    var back by remember { mutableStateOf(0f) }
    var closing by remember { mutableStateOf(false) }
    val motion = MaterialTheme.motionScheme
    LaunchedEffect(Unit) { shown.animateTo(1f, motion.defaultSpatialSpec()) }
    val close: () -> Unit = {
        if (!closing) {
            closing = true
            scope.launch { shown.animateTo(0f, motion.fastEffectsSpec()); onDismiss() }
        }
    }
    Dialog(onDismissRequest = close, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        // Its own window: the clock and icons take the page's light or dark, so they never vanish on it.
        val dialogView = androidx.compose.ui.platform.LocalView.current
        val darkPage = MaterialTheme.colorScheme.background.luminance() < 0.5f
        androidx.compose.runtime.SideEffect {
            (dialogView.parent as? androidx.compose.ui.window.DialogWindowProvider)?.window?.let { w ->
                androidx.core.view.WindowCompat.getInsetsController(w, dialogView).apply { isAppearanceLightStatusBars = !darkPage; isAppearanceLightNavigationBars = !darkPage }
            }
        }
        androidx.activity.compose.PredictiveBackHandler { events ->
            try { events.collect { back = it.progress }; back = 0f; close() } catch (e: kotlin.coroutines.cancellation.CancellationException) { back = 0f; throw e }
        }
        val cs = MaterialTheme.colorScheme
        Box(
            Modifier.fillMaxSize().graphicsLayer {
                alpha = shown.value.coerceIn(0f, 1f)
                translationY = (1f - shown.value) * size.height * 0.06f + back * size.height * 0.08f
                val s = 1f - 0.06f * back
                scaleX = s; scaleY = s
                shape = RoundedCornerShape((28 * back).dp.toPx()); clip = back > 0f
            }.background(cs.background),
        ) { content(close) }
    }
}

private fun sourceName(source: String): String? = when (source) {
    "TRACKED" -> "GPS"
    "MANUAL" -> Lang.text(R.string.points_manual)
    "ROUTE_FILL" -> Lang.text(R.string.points_road)
    "IMPORTED" -> Lang.text(R.string.points_import)
    else -> null
}

private fun clock(t: Instant): String = t.atZone(ZoneId.systemDefault()).toLocalTime().let { "%02d:%02d".format(it.hour, it.minute) }

/** The editor itself, over the whole screen. */
@Composable
fun PointsEditor(tripId: String, onClose: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val dark = cs.background.luminance() < 0.5f
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val today = remember { LocalDate.now() }
    var day by remember { mutableStateOf(today) }
    var days by remember { mutableStateOf<List<Pair<LocalDate, Int>>>(emptyList()) }
    var points by remember { mutableStateOf<List<MapRemote.TrackPoint>?>(null) }
    var selected by remember { mutableStateOf<MapRemote.TrackPoint?>(null) }
    var adding by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    suspend fun load(which: LocalDate) {
        runCatching { MapRemote.dayPoints(tripId, which) }.onSuccess { points = it; error = null }.onFailure { error = it.message ?: Lang.text(R.string.points_load_failed) }
    }
    LaunchedEffect(Unit) {
        runCatching { MapRemote.pointDays(tripId) }.onSuccess { list ->
            days = list.sortedByDescending { it.first }
            // Nothing today: open on the last day that has points.
            if (list.isNotEmpty() && list.none { it.first == today }) day = list.maxOf { it.first }
        }
    }
    LaunchedEffect(day) { selected = null; points = null; load(day) }
    LaunchedEffect(error) { if (error != null) { kotlinx.coroutines.delay(4000); error = null } }

    fun move(p: MapRemote.TrackPoint, at: LonLat) {
        points = points?.map { if (it.id == p.id) it.copy(at = at) else it }
        scope.launch { runCatching { MapRemote.movePoint(tripId, p.id, at) }.onFailure { error = it.message ?: Lang.text(R.string.points_move_failed); load(day) } }
    }
    fun insert(at: LonLat) {
        val list = points.orEmpty()
        // Its time falls between the two points of the stretch it is nearest to, so it lands in its place on the line.
        val time = when {
            list.isEmpty() -> day.atTime(12, 0).atZone(ZoneId.systemDefault()).toInstant()
            list.size == 1 -> list[0].time.plusSeconds(60)
            else -> {
                var best = 1; var bestD = Double.MAX_VALUE
                for (i in 1 until list.size) {
                    val a = list[i - 1].at; val b = list[i].at
                    val dx = b.first - a.first; val dy = b.second - a.second
                    val len2 = dx * dx + dy * dy
                    val f = if (len2 == 0.0) 0.0 else (((at.first - a.first) * dx + (at.second - a.second) * dy) / len2).coerceIn(0.0, 1.0)
                    val d = kotlin.math.hypot(at.first - (a.first + f * dx), at.second - (a.second + f * dy))
                    if (d < bestD) { bestD = d; best = i }
                }
                Instant.ofEpochMilli((list[best - 1].time.toEpochMilli() + list[best].time.toEpochMilli()) / 2)
            }
        }
        busy = true
        scope.launch {
            runCatching { MapRemote.addPoint(tripId, at, time) }.onSuccess { haptics(Haptic.Confirm); load(day); adding = false }.onFailure { error = it.message ?: Lang.text(R.string.points_add_failed) }
            busy = false
        }
    }
    fun remove() {
        val p = selected ?: return
        busy = true
        scope.launch {
            runCatching { MapRemote.deletePoint(tripId, p.id) }.onSuccess { selected = null; load(day) }.onFailure { error = it.message ?: Lang.text(R.string.points_remove_failed) }
            busy = false
        }
    }

    FullScreenLayer(onClose) { close ->
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.statusBarsPadding().padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(48.dp).clip(CircleShape).background(cs.surfaceContainerHighest).dip { close() }, contentAlignment = Alignment.Center) {
                    LineIcon(listOf(P("M18 6 6 18"), P("m6 6 12 12")), cs.onSurface, size = 22.dp, stroke = 2.2f)
                }
                Column(Modifier.padding(start = 14.dp)) {
                    Text(if (day == today) stringResource(R.string.points_today) else stringResource(R.string.points_of_day, shortDay(day)), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 20.sp, color = cs.onSurface))
                    val n = points?.size
                    Text(if (n == null) " " else if (n == 1) stringResource(R.string.points_one) else stringResource(R.string.points_many, n), style = ValueStyle.copy(color = cs.onSurfaceVariant))
                }
            }
            // The days with points, today first; the row runs to the screen's edge.
            val options = (if (days.any { it.first == today }) days else listOf(today to 0) + days)
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                options.forEach { (d, count) ->
                    val on = d == day
                    val bg by animateColorAsState(if (on) cs.primary else cs.surfaceContainerHigh, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "dayChip")
                    val fg by animateColorAsState(if (on) cs.onPrimary else cs.onSurface, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "dayChipFg")
                    Row(Modifier.height(40.dp).clip(CircleShape).background(bg).dip { if (!on) haptics(Haptic.Tick); day = d }.padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(if (d == today) stringResource(R.string.points_today_short) else "%02d-%02d".format(d.dayOfMonth, d.monthValue), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = fg))
                        Text("$count", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 12.sp, color = fg.copy(alpha = 0.75f)), modifier = Modifier.padding(start = 6.dp))
                    }
                }
            }
            Box(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 12.dp).clip(RoundedCornerShape(28.dp))) {
                EditorMap(dark, points.orEmpty(), points != null, day, selected?.id, adding, onSelect = { selected = it; if (it != null) haptics(Haptic.Tap) }, onMove = { p, at -> haptics(Haptic.GestureEnd); move(p, at) }, onAdd = { insert(it) })
                androidx.compose.animation.AnimatedVisibility(adding, modifier = Modifier.align(Alignment.TopCenter).padding(12.dp), enter = fadeIn() + slideInVertically { -it }, exit = fadeOut() + slideOutVertically { -it }) {
                    Text(stringResource(R.string.points_tap_to_add), style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(550), fontSize = 13.5.sp, color = cs.inverseOnSurface),
                        modifier = Modifier.clip(CircleShape).background(cs.inverseSurface).padding(horizontal = 16.dp, vertical = 10.dp))
                }
                MapNote(error, Modifier.align(Alignment.BottomCenter).padding(12.dp))
            }
            // The bar under the map: what a tap does now and the switch for adding, or the chosen point.
            androidx.compose.animation.AnimatedContent(selected, label = "teBar", modifier = Modifier.navigationBarsPadding().padding(16.dp)) { sel ->
                if (sel == null) Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    androidx.compose.animation.Crossfade(adding, label = "legend") { a ->
                        Hint(if (a) stringResource(R.string.points_tap_where) else stringResource(R.string.points_drag_hint), Modifier.padding(horizontal = 4.dp))
                    }
                    if (adding) SoftButton(stringResource(R.string.points_done), { adding = false }, Modifier.fillMaxWidth(), icon = Glyphs.check)
                    else MainButton(stringResource(R.string.points_add), { haptics(Haptic.Tap); adding = true; selected = null }, Modifier.fillMaxWidth(), icon = Glyphs.plus, enabled = !busy)
                } else Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(cs.surfaceContainerLow).padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(clock(sel.time), style = TitleStyle.copy(color = cs.onSurface))
                        Text((sourceName(sel.source) ?: sel.source) + (sel.accuracy?.let { " · ±${it.toInt()} m" } ?: ""), style = ValueStyle.copy(color = cs.onSurfaceVariant))
                    }
                    SoftButton(stringResource(R.string.common_close), { selected = null })
                    Spacer(Modifier.width(8.dp))
                    MainButton(stringResource(R.string.home_delete), { remove() }, icon = Glyphs.trash, danger = true, busy = busy)
                }
            }
        }
    }
}

/**
 * The map of the editor. MapLibre has no draggable markers, so the points are a circle layer and the finger is
 * read on the map view itself: a press near a point takes that point (the map does not move), a drag moves it,
 * letting go saves it; a press elsewhere is the map's own.
 */
@Composable
private fun EditorMap(
    dark: Boolean, points: List<MapRemote.TrackPoint>, loaded: Boolean, day: LocalDate, selectedId: String?, adding: Boolean,
    onSelect: (MapRemote.TrackPoint?) -> Unit, onMove: (MapRemote.TrackPoint, LonLat) -> Unit, onAdd: (LonLat) -> Unit,
) {
    val view = rememberMapView(dark)
    val density = androidx.compose.ui.platform.LocalDensity.current.density
    var style by remember { mutableStateOf<Style?>(null) }
    var map by remember { mutableStateOf<org.maplibre.android.maps.MapLibreMap?>(null) }
    val now = rememberUpdatedState(Triple(points, adding, Triple(onSelect, onMove, onAdd)))
    // The point under the finger and where it is now, while it is dragged.
    val drag = remember { arrayOfNulls<Any>(3) }
    var framedDay by remember { mutableStateOf<LocalDate?>(null) }
    fun data(list: List<MapRemote.TrackPoint>, sel: String?): Pair<FeatureCollection, FeatureCollection> {
        val line = FeatureCollection.fromFeatures(if (list.size >= 2) listOf(Feature.fromGeometry(lineOf(list.map { it.at }))) else emptyList())
        val dots = FeatureCollection.fromFeatures(list.mapIndexed { i, p ->
            Feature.fromGeometry(Point.fromLngLat(p.at.first, p.at.second)).apply {
                addStringProperty("id", p.id); addStringProperty("source", p.source)
                addStringProperty("end", if (i == 0) "first" else if (i == list.lastIndex) "last" else "")
                addBooleanProperty("selected", p.id == sel)
            }
        })
        return line to dots
    }
    AndroidView(factory = {
        view.getMapAsync { m ->
            map = m
            m.uiSettings.isRotateGesturesEnabled = false
            m.uiSettings.isTiltGesturesEnabled = false
            m.uiSettings.isCompassEnabled = false
            m.addOnMapClickListener { ll ->
                val (_, add, calls) = now.value
                if (add) calls.third(ll.longitude to ll.latitude) else calls.first(null)
                true
            }
            m.setStyle(mapStyleBuilder(dark)) { st ->
                dutchLabels(st)
                st.addSource(GeoJsonSource("te-line", FeatureCollection.fromFeatures(emptyList<Feature>())))
                st.addSource(GeoJsonSource("te-dots", FeatureCollection.fromFeatures(emptyList<Feature>())))
                st.addLayer(LineLayer("te-line", "te-line").withProperties(
                    PropertyFactory.lineColor(TrackBlue), PropertyFactory.lineWidth(3f),
                    PropertyFactory.lineCap(Property.LINE_CAP_ROUND), PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
                ))
                val fill = Expression.match(
                    Expression.get("source"), Expression.color(TrackBlue),
                    Expression.stop("MANUAL", Expression.color(0xFFE8613C.toInt())),
                    Expression.stop("ROUTE_FILL", Expression.color(0xFF7A5BD6.toInt())),
                    Expression.stop("IMPORTED", Expression.color(0xFF2BB6A8.toInt())),
                )
                st.addLayer(CircleLayer("te-dots", "te-dots").withProperties(
                    PropertyFactory.circleRadius(Expression.switchCase(Expression.eq(Expression.get("selected"), Expression.literal(true)), Expression.literal(10f), Expression.literal(6.5f))),
                    PropertyFactory.circleColor(fill),
                    PropertyFactory.circleStrokeColor(Expression.match(Expression.get("end"), Expression.color(android.graphics.Color.WHITE),
                        Expression.stop("first", Expression.color(0xFF2BB673.toInt())), Expression.stop("last", Expression.color(0xFFE34B4B.toInt())))),
                    PropertyFactory.circleStrokeWidth(Expression.match(Expression.get("end"), Expression.literal(2f), Expression.stop("first", Expression.literal(3.5f)), Expression.stop("last", Expression.literal(3.5f)))),
                ))
                style = st
            }
        }
        // A press near a point takes it; anywhere else the map gets the finger as usual.
        view.setOnTouchListener { v, e ->
            val m = map ?: return@setOnTouchListener false
            val list = now.value.first
            when (e.actionMasked) {
                android.view.MotionEvent.ACTION_DOWN -> {
                    v.parent?.requestDisallowInterceptTouchEvent(true)
                    if (now.value.second) return@setOnTouchListener false
                    val reach = 24 * density
                    val hit = list.minByOrNull { p -> val s = m.projection.toScreenLocation(LatLng(p.at.second, p.at.first)); kotlin.math.hypot((s.x - e.x).toDouble(), (s.y - e.y).toDouble()) }
                        ?.takeIf { p -> val s = m.projection.toScreenLocation(LatLng(p.at.second, p.at.first)); kotlin.math.hypot((s.x - e.x).toDouble(), (s.y - e.y).toDouble()) <= reach }
                    if (hit == null) return@setOnTouchListener false
                    drag[0] = hit; drag[1] = null; drag[2] = floatArrayOf(e.x, e.y)
                    true
                }
                android.view.MotionEvent.ACTION_MOVE -> {
                    val p = drag[0] as? MapRemote.TrackPoint ?: return@setOnTouchListener false
                    val start = drag[2] as FloatArray
                    if (drag[1] == null && kotlin.math.hypot((e.x - start[0]).toDouble(), (e.y - start[1]).toDouble()) < 8 * density) return@setOnTouchListener true
                    val ll = m.projection.fromScreenLocation(android.graphics.PointF(e.x, e.y))
                    val at = ll.longitude to ll.latitude
                    drag[1] = at
                    // The line and the point follow the finger at once.
                    val moved = list.map { if (it.id == p.id) it.copy(at = at) else it }
                    val (line, dots) = data(moved, p.id)
                    (style?.getSource("te-line") as? GeoJsonSource)?.setGeoJson(line)
                    (style?.getSource("te-dots") as? GeoJsonSource)?.setGeoJson(dots)
                    true
                }
                android.view.MotionEvent.ACTION_UP, android.view.MotionEvent.ACTION_CANCEL -> {
                    val p = drag[0] as? MapRemote.TrackPoint ?: return@setOnTouchListener false
                    val at = drag[1] as? LonLat
                    drag[0] = null; drag[1] = null
                    val calls = now.value.third
                    if (e.actionMasked == android.view.MotionEvent.ACTION_UP) { if (at != null) calls.second(p, at) else calls.first(p) }
                    true
                }
                else -> drag[0] != null
            }
        }
        view
    }, modifier = Modifier.fillMaxSize())
    LaunchedEffect(style, points, selectedId, loaded) {
        val st = style ?: return@LaunchedEffect
        val (line, dots) = data(points, selectedId)
        (st.getSource("te-line") as? GeoJsonSource)?.setGeoJson(line)
        (st.getSource("te-dots") as? GeoJsonSource)?.setGeoJson(dots)
        val m = map ?: return@LaunchedEffect
        // A camera worked out before the view has its size lands nowhere: wait for the layout first.
        while (view.width == 0 || view.height == 0) kotlinx.coroutines.delay(16)
        // Framed once per day, not after every drag; the first day at once, a later one with a glide.
        if (points.isNotEmpty() && framedDay != day) { val first = framedDay == null; framedDay = day; frame(m, points.map { it.at }, (60 * density).toInt(), 15.0, animate = !first) }
        else if (loaded && points.isEmpty() && framedDay != day) {
            framedDay = day
            (Tracker.lastFix?.let { it.first to it.second })?.let { m.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(it.second, it.first), 12.0)) }
        }
    }
}
