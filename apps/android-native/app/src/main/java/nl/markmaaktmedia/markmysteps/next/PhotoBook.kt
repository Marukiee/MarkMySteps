package nl.markmaaktmedia.markmysteps.next

import android.app.Activity
import android.content.pm.ActivityInfo
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PagerState
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LinearWavyProgressIndicator
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.toShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.absoluteValue
import kotlin.math.min

/*
 * The photo book, natively: an A4 book (the shape the web app prints) that
 * you leaf through page by page. A cover, the route on the globe with the
 * stops, then a chapter per day: a full-bleed opener when the day's best
 * photo has the page's shape, otherwise a heading with the first photos, then
 * pages laid out to the shape of each photo (BookLayout.kt), and an end page.
 * Which photos go in is decided in PhotoPick.kt. A tap on a photo opens it
 * full screen, in HDR when the photo is an Ultra HDR one.
 */

const val PAGE_ASPECT = 210f / 297f

// The page's margins and folio, as fractions of the page width.
private const val SIDE = 0.07f
private const val TOP = 0.075f
private const val FOOT = 0.1f
private const val HEADER = 0.21f
private val PAGE_H = 1f / PAGE_ASPECT
private val INNER_W = 1f - 2 * SIDE
private val INNER_H = PAGE_H - TOP - FOOT

val StopShapesBook = listOf(
    MaterialShapes.Cookie9Sided, MaterialShapes.Sunny, MaterialShapes.Clover4Leaf,
    MaterialShapes.Cookie6Sided, MaterialShapes.SoftBurst, MaterialShapes.Flower, MaterialShapes.Pentagon,
)

sealed interface Sheet {
    val key: String
    val day: BookDay? get() = null

    data object Cover : Sheet { override val key = "cover" }
    data object Route : Sheet { override val key = "route" }
    data class Opener(override val day: BookDay, val photo: Rated) : Sheet { override val key = "hero-${day.date}" }
    data class Photos(
        override val day: BookDay,
        val photos: List<Rated>,
        val layout: PageLayout,
        /** The first page of a day without an opener carries the day's heading. */
        val heading: Boolean,
    ) : Sheet { override val key = "p-${day.date}-${photos.first().photo.id}" }
    data object End : Sheet { override val key = "end" }
}

/** Turns the picked photos into pages. */
fun buildBook(picked: Picked): List<Sheet> {
    val sheets = mutableListOf<Sheet>(Sheet.Cover, Sheet.Route)
    val bodyAspect = INNER_W / INNER_H
    val headAspect = INNER_W / (INNER_H - HEADER)
    for (day in picked.days) {
        var rest = day.photos
        val hero = day.hero
        // A chapter opener when the day has enough photos and its best one fills a page well.
        val opener = hero != null && day.photos.size >= 4 && fitTo(hero.aspect, PAGE_ASPECT) >= 0.7f
        if (opener && hero != null) {
            sheets += Sheet.Opener(day, hero)
            rest = rest - hero
        } else if (rest.isNotEmpty()) {
            // The heading page takes one to three photos, whichever fits its shorter box best.
            val k = (1..min(3, rest.size)).maxBy { n ->
                arrange(rest.take(n).map { it.aspect }, headAspect).score + floatArrayOf(0f, 0f, 0.12f, 0.08f)[n]
            }
            sheets += Sheet.Photos(day, rest.take(k), arrange(rest.take(k).map { it.aspect }, headAspect), heading = true)
            rest = rest.drop(k)
        }
        paginate(rest, { it.aspect }, bodyAspect).forEach { sheets += Sheet.Photos(day, it.photos, it.layout, heading = false) }
    }
    sheets += Sheet.End
    return sheets
}

/** Everything the pages need besides their own photos. */
data class BookContext(
    val trip: Trip,
    val picked: Picked,
    val dark: Boolean,
    val accent: Color,
    val onPhoto: (Rated) -> Unit,
)

@OptIn(ExperimentalSharedTransitionApi::class)
private val LocalShared = compositionLocalOf<Pair<SharedTransitionScope, AnimatedVisibilityScope>?> { null }

/** The same photo in the book and full screen, so it flies between them. */
@OptIn(ExperimentalSharedTransitionApi::class)
fun Modifier.sharedPhoto(id: String): Modifier = composed {
    val pair = LocalShared.current ?: return@composed this
    with(pair.first) {
        this@composed.sharedElement(rememberSharedContentState("photo-$id"), pair.second)
    }
}

/**
 * The state a book or summary screen loads: the trip's photos read and
 * picked. Picked again once the stops have come in, since they name the days.
 */
@Composable
fun rememberPicked(trip: Trip): Pair<Picked?, Reading> {
    val loader = LocalPhotoLoader.current
    val context = LocalContext.current.applicationContext
    val key = "${trip.id}/${trip.stops.size}"
    var picked by remember(key) { mutableStateOf<Picked?>(cachedPicks[key]) }
    var reading by remember(key) { mutableStateOf(Reading(0, 0)) }
    if (picked == null) LaunchedEffect(key) {
        val remote = trip.remoteId
        val media = if (remote != null) runCatching { serverMedia(trip) }.getOrDefault(emptyList()) else demoMedia(trip).first
        val start = if (remote != null) trip.start else demoStart(trip)
        val known = if (remote != null) LookStore.load(context, remote) else emptyMap()
        val todo = media.filter { it.id !in known }
        reading = Reading(0, todo.size)
        val (fresh, freshAspects) = readLooks(todo, if (remote != null) loader else null) { reading = it }
        val looks = known.mapValues { it.value.first } + fresh
        val aspects = known.mapValues { it.value.second } + freshAspects
        if (remote != null && fresh.isNotEmpty()) LookStore.save(context, remote, looks, aspects)
        val result = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) { pickPhotos(media, looks, aspects, trip.stops, start) }
        cachedPicks[key] = result
        picked = result
    }
    return picked to reading
}

private val cachedPicks = HashMap<String, Picked>()

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun PhotoBook(trip: Trip, dark: Boolean, onBack: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val (picked, reading) = rememberPicked(trip)
    val sheets = remember(picked) { picked?.let { buildBook(it) } ?: emptyList() }
    val pager = rememberPagerState { sheets.size }
    var open by remember { mutableStateOf<Rated?>(null) }
    val all = remember(picked) { picked?.days?.flatMap { d -> d.photos } ?: emptyList() }
    val scope = rememberCoroutineScope()
    val accent = legibleColor(trip.color, dark)

    BackHandler { if (open != null) open = null else onBack() }

    Box(Modifier.fillMaxSize().background(if (dark) Color.Black else cs.surfaceContainer)) {
        if (picked == null) {
            Reading(reading, "Foto's bekijken", Modifier.align(Alignment.Center))
        } else SharedTransitionLayout {
            val motion = MaterialTheme.motionScheme
            AnimatedContent(
                open,
                transitionSpec = { fadeIn(motion.defaultEffectsSpec()) togetherWith fadeOut(motion.fastEffectsSpec()) },
                label = "viewer",
            ) { photo ->
                CompositionLocalProvider(LocalShared provides (this@SharedTransitionLayout to this@AnimatedContent)) {
                    if (photo == null) {
                        BookPages(
                            sheets, pager,
                            BookContext(trip, picked, dark, accent, onPhoto = { open = it }),
                            onBack = onBack,
                        )
                    } else {
                        Viewer(all, photo, trip, onClose = { last ->
                            // Leaf to the page the photo is on, so it can fly back into place.
                            val page = sheets.indexOfFirst { s ->
                                (s is Sheet.Photos && last in s.photos) || (s is Sheet.Opener && s.photo == last)
                            }
                            if (page >= 0) scope.launch { pager.scrollToPage(page) }
                            open = null
                        })
                    }
                }
            }
        }
    }
}

@Composable
fun Reading(reading: Reading, label: String, modifier: Modifier = Modifier) {
    val cs = MaterialTheme.colorScheme
    Column(modifier.padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        LoadingIndicator(Modifier.size(72.dp), color = cs.primary)
        Text(label, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 20.sp, color = cs.onSurface), modifier = Modifier.padding(top = 18.dp))
        Text(
            if (reading.total == 0) "Even geduld" else "${reading.done} van ${reading.total}",
            style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 14.sp, color = cs.onSurfaceVariant),
            modifier = Modifier.padding(top = 4.dp),
        )
        val progress by animateFloatAsState(if (reading.total == 0) 0f else reading.done / reading.total.toFloat(), MaterialTheme.motionScheme.defaultEffectsSpec(), label = "read")
        LinearWavyProgressIndicator(progress = { progress }, modifier = Modifier.padding(top = 18.dp).width(200.dp))
    }
}

@Composable
private fun BookPages(sheets: List<Sheet>, pager: PagerState, ctx: BookContext, onBack: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    val motion = MaterialTheme.motionScheme
    Column(Modifier.fillMaxSize()) {
        Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            CircleButton(onBack) { LineIcon(listOf(P("M19 12H5"), P("m12 19-7-7 7-7")), cs.onSurface, size = 22.dp, stroke = 2.2f) }
            Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                Text("Fotoboek", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 22.sp, color = cs.onSurface))
                val chosen = ctx.picked.days.sumOf { it.photos.size }
                Text(
                    "${sheets.size} pagina's · $chosen van ${ctx.picked.photoCount} foto's",
                    style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = cs.onSurfaceVariant),
                )
            }
            val page by remember { derivedStateOf { pager.currentPage } }
            Box(Modifier.clip(CircleShape).background(cs.surfaceContainerHighest).padding(horizontal = 14.dp, vertical = 9.dp)) {
                Text("${page + 1} / ${sheets.size}", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.onSurface))
            }
        }

        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
            val pageW = min(maxWidth.value - 44f, (maxHeight.value - 24f) * PAGE_ASPECT).dp
            HorizontalPager(
                pager,
                contentPadding = PaddingValues(horizontal = (maxWidth - pageW) / 2),
                pageSpacing = 14.dp,
                beyondViewportPageCount = 1,
                modifier = Modifier.fillMaxSize(),
                key = { sheets[it].key },
            ) { i ->
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Box(
                        Modifier.width(pageW).aspectRatio(PAGE_ASPECT)
                            .graphicsLayer {
                                val off = ((pager.currentPage - i) + pager.currentPageOffsetFraction).absoluteValue.coerceIn(0f, 1f)
                                val s = 1f - 0.08f * off
                                scaleX = s; scaleY = s
                                alpha = 1f - 0.35f * off
                            }
                            .shadow(if (ctx.dark) 0.dp else 10.dp, RoundedCornerShape(3.dp), ambientColor = Color(0x33000000), spotColor = Color(0x33000000))
                            .clip(RoundedCornerShape(3.dp))
                            .background(if (ctx.dark) Color(0xFF15181C) else Color.White),
                    ) { SheetView(sheets[i], i, ctx) }
                }
            }
        }

        // The days as a strip: the current one opens up with its place, a tap leafs there.
        val current by remember { derivedStateOf { sheets.getOrNull(pager.currentPage)?.day?.number ?: 0 } }
        val days = remember(sheets) { listOf<BookDay?>(null) + ctx.picked.days }
        val strip = rememberLazyListState()
        LaunchedEffect(current) {
            val idx = days.indexOfFirst { (it?.number ?: 0) == current }.coerceAtLeast(0)
            strip.animateScrollToItem((idx - 2).coerceAtLeast(0))
        }
        LazyRow(
            state = strip,
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 10.dp),
        ) {
            itemsIndexed(days, key = { _, d -> d?.date?.toString() ?: "start" }) { _, d ->
                val on = (d?.number ?: 0) == current
                val bg by androidx.compose.animation.animateColorAsState(if (on) cs.primary else cs.surfaceContainerHighest, motion.defaultEffectsSpec(), label = "dayBg")
                val fg by androidx.compose.animation.animateColorAsState(if (on) cs.onPrimary else cs.onSurfaceVariant, motion.defaultEffectsSpec(), label = "dayFg")
                Row(
                    Modifier.height(44.dp).clip(CircleShape).background(bg)
                        .clickable {
                            val target = if (d == null) 0 else sheets.indexOfFirst { it.day == d }
                            if (target >= 0) scope.launch { pager.animateScrollToPage(target, animationSpec = motion.defaultSpatialSpec()) }
                        }
                        .animateContentSize(motion.defaultSpatialSpec())
                        .padding(horizontal = if (on) 16.dp else 0.dp)
                        .then(if (on) Modifier else Modifier.width(44.dp)),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center,
                ) {
                    val label = when {
                        d == null -> if (on) "Begin" else "★"
                        on -> "Dag ${d.number}" + (d.place?.let { " · $it" } ?: "")
                        else -> "${d.number}"
                    }
                    Text(label, maxLines = 1, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = fg))
                }
            }
        }
        Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
    }
}

@Composable
private fun CircleButton(onClick: () -> Unit, content: @Composable () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Box(Modifier.size(48.dp).clip(CircleShape).background(cs.surfaceContainerHighest).clickable(onClick = onClick), contentAlignment = Alignment.Center) { content() }
}

/** Sizes on a page scale with the page, as on paper. */
@Composable
private fun Dp.sp(): TextUnit = with(LocalDensity.current) { this@sp.toSp() }

private val longDate = DateTimeFormatter.ofPattern("EEEE d MMMM", Locale.forLanguageTag("nl"))
private val clock = DateTimeFormatter.ofPattern("HH:mm")

@Composable
private fun SheetView(sheet: Sheet, index: Int, ctx: BookContext) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val u = maxWidth
        when (sheet) {
            Sheet.Cover -> CoverSheet(ctx, u)
            Sheet.Route -> RouteSheet(ctx, u)
            is Sheet.Opener -> OpenerSheet(sheet, ctx, u)
            is Sheet.Photos -> PhotosSheet(sheet, index, ctx, u)
            Sheet.End -> EndSheet(ctx, u)
        }
    }
}

private val scrim = Brush.verticalGradient(0.45f to Color.Transparent, 1f to Color(0xB3000000))

@Composable
private fun CoverSheet(ctx: BookContext, u: Dp) {
    val cover = ctx.picked.cover
    Box(Modifier.fillMaxSize()) {
        if (cover != null) PhotoView(cover.photo, Modifier.fillMaxSize().sharedPhoto(cover.photo.id).clickable { ctx.onPhoto(cover) }, placeholder = Color(cover.look.average))
        Box(Modifier.fillMaxSize().background(scrim))
        Text(
            "MarkMySteps", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = (u * 0.036f).sp(), color = Color.White, letterSpacing = 0.01.em),
            modifier = Modifier.padding(start = u * SIDE, top = u * TOP),
        )
        Column(Modifier.align(Alignment.BottomStart).padding(start = u * SIDE, end = u * SIDE, bottom = u * 0.09f)) {
            Box(Modifier.width(u * 0.1f).height(u * 0.012f).clip(CircleShape).background(ctx.accent))
            Text(
                ctx.trip.title,
                style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = (u * 0.105f).sp(), lineHeight = (u * 0.11f).sp(), letterSpacing = (-0.02).em, color = Color.White),
                modifier = Modifier.padding(top = u * 0.03f),
            )
            Text(
                ctx.trip.dates, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = (u * 0.036f).sp(), color = Color.White.copy(alpha = 0.85f)),
                modifier = Modifier.padding(top = u * 0.015f),
            )
        }
    }
}

/** Frame a trip on the globe: the middle of its stops, and a zoom that fits their spread. */
fun tripFrame(trip: Trip): Triple<Double, Double, Float> {
    val points = trip.stops.map { it.at }.ifEmpty { trip.route }.ifEmpty { listOf(HomeAirport) }
    val lon = points.map { it.first }.average()
    val lat = points.map { it.second }.average()
    val spread = points.maxOf { p -> angle(p, lon to lat) }.coerceAtLeast(0.6)
    return Triple(lon, lat, (40.0 / spread).coerceIn(3.0, 90.0).toFloat())
}

fun globeStyle(dark: Boolean, width: Float = 3f) = GlobeStyle(
    sphere = if (dark) Color(0xFF101418) else Color(0xFFDCE6EC),
    land = if (dark) Color(0xFF29313A) else Color(0xFFEFE7D8),
    dark = dark,
    routeWidth = width,
)

/** A stop's number in its Material shape, in the trip's colour. */
@Composable
fun StopBadge(index: Int, color: Color, size: Dp, text: String = "${index + 1}") {
    Box(Modifier.size(size).clip(StopShapesBook[index % StopShapesBook.size].toShape()).background(color), contentAlignment = Alignment.Center) {
        Text(text, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = (size * 0.42f).sp(), color = Color.White))
    }
}

@Composable
private fun RouteSheet(ctx: BookContext, u: Dp) {
    val cs = MaterialTheme.colorScheme
    val (lon, lat, zoom) = remember(ctx.trip) { tripFrame(ctx.trip) }
    Column(Modifier.fillMaxSize().padding(horizontal = u * SIDE, vertical = u * TOP)) {
        Text("De route", style = TextStyle(fontFamily = Fraunces, fontWeight = FontWeight(560), fontSize = (u * 0.075f).sp(), color = cs.onSurface))
        Text(
            ctx.trip.dates, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = (u * 0.03f).sp(), color = cs.onSurfaceVariant),
            modifier = Modifier.padding(top = u * 0.008f),
        )
        Box(Modifier.padding(top = u * 0.04f).fillMaxWidth().weight(1f).clip(RoundedCornerShape(u * 0.04f))) {
            Globe(listOf(ctx.trip), globeStyle(ctx.dark), Modifier.fillMaxSize(), centerLon = lon, centerLat = lat, zoom = zoom * 1.1f, showStops = true, turnable = false)
        }
        val stops = ctx.trip.stops
        val twoCols = stops.size > 5
        val rows = if (twoCols) (stops.size + 1) / 2 else stops.size
        Row(Modifier.padding(top = u * 0.045f).fillMaxWidth()) {
            for (col in 0 until if (twoCols) 2 else 1) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(u * 0.022f)) {
                    for (i in col * rows until min(stops.size, (col + 1) * rows)) {
                        val s = stops[i]
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            StopBadge(i, ctx.accent, u * 0.06f)
                            Column(Modifier.padding(start = u * 0.025f)) {
                                Text("${s.flag} ${s.name}", maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = (u * 0.034f).sp(), color = cs.onSurface))
                                Text(
                                    if (s.nights == 1) "1 nacht" else "${s.nights} nachten",
                                    style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = (u * 0.026f).sp(), color = cs.onSurfaceVariant),
                                )
                            }
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(u * 0.045f))
        FactSlab(tripFacts(ctx.trip, ctx.picked), u, cs.surfaceContainerHigh)
    }
}

/** The trip's numbers: at most four, the ones that say something. */
fun tripFacts(trip: Trip, picked: Picked?): List<Pair<String, String>> {
    val countries = trip.stops.map { it.flag }.distinct().size
    return buildList {
        add("${trip.days}" to "dagen")
        trip.km?.let { add("%,d".format(it).replace(',', '.') to "km") }
        if (trip.stops.size > 1) add("${trip.stops.size}" to "stops")
        if (countries > 1) add("$countries" to "landen")
        else picked?.let { add("${it.photoCount}" to "foto's") }
    }.take(4)
}

/** Numbers as one connected slab, like the trip page's facts. */
@Composable
fun FactSlab(items: List<Pair<String, String>>, u: Dp, tile: Color, ink: Color = MaterialTheme.colorScheme.onSurface, soft: Color = MaterialTheme.colorScheme.onSurfaceVariant) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(u * 0.008f)) {
        items.forEachIndexed { i, (value, label) ->
            val big = u * 0.05f
            val small = u * 0.014f
            val shape = RoundedCornerShape(
                topStart = if (i == 0) big else small, bottomStart = if (i == 0) big else small,
                topEnd = if (i == items.lastIndex) big else small, bottomEnd = if (i == items.lastIndex) big else small,
            )
            Column(Modifier.weight(1f).clip(shape).background(tile).padding(horizontal = u * 0.03f, vertical = u * 0.028f)) {
                Text(value, maxLines = 1, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = (u * 0.05f).sp(), letterSpacing = (-0.02).em, color = ink))
                Text(label, maxLines = 1, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = (u * 0.027f).sp(), color = soft))
            }
        }
    }
}

private fun stopIndex(ctx: BookContext, day: BookDay): Int = ctx.trip.stops.indexOfFirst { it.name == day.place }.coerceAtLeast(0)

@Composable
private fun OpenerSheet(sheet: Sheet.Opener, ctx: BookContext, u: Dp) {
    val day = sheet.day
    Box(Modifier.fillMaxSize()) {
        PhotoView(sheet.photo.photo, Modifier.fillMaxSize().sharedPhoto(sheet.photo.photo.id).clickable { ctx.onPhoto(sheet.photo) }, placeholder = Color(sheet.photo.look.average))
        Box(Modifier.fillMaxSize().background(scrim))
        Column(Modifier.align(Alignment.BottomStart).padding(start = u * SIDE, end = u * SIDE, bottom = u * 0.08f)) {
            StopBadge(stopIndex(ctx, day), ctx.accent, u * 0.12f, "${day.number}")
            Text(
                day.date.format(longDate).uppercase(),
                style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(650), fontSize = (u * 0.026f).sp(), letterSpacing = 0.08.em, color = Color.White.copy(alpha = 0.85f)),
                modifier = Modifier.padding(top = u * 0.035f),
            )
            Text(
                listOfNotNull(day.flag, day.place ?: "Dag ${day.number}").joinToString(" "),
                style = TextStyle(fontFamily = Fraunces, fontWeight = FontWeight(560), fontSize = (u * 0.085f).sp(), lineHeight = (u * 0.095f).sp(), color = Color.White),
            )
        }
    }
}

@Composable
private fun PhotosSheet(sheet: Sheet.Photos, index: Int, ctx: BookContext, u: Dp) {
    val cs = MaterialTheme.colorScheme
    val day = sheet.day
    Box(Modifier.fillMaxSize()) {
        val boxTop = TOP + if (sheet.heading) HEADER else 0f
        val boxH = INNER_H - if (sheet.heading) HEADER else 0f
        if (sheet.heading) {
            Row(Modifier.padding(start = u * SIDE, end = u * SIDE, top = u * TOP), verticalAlignment = Alignment.CenterVertically) {
                StopBadge(stopIndex(ctx, day), ctx.accent, u * 0.14f, "${day.number}")
                Column(Modifier.padding(start = u * 0.04f)) {
                    Text(
                        day.date.format(longDate).uppercase(),
                        style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(650), fontSize = (u * 0.026f).sp(), letterSpacing = 0.08.em, color = cs.onSurfaceVariant),
                    )
                    Text(
                        listOfNotNull(day.flag, day.place ?: "Dag ${day.number}").joinToString(" "),
                        maxLines = 2,
                        style = TextStyle(fontFamily = Fraunces, fontWeight = FontWeight(560), fontSize = (u * 0.075f).sp(), lineHeight = (u * 0.085f).sp(), color = cs.onSurface),
                    )
                }
            }
        }
        for (slot in sheet.layout.slots) {
            val r = sheet.photos[slot.index]
            PhotoView(
                r.photo,
                Modifier
                    .offset(x = u * (SIDE + slot.x * INNER_W), y = u * (boxTop + slot.y * boxH))
                    .size(width = u * (slot.w * INNER_W), height = u * (slot.h * boxH))
                    .sharedPhoto(r.photo.id)
                    .clip(RoundedCornerShape(u * 0.008f))
                    .clickable { ctx.onPhoto(r) },
                placeholder = Color(r.look.average),
            )
        }
        Folio("Dag ${day.number}" + (day.place?.let { " · $it" } ?: ""), index + 1, u)
    }
}

@Composable
private fun Folio(label: String, number: Int, u: Dp) {
    val cs = MaterialTheme.colorScheme
    val style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = (u * 0.024f).sp(), color = cs.onSurfaceVariant)
    Box(Modifier.fillMaxSize().padding(horizontal = u * SIDE).padding(bottom = u * 0.04f)) {
        Text(label, style = style, modifier = Modifier.align(Alignment.BottomStart))
        Text("$number", style = style.copy(fontFamily = Outfit, fontWeight = FontWeight(600)), modifier = Modifier.align(Alignment.BottomEnd))
    }
}

@Composable
private fun EndSheet(ctx: BookContext, u: Dp) {
    val cs = MaterialTheme.colorScheme
    val (lon, lat, _) = remember(ctx.trip) { tripFrame(ctx.trip) }
    Column(Modifier.fillMaxSize().padding(horizontal = u * SIDE, vertical = u * TOP), horizontalAlignment = Alignment.CenterHorizontally) {
        Spacer(Modifier.weight(1f))
        Globe(listOf(ctx.trip), globeStyle(ctx.dark, 2.4f), Modifier.size(u * 0.56f), centerLon = lon, centerLat = lat, turnable = false)
        Text(
            "Tot de volgende reis", textAlign = TextAlign.Center,
            style = TextStyle(fontFamily = Fraunces, fontWeight = FontWeight(560), fontSize = (u * 0.068f).sp(), color = cs.onSurface),
            modifier = Modifier.padding(top = u * 0.06f),
        )
        Text(
            tripFacts(ctx.trip, ctx.picked).joinToString("  ·  ") { "${it.first} ${it.second}" }, textAlign = TextAlign.Center,
            style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = (u * 0.03f).sp(), color = cs.onSurfaceVariant),
            modifier = Modifier.padding(top = u * 0.02f),
        )
        Spacer(Modifier.weight(1f))
        Text("MarkMySteps", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = (u * 0.032f).sp(), color = ctx.accent))
    }
}

/**
 * One photo full screen, leafing through all of the book's photos. Opens the
 * original, which on an Ultra HDR photo carries the gain map: the window then
 * switches to HDR, held to a modest headroom so the highlights glow without
 * blinding, and goes back to normal on the way out.
 */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
private fun Viewer(all: List<Rated>, start: Rated, trip: Trip, onClose: (Rated) -> Unit) {
    val first = all.indexOf(start).coerceAtLeast(0)
    val pager = rememberPagerState(first) { all.size }
    val activity = LocalContext.current as? Activity
    DisposableEffect(activity) {
        val window = activity?.window
        if (window != null && Build.VERSION.SDK_INT >= 34) {
            window.colorMode = ActivityInfo.COLOR_MODE_HDR
            if (Build.VERSION.SDK_INT >= 35) window.desiredHdrHeadroom = 3f
        }
        onDispose { if (window != null && Build.VERSION.SDK_INT >= 34) window.colorMode = ActivityInfo.COLOR_MODE_DEFAULT }
    }
    BackHandler { onClose(all[pager.currentPage]) }
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        HorizontalPager(pager, modifier = Modifier.fillMaxSize(), beyondViewportPageCount = 1) { i ->
            val r = all[i]
            Box(Modifier.fillMaxSize().clickable { onClose(r) }, contentAlignment = Alignment.Center) {
                val m = Modifier.fillMaxWidth().aspectRatio(r.aspect, matchHeightConstraintsFirst = r.aspect < 0.6f)
                PhotoView(r.photo, if (i == pager.currentPage) m.sharedPhoto(r.photo.id) else m, size = PhotoSize.Original, placeholder = Color(r.look.average))
            }
        }
        val r = all[pager.currentPage]
        Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Transparent, Color(0x99000000)))).padding(horizontal = 20.dp)) {
            val stop = r.stop?.let { trip.stops.getOrNull(it) }
            Text(
                listOfNotNull(stop?.let { "${it.flag} ${it.name}" }).joinToString() .ifEmpty { trip.title },
                style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 18.sp, color = Color.White),
                modifier = Modifier.padding(top = 32.dp),
            )
            val local = r.photo.takenAt.atZone(java.time.ZoneId.systemDefault())
            Text(
                "${localDay(r.photo.takenAt, r.photo.at).format(longDate)} · ${local.format(clock)}",
                style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 14.sp, color = Color.White.copy(alpha = 0.8f)),
                modifier = Modifier.padding(top = 2.dp, bottom = 16.dp),
            )
            Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
        }
    }
}
