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
import androidx.compose.foundation.border
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
import androidx.compose.ui.layout.onGloballyPositioned
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
import kotlin.math.cos
import kotlin.math.sin
import androidx.compose.ui.res.stringResource

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

/** A closed book, 24 by 24 like the other line icons. */
val BookGlyph = listOf(P("M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"))

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
    val tiles: TileBounds,
    /** The photo open in the viewer: its place in the book stays empty meanwhile. */
    val hidden: String?,
    val onPhoto: (Rated) -> Unit,
)

/** A photo on a page: tappable, known to the viewer by where it sits, and empty while open. */
private fun Modifier.bookTile(r: Rated, ctx: BookContext): Modifier =
    onGloballyPositioned { ctx.tiles.tiles[r.photo.id] = it }
        .graphicsLayer { alpha = if (ctx.hidden == r.photo.id) 0f else 1f }
        .clickable { ctx.onPhoto(r) }

/** A trip's media with what each photo looks like, read once per trip. */
private class Loaded(val media: List<TripPhoto>, val looks: Map<String, Look>, val aspects: Map<String, Float>, val start: java.time.LocalDate?)

private val cachedLoads = HashMap<String, Loaded>()

/**
 * The state a book or summary screen loads: the trip's photos read once, then
 * picked. A trip read from the server brings its stops in a moment after it
 * opens; picking waits briefly for them (they name the days), so the book
 * appears once and does not rebuild under the reader's hands.
 */
@Composable
fun rememberPicked(trip: Trip): Pair<Picked?, Reading> {
    // The route per traveller is fetched while the photos are read, so the map has it when it first shows.
    LaunchedEffect(trip.remoteId) { travelled(trip) }
    val loader = LocalPhotoLoader.current
    val context = LocalContext.current.applicationContext
    var loaded by remember(trip.id) { mutableStateOf(cachedLoads[trip.id]) }
    var reading by remember(trip.id) { mutableStateOf(Reading(0, 0)) }
    if (loaded == null) LaunchedEffect(trip.id) {
        val remote = trip.remoteId
        val media = if (remote != null) runCatching { serverMedia(trip) }.getOrDefault(emptyList()) else demoMedia(trip).first
        val start = if (remote != null) trip.start else demoStart(trip)
        val stored = if (remote != null) LookStore.load(context, remote) else LookStore.Stored(emptyMap(), emptyMap())
        // A photo that would not load in the last day is not asked for again yet.
        val dayAgo = System.currentTimeMillis() - 24 * 3_600_000L
        val todo = media.filter { it.id !in stored.looks && (stored.failed[it.id] ?: 0L) < dayAgo }
        reading = Reading(0, todo.size)
        val (fresh, freshAspects) = readLooks(todo, if (remote != null) loader else null) { reading = it }
        val looks = stored.looks.mapValues { it.value.first } + fresh
        val aspects = stored.looks.mapValues { it.value.second } + freshAspects
        if (remote != null && todo.isNotEmpty()) {
            val now = System.currentTimeMillis()
            val failed = stored.failed.filterValues { it >= dayAgo } + todo.filter { it.id !in fresh }.associate { it.id to now }
            LookStore.save(context, remote, looks, aspects, failed)
        }
        cachedLoads[trip.id] = Loaded(media, looks, aspects, start).also { loaded = it }
    }
    val key = "${trip.id}/${trip.stops.size}"
    var picked by remember(trip.id) { mutableStateOf(cachedPicks[key]) }
    val ready = loaded
    LaunchedEffect(ready, key) {
        if (ready == null) return@LaunchedEffect
        cachedPicks[key]?.let { picked = it; return@LaunchedEffect }
        if (trip.remoteId != null && trip.stops.isEmpty() && picked == null) kotlinx.coroutines.delay(3_000)
        val result = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) {
            pickPhotos(ready.media, ready.looks, ready.aspects, trip.stops, ready.start, coverId = trip.coverId)
        }
        cachedPicks[key] = result
        // Once a book is on screen it only changes when the stops add something to it.
        if (picked == null || trip.stops.isNotEmpty()) picked = result
    }
    return picked to reading
}

private val cachedPicks = HashMap<String, Picked>()

@Composable
fun PhotoBook(trip: Trip, dark: Boolean, onBack: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val (picked, reading) = rememberPicked(trip)
    val sheets = remember(picked) { picked?.let { buildBook(it) } ?: emptyList() }
    val pager = rememberPagerState { sheets.size }
    // The book's photos in page order, for the trip page's own viewer (it grows from the tile and flies back).
    val all = remember(sheets) {
        sheets.flatMap { s ->
            when (s) {
                Sheet.Cover -> listOfNotNull(picked?.cover)
                is Sheet.Opener -> listOf(s.photo)
                is Sheet.Photos -> s.photos
                else -> emptyList()
            }
        }.distinctBy { it.photo.id }
    }
    val media = remember(all) { all.map { Media(it.photo.id, localDay(it.photo.takenAt, it.photo.at, trip.stops), it.photo.video, it.aspect, userId = it.photo.userId, lat = it.photo.at?.second, lon = it.photo.at?.first) } }
    val tiles = remember(trip.id) { TileBounds() }
    var viewing by remember { mutableStateOf<String?>(null) }
    var shown by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val accent = legibleColor(trip.color, dark)

    BackHandler(enabled = viewing == null) { onBack() }

    Box(Modifier.fillMaxSize().background(cs.background)) {
        // From reading to the book in one fade, nothing jumping.
        androidx.compose.animation.Crossfade(picked, animationSpec = MaterialTheme.motionScheme.defaultEffectsSpec(), label = "book") { ready ->
            if (ready == null) {
                // The same top row as the book itself while it reads, so the way back and the name are there.
                Column(Modifier.fillMaxSize()) {
                    Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
                    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        CircleButton(onBack) { LineIcon(listOf(P("M19 12H5"), P("m12 19-7-7 7-7")), cs.onSurface, size = 22.dp, stroke = 2.2f) }
                        Text(
                            betaTitle(androidx.compose.ui.res.stringResource(R.string.book_title), cs.onSurfaceVariant, 13.sp),
                            style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 22.sp, color = cs.onSurface),
                            modifier = Modifier.padding(horizontal = 14.dp),
                        )
                    }
                    Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) { Reading(reading, androidx.compose.ui.res.stringResource(R.string.book_reading)) }
                }
            } else {
                BookPages(
                    sheets, pager,
                    BookContext(trip, ready, dark, accent, tiles, hidden = shown, onPhoto = { r -> viewing = r.photo.id }),
                    onBack = onBack,
                )
            }
        }
        viewing?.let { start ->
            PhotoViewer(
                trip, media, start, bounds = tiles,
                onCurrent = { id ->
                    shown = id
                    // Leaf the book along, so the photo can fly back into its own place.
                    val page = sheets.indexOfFirst { s -> (s is Sheet.Photos && s.photos.any { it.photo.id == id }) || (s is Sheet.Opener && s.photo.photo.id == id) || (s == Sheet.Cover && picked?.cover?.photo?.id == id) }
                    if (page >= 0 && page != pager.currentPage) scope.launch { pager.scrollToPage(page) }
                },
                onClose = { viewing = null; shown = null },
            )
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
            if (reading.total == 0) androidx.compose.ui.res.stringResource(R.string.book_wait) else androidx.compose.ui.res.stringResource(R.string.book_of, reading.done, reading.total),
            style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 14.sp, color = cs.onSurfaceVariant),
            modifier = Modifier.padding(top = 4.dp),
        )
        SmoothProgress(if (reading.total == 0) 0f else reading.done / reading.total.toFloat(), Modifier.padding(top = 18.dp).width(200.dp))
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
                Text(betaTitle(androidx.compose.ui.res.stringResource(R.string.book_title), cs.onSurfaceVariant, 13.sp), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 22.sp, color = cs.onSurface))
                val chosen = ctx.picked.days.sumOf { it.photos.size }
                Text(
                    androidx.compose.ui.res.stringResource(R.string.book_count, sheets.size, chosen, ctx.picked.photoCount),
                    maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                    style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = cs.onSurfaceVariant),
                )
            }
            val page by remember { derivedStateOf { pager.currentPage } }
            Box(Modifier.clip(CircleShape).background(cs.surfaceContainerHighest).padding(horizontal = 14.dp, vertical = 9.dp)) {
                Text("${page + 1} / ${sheets.size}", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.onSurface))
            }
            // Save as PDF, Snel or Print, made in the background (BookPdf.kt).
            Spacer(Modifier.width(8.dp))
            BookSaveButton(ctx.trip, ctx.picked, sheets)
        }
        BookSaveBar(ctx.trip)

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
                            .clip(RoundedCornerShape(4.dp))
                            .background(if (ctx.dark) MaterialTheme.colorScheme.surfaceContainerLow else Color.White)
                            // A card as on the web: raised paper with a thin line, no shadow.
                            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(4.dp)),
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
                    if (d == null && !on) {
                        // The start of the book: a drawn book, never a sign from a font.
                        LineIcon(BookGlyph, fg, size = 20.dp)
                    } else {
                        val label = when {
                            d == null -> androidx.compose.ui.res.stringResource(R.string.book_start)
                            on -> androidx.compose.ui.res.stringResource(R.string.book_day, d.number) + (d.place?.let { " · $it" } ?: "")
                            else -> "${d.number}"
                        }
                        Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = fg))
                    }
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

private val longDate get() = DateTimeFormatter.ofPattern("EEEE d MMMM", Locale.forLanguageTag(Lang.current))
private val clock = DateTimeFormatter.ofPattern("HH:mm")

@Composable
internal fun SheetView(sheet: Sheet, index: Int, ctx: BookContext) {
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
        if (cover != null) PhotoView(cover.photo, Modifier.fillMaxSize().bookTile(cover, ctx), placeholder = Color(cover.look.average))
        if (ctx.hidden != cover?.photo?.id) {
            Box(Modifier.fillMaxSize().background(scrim))
            // A soft shade at the top too, so the wordmark reads on a light sky.
            Box(Modifier.fillMaxWidth().height(u * 0.3f).background(Brush.verticalGradient(listOf(Color(0x59000000), Color.Transparent))))
        }
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

/**
 * Frame a trip so its stops fill [fill] of a [w] by [h] box (dp), on the globe
 * as Globe.kt draws it (radius = (short side / 2 - 2 dp) * zoom). The centre is
 * the middle of the stops as projected, so a long thin route sits in the middle.
 */
fun fitFrame(trip: Trip, w: Float, h: Float, side: Float, fill: Float): Triple<Double, Double, Float> {
    val points = trip.stops.map { it.at }.ifEmpty { trip.route }.ifEmpty { listOf(HomeAirport) }
    var lon0 = Math.toRadians(points.map { it.first }.average())
    var lat0 = Math.toRadians(points.map { it.second }.average())
    var spanX = 0.0
    var spanY = 0.0
    repeat(2) {
        var minX = Double.MAX_VALUE; var maxX = -Double.MAX_VALUE; var minY = Double.MAX_VALUE; var maxY = -Double.MAX_VALUE
        for (p in points) {
            val lon = Math.toRadians(p.first); val lat = Math.toRadians(p.second)
            val x = cos(lat) * sin(lon - lon0)
            val y = cos(lat0) * sin(lat) - sin(lat0) * cos(lat) * cos(lon - lon0)
            minX = minOf(minX, x); maxX = maxOf(maxX, x); minY = minOf(minY, y); maxY = maxOf(maxY, y)
        }
        // Move the centre onto the middle of what is drawn, then measure again.
        lon0 += (minX + maxX) / 2 / cos(lat0).coerceAtLeast(0.2)
        lat0 += (minY + maxY) / 2
        spanX = maxX - minX; spanY = maxY - minY
    }
    // Never closer than about a degree: a city trip still shows its surroundings.
    val sx = spanX.coerceAtLeast(0.02); val sy = spanY.coerceAtLeast(0.02)
    val radius = min(w * fill / sx, h * fill / sy)
    val zoom = (radius / (side / 2f - 2f)).toFloat().coerceIn(1f, 140f)
    return Triple(Math.toDegrees(lon0), Math.toDegrees(lat0), zoom)
}

/**
 * The route as the app's own map draws it: a line per traveller (GET /api/trips/:id/route, only read). The
 * trip list's overview line strings every traveller's points together in time order, so where two people
 * tracked at the same time it jumped between them in straight lines (Marrakesh to Rabat beside the train).
 */
private val travelledLines = java.util.concurrent.ConcurrentHashMap<String, List<MapRemote.RouteLine>>()

suspend fun travelled(trip: Trip): List<MapRemote.RouteLine>? {
    val id = trip.remoteId ?: return null
    if (LocalMode.on) return null
    travelledLines[id]?.let { return it }
    return runCatching { MapRemote.routes(id, null).filter { it.points.size >= 2 } }.getOrNull()?.also { travelledLines[id] = it }
}

/** Every traveller's line once it has come (usually fetched while the photos were read); null before or offline. */
@Composable
fun rememberRouteLines(trip: Trip): List<MapRemote.RouteLine>? {
    val lines by androidx.compose.runtime.produceState(trip.remoteId?.let { travelledLines[it] }, trip.remoteId) {
        if (value == null) value = travelled(trip)
    }
    return lines
}

/**
 * Whose lines the posters and the book show, ticked in the summary's choices and kept per trip on the phone.
 * Untouched it is only your own line; the owner's when you have none; everyone's when neither has one.
 */
object RouteChoice {
    private val chosen = androidx.compose.runtime.mutableStateMapOf<String, Set<String>>()
    private var prefs: android.content.SharedPreferences? = null
    private fun key(id: String) = "posterRoutes.$id"

    fun init(context: android.content.Context) {
        if (prefs == null) prefs = context.applicationContext.getSharedPreferences("mms.next.ui", android.content.Context.MODE_PRIVATE)
    }

    fun users(trip: Trip, lines: List<MapRemote.RouteLine>): Set<String> {
        val id = trip.remoteId ?: return emptySet()
        chosen[id]?.let { return it }
        prefs?.getString(key(id), null)?.let { raw -> return raw.split(',').filter { it.isNotBlank() }.toSet() }
        val drawn = lines.map { it.userId }.toSet()
        val me = Data.me?.id
        return when {
            me != null && me in drawn -> setOf(me)
            trip.ownerId != null && trip.ownerId in drawn -> setOf(trip.ownerId)
            else -> drawn
        }
    }

    fun toggle(trip: Trip, lines: List<MapRemote.RouteLine>, userId: String) {
        val id = trip.remoteId ?: return
        val now = users(trip, lines)
        val next = if (userId in now) now - userId else now + userId
        chosen[id] = next
        prefs?.edit()?.putString(key(id), next.joinToString(","))?.apply()
    }
}

/** [trip] with only the chosen travellers' lines, each drawn on its own; as it is until the lines have come. */
@Composable
fun rememberTravelled(trip: Trip): Trip {
    val context = LocalContext.current
    remember { RouteChoice.init(context) }
    val lines = rememberRouteLines(trip)?.takeIf { it.isNotEmpty() } ?: return trip
    val users = RouteChoice.users(trip, lines)
    return remember(trip, lines, users) {
        val shown = lines.filter { it.userId in users }.map { it.points }
        trip.copy(segments = shown, route = shown.flatten())
    }
}

/**
 * The trip on the map, framed so its route fills the part of the box given by
 * [frameW] and [frameH] (shares of the box), centred at [shiftX] and [shiftY]
 * from the middle. A thin line: the route is the picture, not the pen.
 */
@Composable
fun TripMap(
    trip: Trip, dark: Boolean, modifier: Modifier, fill: Float = 0.8f, routeWidth: Float = 2.4f,
    frameW: Float = 1f, frameH: Float = 1f, shiftX: Float = 0f, shiftY: Float = 0f, stops: Boolean = true,
    /** Country borders, so you see where you are (the route map); the ribbon keeps the land plain. */
    borders: Boolean = false,
) {
    val shown = rememberTravelled(trip)
    BoxWithConstraints(modifier) {
        val w = maxWidth.value; val h = maxHeight.value
        val (lon, lat, zoom) = remember(trip, w, h, frameW, frameH, fill) { fitFrame(trip, w * frameW, h * frameH, min(w, h), fill) }
        // Only the route as it was travelled, as on the app's own map: no flight bows.
        val style = globeStyle(dark, routeWidth).copy(flights = false).let { if (borders) it.copy(borders = if (dark) Color(0xFF4A5461) else Color(0xFFC4B69D)) else it }
        Globe(listOf(shown), style, Modifier.fillMaxSize(), centerLon = lon, centerLat = lat, zoom = zoom, showStops = stops, turnable = false, shiftX = shiftX, shiftY = shiftY)
    }
}

/** "🇲🇦 Marrakesh": the flag drawn as the app draws flags, the rest as text. */
fun splitFlag(line: String): Pair<String?, String> {
    val cps = line.codePoints().toArray()
    if (cps.size < 2 || cps[0] !in 0x1F1E6..0x1F1FF || cps[1] !in 0x1F1E6..0x1F1FF) return null to line
    return String(cps, 0, 2) to String(cps, 2, cps.size - 2).trimStart()
}

@Composable
fun FlagText(line: String, style: TextStyle, modifier: Modifier = Modifier, maxLines: Int = 1, textAlign: TextAlign? = null) {
    val (flag, rest) = splitFlag(line)
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        if (flag != null) {
            val h = with(LocalDensity.current) { (style.fontSize.toDp() * 0.78f) }
            FlagIcon(flag, h, Modifier.padding(end = h * 0.45f))
        }
        Text(rest, maxLines = maxLines, overflow = TextOverflow.Ellipsis, style = style, textAlign = textAlign)
    }
}

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
    Column(Modifier.fillMaxSize().padding(horizontal = u * SIDE, vertical = u * TOP)) {
        Text(stringResource(R.string.photobook_route), style = TextStyle(fontFamily = Fraunces, fontWeight = FontWeight(560), fontSize = (u * 0.075f).sp(), color = cs.onSurface))
        Text(
            ctx.trip.dates, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = (u * 0.03f).sp(), color = cs.onSurfaceVariant),
            modifier = Modifier.padding(top = u * 0.008f),
        )
        Box(Modifier.padding(top = u * 0.04f).fillMaxWidth().weight(1f).clip(RoundedCornerShape(u * 0.04f)).background(globeStyle(ctx.dark).sphere)) {
            TripMap(ctx.trip, ctx.dark, Modifier.fillMaxSize(), fill = 0.78f, borders = true)
        }
        val stops = ctx.trip.stops
        val twoCols = stops.size > 3
        val rows = if (twoCols) (stops.size + 1) / 2 else stops.size
        Row(Modifier.padding(top = u * 0.045f).fillMaxWidth()) {
            for (col in 0 until if (twoCols) 2 else 1) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(u * 0.022f)) {
                    for (i in col * rows until min(stops.size, (col + 1) * rows)) {
                        val s = stops[i]
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            StopBadge(i, ctx.accent, u * 0.06f)
                            Column(Modifier.padding(start = u * 0.025f)) {
                                FlagText("${s.flag} ${s.name}", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = (u * 0.034f).sp(), color = cs.onSurface))
                                Text(
                                    Lang.plural(R.plurals.nights_count, s.nights),
                                    style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = (u * 0.026f).sp(), color = cs.onSurfaceVariant),
                                )
                            }
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(u * 0.045f))
        FactSlab(tripFacts(ctx.trip, ctx.picked), u, if (ctx.dark) cs.surfaceContainerHigh else cs.surfaceContainerHigh)
    }
}

/** The trip's numbers: at most four, the ones that say something. */
fun tripFacts(trip: Trip, picked: Picked?): List<Pair<String, String>> {
    val countries = trip.stops.map { it.flag }.distinct().size
    return buildList {
        add("${trip.days}" to Lang.text(R.string.home_days))
        trip.km?.takeIf { it > 0 }?.let { add("%,d".format(Lang.locale, it) to Lang.text(R.string.summary_fact_km)) }
        if (trip.stops.size > 1) add("${trip.stops.size}" to "stops")
        if (countries > 1) add("$countries" to Lang.text(R.string.summary_fact_countries))
        else picked?.let { add("${it.photoCount}" to Lang.text(R.string.summary_fact_photos)) }
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
                Text(value, maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = (u * 0.05f).sp(), letterSpacing = (-0.02).em, color = ink))
                Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = (u * 0.027f).sp(), color = soft))
            }
        }
    }
}

private fun stopIndex(ctx: BookContext, day: BookDay): Int = ctx.trip.stops.indexOfFirst { it.name == day.place }.coerceAtLeast(0)

@Composable
private fun OpenerSheet(sheet: Sheet.Opener, ctx: BookContext, u: Dp) {
    val day = sheet.day
    Box(Modifier.fillMaxSize()) {
        PhotoView(sheet.photo.photo, Modifier.fillMaxSize().bookTile(sheet.photo, ctx), placeholder = Color(sheet.photo.look.average))
        if (ctx.hidden != sheet.photo.photo.id) Box(Modifier.fillMaxSize().background(scrim))
        Column(Modifier.align(Alignment.BottomStart).padding(start = u * SIDE, end = u * SIDE, bottom = u * 0.08f)) {
            StopBadge(stopIndex(ctx, day), ctx.accent, u * 0.12f, "${day.number}")
            Text(
                day.date.format(longDate).uppercase(),
                style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(650), fontSize = (u * 0.026f).sp(), letterSpacing = 0.08.em, color = Color.White.copy(alpha = 0.85f)),
                modifier = Modifier.padding(top = u * 0.035f),
            )
            FlagText(
                listOfNotNull(day.flag, day.place ?: Lang.text(R.string.book_day, day.number)).joinToString(" "), maxLines = 2,
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
                    FlagText(
                        listOfNotNull(day.flag, day.place ?: Lang.text(R.string.book_day, day.number)).joinToString(" "),
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
                    .clip(RoundedCornerShape(u * 0.008f))
                    .bookTile(r, ctx),
                placeholder = Color(r.look.average),
            )
        }
        Folio(Lang.text(R.string.book_day, day.number) + (day.place?.let { " · $it" } ?: ""), index + 1, u)
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
            stringResource(R.string.photobook_until_next), textAlign = TextAlign.Center,
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
