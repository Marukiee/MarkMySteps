package nl.markmaaktmedia.markmysteps.next

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.provider.MediaStore
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonGroupDefaults
import androidx.compose.material3.MaterialShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.ToggleButton
import androidx.compose.material3.ToggleButtonDefaults
import androidx.compose.material3.ripple
import androidx.compose.material3.toShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.min
import kotlin.math.roundToInt

/*
 * The summary: a poster of the trip to share, in the four templates of the
 * web app (route, photos, ribbon, stats) and its three formats (story 9:16,
 * post 4:5, square). The photos are the trip's highlights from PhotoPick.kt
 * (the best of each stop first, no near-duplicates), each slot shaped to its
 * photo. Switching template moves the same photos to their new places with
 * the motion scheme's springs. Saving renders the poster at 1080 pixels wide
 * on the phone itself; nothing is uploaded.
 */

enum class Template(val label: String) { Route("Route"), Photos("Foto's"), Ribbon("Lint"), Stats("Cijfers") }

enum class Format(val label: String, val aspect: Float) { Story("Verhaal", 9f / 16f), Post("Post", 4f / 5f), Square("Vierkant", 1f) }

/** The book or the summary, sliding in over the trip page. */
@Composable
fun TripExtras(trip: Trip, dark: Boolean, open: String?, onClose: () -> Unit) {
    val motion = MaterialTheme.motionScheme
    AnimatedContent(
        open,
        transitionSpec = {
            (slideInHorizontally(motion.defaultSpatialSpec()) { it / 3 } + fadeIn(motion.defaultEffectsSpec())) togetherWith
                (slideOutHorizontally(motion.fastSpatialSpec()) { it / 3 } + fadeOut(motion.fastEffectsSpec()))
        },
        label = "extras",
    ) { which ->
        when (which) {
            "book" -> PhotoBook(trip, dark, onBack = onClose)
            "summary" -> SummaryScreen(trip, dark, onBack = onClose)
            else -> Box(Modifier.size(0.dp))
        }
    }
}

@OptIn(ExperimentalSharedTransitionApi::class)
private val LocalPosterShared = compositionLocalOf<Pair<SharedTransitionScope, AnimatedVisibilityScope>?> { null }

@OptIn(ExperimentalSharedTransitionApi::class)
private fun Modifier.posterShared(key: String): Modifier = composed {
    val pair = LocalPosterShared.current ?: return@composed this
    with(pair.first) {
        this@composed.sharedBounds(
            rememberSharedContentState(key), pair.second,
            boundsTransform = { _, _ -> androidx.compose.animation.core.spring(0.8f, 380f) },
        )
    }
}

data class PosterData(
    val trip: Trip,
    val picked: Picked,
    val dark: Boolean,
    val accent: Color,
    val facts: List<Pair<String, String>>,
    /** The best photo of each stop, in the order of the stops. */
    val perStop: List<Pair<Int, Rated>>,
)

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun SummaryScreen(trip: Trip, dark: Boolean, onBack: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val (picked, reading) = rememberPicked(trip)
    var template by remember { mutableStateOf(Template.Route) }
    var format by remember { mutableStateOf(Format.Post) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val layer = rememberGraphicsLayer()
    var saved by remember { mutableStateOf<Uri?>(null) }
    BackHandler(onBack = onBack)

    Box(Modifier.fillMaxSize().background(cs.background)) {
        Column(Modifier.fillMaxSize()) {
            Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(48.dp).clip(CircleShape).background(cs.surfaceContainerHighest).clickable(onClick = onBack), contentAlignment = Alignment.Center) {
                    LineIcon(listOf(P("M19 12H5"), P("m12 19-7-7 7-7")), cs.onSurface, size = 22.dp, stroke = 2.2f)
                }
                Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                    Text("Samenvatting", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 22.sp, color = cs.onSurface))
                    Text(trip.title, maxLines = 1, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = cs.onSurfaceVariant))
                }
            }

            // From reading to the poster in one fade, nothing jumping.
            androidx.compose.animation.Crossfade(picked, Modifier.weight(1f).fillMaxWidth(), animationSpec = MaterialTheme.motionScheme.defaultEffectsSpec(), label = "summary") { picked ->
                if (picked == null) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Reading(reading, "Mooiste foto's zoeken") }
                } else Column(Modifier.fillMaxSize()) {
                    // Every photo any template or format can show, fetched ahead, so switching shows them at once.
                    val loader = LocalPhotoLoader.current
                    val held = remember(picked) { androidx.compose.runtime.mutableStateMapOf<String, Bitmap>() }
                    LaunchedEffect(picked) {
                        if (loader != null) (listOfNotNull(picked.cover) + picked.highlights).distinctBy { it.photo.id }
                            .filter { it.photo.scene == null }
                            .forEach { r -> loader.load(r.photo.id, PhotoSize.Preview)?.let { held["${r.photo.id}/${PhotoSize.Preview.name}"] = it } }
                    }
                    val data = remember(picked, dark) {
                        PosterData(
                            trip, picked, dark, legibleColor(trip.color, dark), tripFacts(trip, picked),
                            perStop = picked.highlights.filter { it.stop != null }.groupBy { it.stop!! }
                                .map { (i, l) -> i to l.maxBy { it.showScore } }.sortedBy { it.first },
                        )
                    }
                    CompositionLocalProvider(LocalHeldPhotos provides held) {
                    BoxWithConstraints(Modifier.weight(1f).fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
                        val w = min(maxWidth.value - 40f, maxHeight.value * format.aspect).dp
                        SharedTransitionLayout {
                            val motion = MaterialTheme.motionScheme
                            AnimatedContent(
                                template to format,
                                transitionSpec = {
                                    (fadeIn(motion.defaultEffectsSpec()) + scaleIn(motion.defaultSpatialSpec(), initialScale = 0.97f)) togetherWith
                                        fadeOut(motion.fastEffectsSpec())
                                },
                                label = "poster",
                            ) { (t, f) ->
                                val pw = min(maxWidth.value - 40f, maxHeight.value * f.aspect).dp
                                CompositionLocalProvider(LocalPosterShared provides (this@SharedTransitionLayout to this@AnimatedContent)) {
                                    Box(
                                        Modifier.width(pw).aspectRatio(f.aspect)
                                            .clip(RoundedCornerShape(18.dp))
                                            .border(1.dp, cs.outlineVariant, RoundedCornerShape(18.dp))
                                            .then(
                                                if (t == template && f == format) Modifier.drawWithContent {
                                                    // Recorded at 1080 wide for saving, shown at screen size.
                                                    val k = 1080f / size.width
                                                    layer.record(IntSize(1080, (size.height * k).roundToInt())) {
                                                        scale(k, k, Offset.Zero) { this@drawWithContent.drawContent() }
                                                    }
                                                    scale(1f / k, 1f / k, Offset.Zero) { drawLayer(layer) }
                                                } else Modifier,
                                            ),
                                    ) { Poster(t, f, data) }
                                }
                            }
                        }
                        if (w < 0.dp) Spacer(Modifier)
                    }
                    }

                    Choices(Template.entries, template, { it.label }, { template = it; saved = null }, Modifier.padding(horizontal = 16.dp))
                    Choices(Format.entries, format, { it.label }, { format = it; saved = null }, Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        BigButton(if (saved != null) "Bewaard" else "Bewaar", Glyphs.download, tonal = true, Modifier.weight(1f)) {
                            scope.launch { saved = savePoster(context, layer.toImageBitmap().asAndroidBitmap(), trip, template) }
                        }
                        BigButton("Delen", Glyphs.arrowRight, tonal = false, Modifier.weight(1f)) {
                            scope.launch {
                                val uri = saved ?: savePoster(context, layer.toImageBitmap().asAndroidBitmap(), trip, template).also { saved = it }
                                if (uri != null) context.startActivity(
                                    Intent.createChooser(
                                        Intent(Intent.ACTION_SEND).setType("image/png").putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
                                        trip.title,
                                    ),
                                )
                            }
                        }
                    }
        
                }
            }
            Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
        }
    }
}

@Composable
private fun <T> Choices(items: List<T>, selected: T, label: (T) -> String, onPick: (T) -> Unit, modifier: Modifier = Modifier) {
    val cs = MaterialTheme.colorScheme
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(ButtonGroupDefaults.ConnectedSpaceBetween)) {
        items.forEachIndexed { i, item ->
            ToggleButton(
                checked = item == selected,
                onCheckedChange = { onPick(item) },
                modifier = Modifier.weight(1f).height(46.dp),
                shapes = when (i) {
                    0 -> ButtonGroupDefaults.connectedLeadingButtonShapes()
                    items.lastIndex -> ButtonGroupDefaults.connectedTrailingButtonShapes()
                    else -> ButtonGroupDefaults.connectedMiddleButtonShapes()
                },
                colors = ToggleButtonDefaults.toggleButtonColors(
                    containerColor = cs.surfaceContainerHighest,
                    contentColor = cs.onSurfaceVariant,
                    checkedContainerColor = cs.primary,
                    checkedContentColor = cs.onPrimary,
                ),
            ) { Text(label(item), maxLines = 1, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp)) }
        }
    }
}

@Composable
private fun BigButton(label: String, glyph: List<Shape24>, tonal: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val radius by androidx.compose.animation.core.animateDpAsState(if (pressed) 14.dp else 28.dp, MaterialTheme.motionScheme.fastSpatialSpec(), label = "btn")
    val bg = if (tonal) cs.secondaryContainer else cs.primary
    val fg = if (tonal) cs.onSecondaryContainer else cs.onPrimary
    Row(
        modifier.height(56.dp).clip(RoundedCornerShape(radius)).background(bg).clickable(source, ripple(), onClick = onClick),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center,
    ) {
        LineIcon(glyph, fg, size = 20.dp, stroke = 2.2f)
        Text(label, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 16.sp, color = fg), modifier = Modifier.padding(start = 10.dp))
    }
}

/** Into Pictures/MarkMySteps on the phone, where the share sheet can read it. */
private suspend fun savePoster(context: Context, bitmap: Bitmap, trip: Trip, template: Template): Uri? = withContext(Dispatchers.IO) {
    val values = ContentValues().apply {
        put(MediaStore.Images.Media.DISPLAY_NAME, "${trip.title} ${template.label} ${System.currentTimeMillis() / 1000}.png")
        put(MediaStore.Images.Media.MIME_TYPE, "image/png")
        put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/MarkMySteps")
    }
    val uri = context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return@withContext null
    context.contentResolver.openOutputStream(uri)?.use { bitmap.copy(Bitmap.Config.ARGB_8888, false).compress(Bitmap.CompressFormat.PNG, 100, it) }
    uri
}

// --- The posters ---

@Composable
private fun Dp.sp(): TextUnit = with(LocalDensity.current) { this@sp.toSp() }

private class Ink(val dark: Boolean) {
    val bg = if (dark) Color(0xFF0E1114) else Color.White
    val text = if (dark) Color(0xFFF1F3F5) else Color(0xFF1B2530)
    val soft = if (dark) Color(0xFFA2ACB6) else Color(0xFF5E6B77)
    val tile = if (dark) Color(0xFF1B1F24) else Color(0xFFF1EAE0)
}

@Composable
fun Poster(template: Template, format: Format, data: PosterData) {
    val ink = Ink(data.dark)
    BoxWithConstraints(Modifier.fillMaxSize().background(ink.bg)) {
        val u = maxWidth
        when (template) {
            Template.Route -> RoutePoster(data, format, u, ink)
            Template.Photos -> PhotosPoster(data, format, u)
            Template.Ribbon -> RibbonPoster(data, format, u, ink)
            Template.Stats -> StatsPoster(data, format, u)
        }
    }
}

@Composable
private fun PosterPhoto(r: Rated, modifier: Modifier) {
    PhotoView(r.photo, modifier.posterShared("s-${r.photo.id}"), placeholder = Color(r.look.average))
}

private fun monthLabel(trip: Trip) = "${trip.month} ${trip.year}"

private fun subtitle(trip: Trip): String {
    val stops = trip.stops
    return when {
        stops.isEmpty() -> trip.dates
        stops.map { it.flag }.distinct().size > 1 -> countryNames(stops)
        stops.size == 1 -> "${stops[0].flag} ${stops[0].name}"
        else -> "${stops[0].flag} ${stops.first().name} tot ${stops.last().name}"
    }
}

/** "Marokko en Spanje", from the stops' flags, in the order the trip went. */
private fun countryNames(stops: List<Stop>): String {
    val nl = java.util.Locale.forLanguageTag("nl")
    val names = stops.map { it.flag }.distinct().mapNotNull { flag ->
        val cps = flag.codePoints().toArray()
        if (cps.size != 2) null else java.util.Locale.Builder().setRegion(cps.joinToString("") { (it - 0x1F1E6 + 'A'.code).toChar().toString() }).build().getDisplayCountry(nl)
    }
    return when (names.size) {
        0 -> ""
        1 -> names[0]
        else -> names.dropLast(1).joinToString(", ") + " en " + names.last()
    }
}

/** Logo and date along the top, the title, the subtitle and the numbers. */
@Composable
private fun Head(data: PosterData, u: Dp, ink: Ink, center: Boolean = false, onPhoto: Boolean = false) {
    val text = if (onPhoto) Color.White else ink.text
    val soft = if (onPhoto) Color.White.copy(alpha = 0.82f) else ink.soft
    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (center) Alignment.CenterHorizontally else Alignment.Start) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            LineIcon(Glyphs.logo, data.accent, size = u * 0.05f, stroke = 2.2f)
            Text("MarkMySteps", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = (u * 0.032f).sp(), color = text), modifier = Modifier.padding(start = u * 0.015f).weight(1f))
            Text(monthLabel(data.trip), style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = (u * 0.03f).sp(), color = soft))
        }
        Text(
            data.trip.title, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = if (center) TextAlign.Center else TextAlign.Start,
            style = TextStyle(fontFamily = Fraunces, fontWeight = FontWeight(600), fontSize = (u * 0.095f).sp(), lineHeight = (u * 0.1f).sp(), letterSpacing = (-0.01).em, color = text),
            modifier = Modifier.padding(top = u * 0.05f),
        )
        Text(
            subtitle(data.trip), maxLines = 1,
            style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = (u * 0.034f).sp(), color = soft),
            modifier = Modifier.padding(top = u * 0.012f),
        )
    }
}

@Composable
private fun InlineFacts(data: PosterData, u: Dp, ink: Ink, center: Boolean = false) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (center) Arrangement.spacedBy(u * 0.07f, Alignment.CenterHorizontally) else Arrangement.spacedBy(u * 0.07f)) {
        data.facts.forEach { (v, l) ->
            Column(horizontalAlignment = if (center) Alignment.CenterHorizontally else Alignment.Start) {
                Text(v, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = (u * 0.065f).sp(), letterSpacing = (-0.02).em, color = ink.text))
                Text(l, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = (u * 0.028f).sp(), color = ink.soft))
            }
        }
    }
}

/** Head, the route on the globe with a card of the stops, and a row of photos. */
@Composable
private fun RoutePoster(data: PosterData, format: Format, u: Dp, ink: Ink) {
    val (lon, lat, zoom) = remember(data.trip) { tripFrame(data.trip) }
    val m = u * 0.065f
    Column(Modifier.fillMaxSize().padding(m)) {
        Head(data, u, ink)
        Spacer(Modifier.height(u * 0.04f))
        InlineFacts(data, u, ink)
        BoxWithConstraints(Modifier.padding(top = u * 0.05f).fillMaxWidth().weight(1f).clip(RoundedCornerShape(u * 0.05f))) {
            val card = format != Format.Square
            // The globe's scale follows the panel's short side; a wide, low panel needs more zoom.
            val wide = (maxWidth / maxHeight).coerceIn(1f, 2.2f)
            Globe(listOf(data.trip), globeStyle(data.dark, 3.4f), Modifier.fillMaxSize(), centerLon = lon, centerLat = lat, zoom = zoom * (if (card) 0.6f else 0.75f) * (0.55f + 0.45f * wide), showStops = true, turnable = false, shiftX = if (card) 0.17f else 0f)
            if (card) Column(
                Modifier.padding(u * 0.03f).clip(RoundedCornerShape(u * 0.035f)).background(ink.bg.copy(alpha = 0.88f)).padding(horizontal = u * 0.035f, vertical = u * 0.025f),
                verticalArrangement = Arrangement.spacedBy(u * 0.012f),
            ) {
                data.trip.stops.take(6).forEachIndexed { i, s ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        StopBadge(i, data.accent, u * 0.045f)
                        Text(s.name, maxLines = 1, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = (u * 0.03f).sp(), color = ink.text), modifier = Modifier.padding(start = u * 0.02f))
                    }
                }
            }
        }
        // Three different places where there are, the best of each.
        val photos = (data.perStop.map { it.second }.sortedByDescending { it.showScore } + data.picked.highlights.sortedByDescending { it.showScore })
            .distinct().take(3).sortedBy { it.photo.takenAt }
        if (photos.isNotEmpty()) {
            val weights = photos.map { it.aspect.coerceIn(0.7f, 1.5f) }
            val h = (u - m * 2 - u * 0.02f * (photos.size - 1)) / weights.sum()
            Row(Modifier.padding(top = u * 0.03f).fillMaxWidth().height(h), horizontalArrangement = Arrangement.spacedBy(u * 0.02f)) {
                photos.forEachIndexed { i, r -> PosterPhoto(r, Modifier.weight(weights[i]).fillMaxHeight().clip(RoundedCornerShape(u * 0.03f))) }
            }
        }
    }
}

/** Only photos, edge to edge, each in a slot of its own shape, the title over the bottom. */
@Composable
private fun PhotosPoster(data: PosterData, format: Format, u: Dp) {
    val count = when (format) { Format.Story -> 6; Format.Post -> 5; Format.Square -> 4 }
    val photos = remember(data, format) { data.picked.highlights.sortedByDescending { it.showScore }.take(count).sortedBy { it.photo.takenAt } }
    val layout = remember(photos, format) { if (photos.isEmpty()) null else arrange(photos.map { it.aspect }, format.aspect, gap = 0.008f) }
    val h = u / format.aspect
    Box(Modifier.fillMaxSize()) {
        layout?.slots?.forEach { s ->
            PosterPhoto(photos[s.index], Modifier.offset(x = u * s.x, y = h * s.y).size(u * s.w, h * s.h))
        }
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.55f to Color.Transparent, 1f to Color(0xCC000000))))
        Box(Modifier.fillMaxWidth().height(u * 0.2f).background(Brush.verticalGradient(listOf(Color(0x66000000), Color.Transparent))))
        Row(Modifier.padding(u * 0.06f), verticalAlignment = Alignment.CenterVertically) {
            LineIcon(Glyphs.logo, Color.White, size = u * 0.05f, stroke = 2.2f)
            Text("MarkMySteps", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = (u * 0.032f).sp(), color = Color.White), modifier = Modifier.padding(start = u * 0.015f))
        }
        Column(Modifier.align(Alignment.BottomStart).padding(u * 0.065f)) {
            Text(subtitle(data.trip).uppercase(), style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(650), fontSize = (u * 0.03f).sp(), letterSpacing = 0.08.em, color = Color.White.copy(alpha = 0.85f)))
            Text(
                data.trip.title, maxLines = 2,
                style = TextStyle(fontFamily = Fraunces, fontWeight = FontWeight(600), fontSize = (u * 0.1f).sp(), lineHeight = (u * 0.105f).sp(), color = Color.White),
                modifier = Modifier.padding(top = u * 0.01f),
            )
            Text(data.facts.joinToString("  ·  ") { "${it.first} ${it.second}" }, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = (u * 0.032f).sp(), color = Color.White.copy(alpha = 0.85f)), modifier = Modifier.padding(top = u * 0.015f))
        }
    }
}

/** Centred: the numbers, the globe, and a photo per stop with its name. */
@Composable
private fun RibbonPoster(data: PosterData, format: Format, u: Dp, ink: Ink) {
    val (lon, lat, zoom) = remember(data.trip) { tripFrame(data.trip) }
    val m = u * 0.065f
    val stops = data.perStop.take(if (format == Format.Square) 3 else 4)
    Column(Modifier.fillMaxSize().padding(m), horizontalAlignment = Alignment.CenterHorizontally) {
        Head(data, u, ink, center = true)
        Spacer(Modifier.height(u * 0.04f))
        InlineFacts(data, u, ink, center = true)
        Box(Modifier.padding(vertical = u * 0.04f).weight(1f).aspectRatio(1f, matchHeightConstraintsFirst = true).clip(CircleShape)) {
            Globe(listOf(data.trip), globeStyle(data.dark, 3f), Modifier.fillMaxSize(), centerLon = lon, centerLat = lat, zoom = (zoom * 0.62f).coerceAtLeast(1.4f), showStops = true, turnable = false)
        }
        val grid = format == Format.Story && stops.size == 4
        val rows = if (grid) stops.chunked(2) else listOf(stops)
        Column(verticalArrangement = Arrangement.spacedBy(u * 0.025f)) {
            rows.forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(u * 0.025f)) {
                    row.forEach { (i, r) ->
                        Column(Modifier.weight(1f)) {
                            PosterPhoto(r, Modifier.fillMaxWidth().aspectRatio(if (grid) 1.25f else 0.8f).clip(RoundedCornerShape(u * 0.03f)))
                            Row(Modifier.padding(top = u * 0.015f), verticalAlignment = Alignment.CenterVertically) {
                                StopBadge(i, data.accent, u * 0.04f)
                                Text(data.trip.stops[i].name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = (u * 0.028f).sp(), color = ink.text), modifier = Modifier.padding(start = u * 0.015f))
                            }
                        }
                    }
                }
            }
        }
    }
}

/** One photo full-bleed, the route as a small globe, and the numbers big. */
@Composable
private fun StatsPoster(data: PosterData, format: Format, u: Dp) {
    val hero = data.picked.cover ?: data.picked.highlights.firstOrNull()
    val (lon, lat, zoom) = remember(data.trip) { tripFrame(data.trip) }
    // A square has less height: smaller numbers and title, so the flags still fit.
    val k = if (format == Format.Square) 0.78f else 1f
    Box(Modifier.fillMaxSize()) {
        if (hero != null) PosterPhoto(hero, Modifier.fillMaxSize())
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0f to Color(0x80000000), 0.3f to Color(0x1A000000), 0.55f to Color(0x33000000), 1f to Color(0xE6000000))))
        Column(Modifier.fillMaxSize().padding(u * 0.065f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                LineIcon(Glyphs.logo, Color.White, size = u * 0.05f, stroke = 2.2f)
                Text("MarkMySteps", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = (u * 0.032f).sp(), color = Color.White), modifier = Modifier.padding(start = u * 0.015f).weight(1f))
                Box(Modifier.size(u * 0.2f).clip(CircleShape)) {
                    Globe(listOf(data.trip), globeStyle(true, 2.6f), Modifier.fillMaxSize(), centerLon = lon, centerLat = lat, zoom = (zoom * 0.26f).coerceAtLeast(1.3f), turnable = false)
                }
            }
            Spacer(Modifier.weight(1f))
            Text(
                data.trip.title, maxLines = 2,
                style = TextStyle(fontFamily = Fraunces, fontWeight = FontWeight(600), fontSize = (u * 0.1f * k).sp(), lineHeight = (u * 0.105f * k).sp(), color = Color.White),
            )
            Text(data.trip.dates, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = (u * 0.034f).sp(), color = Color.White.copy(alpha = 0.85f)), modifier = Modifier.padding(top = u * 0.01f, bottom = u * 0.05f * k))
            data.facts.chunked(2).forEach { pair ->
                Row(Modifier.fillMaxWidth().padding(bottom = u * 0.035f * k)) {
                    pair.forEach { (v, l) ->
                        Column(Modifier.weight(1f)) {
                            Text(v, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = (u * 0.12f * k).sp(), lineHeight = (u * 0.12f * k).sp(), letterSpacing = (-0.03).em, color = Color.White))
                            Text(l.uppercase(), style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(650), fontSize = (u * 0.028f).sp(), letterSpacing = 0.08.em, color = data.accent.copy(alpha = 1f)))
                        }
                    }
                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                }
            }
            Text(data.trip.stops.map { it.flag }.distinct().joinToString("  "), style = TextStyle(fontSize = (u * 0.05f).sp()))
        }
    }
}
