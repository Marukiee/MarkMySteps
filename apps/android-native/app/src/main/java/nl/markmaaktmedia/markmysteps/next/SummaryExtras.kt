package nl.markmaaktmedia.markmysteps.next

import android.graphics.Bitmap
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.luminance
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/*
 * The summary's choices beyond template and format, as the web's SummaryStudio: which part of the trip, the
 * theme, what goes under the title, the logo, the weather, a page per stop, photos swapped by hand; and the
 * versions kept on the server (POST/GET/PATCH/DELETE /api/trips/:id/summaries).
 */

enum class Scope { Trip, Day, Range }
enum class SubtitleKind { Auto, Countries, Stops, Place, None }

data class SummaryOptions(
    val scope: Scope = Scope.Trip,
    val from: LocalDate? = null,
    val to: LocalDate? = null,
    /** null follows the app. */
    val dark: Boolean? = null,
    val subtitle: SubtitleKind = SubtitleKind.Auto,
    val customSubtitle: String = "",
    val logo: Boolean = true,
    val weather: Boolean = false,
    val series: Boolean = false,
) {
    fun spec(template: Template, format: Format): String = JSONObject()
        .put("template", template.name.lowercase()).put("format", format.name.lowercase())
        .put("scope", scope.name.lowercase()).put("from", from?.toString() ?: JSONObject.NULL).put("to", to?.toString() ?: JSONObject.NULL)
        .put("theme", when (dark) { true -> "dark"; false -> "light"; null -> "auto" })
        .put("subtitle", if (customSubtitle.isNotBlank()) "custom" else subtitle.name.lowercase()).put("customSubtitle", customSubtitle)
        .put("logo", logo).put("weather", weather).put("series", series).toString()
}

/** The weather of a stretch of days at one place: the most common sky and the warmest it got. */
data class Weather(val glyph: List<Shape24>, val maxC: Int)

/** The days the trip covers, first to last. */
fun tripDays(trip: Trip): List<LocalDate> {
    val start = trip.start ?: return emptyList()
    return (0 until trip.days.coerceAtLeast(1)).map { start.plusDays(it.toLong()) }
}

/** The stretch the options ask for, or null for the whole trip. */
fun scopeRange(trip: Trip, o: SummaryOptions): Pair<LocalDate, LocalDate>? {
    val days = tripDays(trip)
    if (o.scope == Scope.Trip || days.isEmpty()) return null
    val from = o.from?.coerceIn(days.first(), days.last()) ?: days.first()
    val to = if (o.scope == Scope.Day) from else (o.to?.coerceIn(from, days.last()) ?: days.last())
    return from to to
}

private fun stopEnd(s: Stop): LocalDate? = s.start?.plusDays(s.nights.coerceAtLeast(1).toLong() - 1)

/**
 * The trip and its picked photos cut to the stretch: the stops you were at then, the days, the photos of those
 * days, and the dates and day count of the stretch. The title stays the trip's.
 */
fun scoped(trip: Trip, picked: Picked, o: SummaryOptions): Pair<Trip, Picked> {
    val range = scopeRange(trip, o) ?: return trip to picked
    val (from, to) = range
    val inRange = { d: LocalDate -> !d.isBefore(from) && !d.isAfter(to) }
    val stops = trip.stops.filter { s -> val a = s.start; val b = stopEnd(s); a != null && b != null && !b.isBefore(from) && !a.isAfter(to) }
    val days = picked.days.filter { inRange(it.date) }
    val highlights = picked.highlights.filter { inRange(it.photo.day(trip.stops)) }
    val pool = days.flatMap { it.photos }
    val photos = (highlights + pool).distinctBy { it.photo.id }
    val count = (ChronoUnit.DAYS.between(from, to) + 1).toInt()
    val dates = if (from == to) "${from.dayOfMonth} ${monthShort(from.monthValue)} ${from.year}" else "${from.dayOfMonth} ${monthShort(from.monthValue)} t/m ${to.dayOfMonth} ${monthShort(to.monthValue)} ${to.year}"
    val t = trip.copy(stops = stops.ifEmpty { trip.stops }, days = count, dates = dates, start = from, km = if (count == trip.days) trip.km else null)
    val p = picked.copy(
        days = days,
        highlights = photos.sortedByDescending { it.showScore }.take(maxOf(picked.highlights.size, 8)),
        cover = photos.maxByOrNull { it.showScore } ?: picked.cover,
        photoCount = pool.size.takeIf { it > 0 } ?: picked.photoCount,
    )
    return t to p
}

private fun monthShort(m: Int): String = java.time.Month.of(m).getDisplayName(java.time.format.TextStyle.SHORT, java.util.Locale.forLanguageTag(Lang.current)).trimEnd('.')

/** The line under the title, as chosen. Null means the poster's own automatic line. */
fun subtitleFor(trip: Trip, o: SummaryOptions): String? {
    if (o.customSubtitle.isNotBlank()) return o.customSubtitle.trim()
    val stops = trip.stops
    return when (o.subtitle) {
        SubtitleKind.Auto -> if (o.scope != Scope.Trip) stops.firstOrNull()?.let { "${it.flag} ${it.name}" } else null
        SubtitleKind.Countries -> countryLine(stops)
        SubtitleKind.Stops -> stops.joinToString(" · ") { it.name }
        SubtitleKind.Place -> stops.maxByOrNull { it.nights }?.let { "${it.flag} ${it.name}" } ?: ""
        SubtitleKind.None -> ""
    }
}

private fun countryLine(stops: List<Stop>): String {
    val names = stops.map { it.flag }.distinct().mapNotNull { flag ->
        val cps = flag.codePoints().toArray()
        if (cps.size != 2) null else java.util.Locale.Builder().setRegion(cps.joinToString("") { (it - 0x1F1E6 + 'A'.code).toChar().toString() }).build()
            .getDisplayCountry(java.util.Locale.forLanguageTag(Lang.current))
    }
    return when (names.size) {
        0 -> ""
        1 -> names[0]
        else -> Lang.text(R.string.summary_and, names.dropLast(1).joinToString(", "), names.last())
    }
}

/**
 * The real weather of the stretch at the place you stayed longest, from Open-Meteo (as the web): the archive
 * for days past, the forecast for days to come. Only the place and the dates leave the phone.
 */
suspend fun weatherFor(trip: Trip): Weather? = withContext(Dispatchers.IO) {
    val start = trip.start ?: return@withContext null
    val end = start.plusDays((trip.days - 1).coerceAtLeast(0).toLong())
    val place = trip.stops.maxByOrNull { it.nights }?.at ?: trip.route.firstOrNull() ?: return@withContext null
    val past = end.isBefore(LocalDate.now().minusDays(5))
    val host = if (past) "https://archive-api.open-meteo.com/v1/archive" else "https://api.open-meteo.com/v1/forecast"
    val url = "$host?latitude=%.2f&longitude=%.2f&start_date=$start&end_date=$end&daily=weathercode,temperature_2m_max&timezone=auto".format(java.util.Locale.ROOT, place.second, place.first)
    runCatching {
        val c = (URL(url).openConnection() as HttpURLConnection).apply { connectTimeout = 8000; readTimeout = 8000 }
        val daily = JSONObject(c.inputStream.bufferedReader().readText()).getJSONObject("daily")
        val codes = daily.getJSONArray("weathercode").let { a -> (0 until a.length()).mapNotNull { if (a.isNull(it)) null else a.getInt(it) } }
        val temps = daily.getJSONArray("temperature_2m_max").let { a -> (0 until a.length()).mapNotNull { if (a.isNull(it)) null else a.getDouble(it) } }
        if (codes.isEmpty() || temps.isEmpty()) return@runCatching null
        val code = codes.groupingBy { it }.eachCount().maxBy { it.value }.key
        val glyph = when (code) {
            0, 1 -> Glyphs.sun
            2, 3, 45, 48 -> Glyphs.partly
            in 71..77, 85, 86 -> Glyphs.snow
            in 95..99 -> Glyphs.storm
            else -> Glyphs.rain
        }
        Weather(glyph, Math.round(temps.max()).toInt())
    }.getOrNull()
}

/** The facts of a scoped trip, as the book's tripFacts but in the app's language. */
fun scopedFacts(trip: Trip, picked: Picked): List<Pair<String, String>> {
    // Only known countries: a stop without one (its 📍) is not a second country.
    val countries = TripFigures.namedCountries(trip.stops)
    return buildList {
        add("${trip.days}" to Lang.text(R.string.summary_fact_days))
        trip.km?.takeIf { it > 0 }?.let { add("%,d".format(Lang.locale, it) to Lang.text(R.string.summary_fact_km)) }
        if (trip.stops.size > 1) add("${trip.stops.size}" to Lang.text(R.string.summary_fact_stops))
        if (countries > 1) add("$countries" to Lang.text(R.string.summary_fact_countries))
        else add("${picked.photoCount}" to Lang.text(R.string.summary_fact_photos))
    }.take(4)
}

/** The pages of a series: the chosen poster for the stretch, a page per stop you slept at, and the numbers. */
fun seriesStops(trip: Trip): List<Stop> = trip.stops.filter { it.nights > 0 }.take(10)

/** One stop's page: the trip cut to that stop's days, titled with its name. */
fun stopPage(trip: Trip, picked: Picked, stop: Stop, o: SummaryOptions): Pair<Trip, Picked> {
    val a = stop.start ?: return trip.copy(title = stop.name, stops = listOf(stop)) to picked
    val b = stopEnd(stop) ?: a
    val (t, p) = scoped(trip, picked, o.copy(scope = Scope.Range, from = a, to = b))
    return t.copy(title = stop.name, stops = listOf(stop)) to p
}

// The options sheet.

@Composable
fun SummaryOptionsSheet(trip: Trip, options: SummaryOptions, onChange: (SummaryOptions) -> Unit, onDismiss: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val days = remember(trip) { tripDays(trip) }
    AppSheet(onDismiss = onDismiss) {
        Column(Modifier.padding(horizontal = 16.dp).verticalScroll(rememberScrollState())) {
            Text(stringResource(R.string.summary_adjust), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 24.sp, color = cs.onSurface), modifier = Modifier.padding(start = 4.dp, bottom = 8.dp))
            Header(stringResource(R.string.summary_scope), top = true)
            Panel {
                Choices(listOf(Scope.Trip to stringResource(R.string.summary_scope_trip), Scope.Day to stringResource(R.string.summary_scope_day), Scope.Range to stringResource(R.string.summary_scope_range)), options.scope, { s ->
                    onChange(options.copy(scope = s, from = options.from ?: days.firstOrNull(), to = options.to ?: days.lastOrNull()))
                }, enabled = days.isNotEmpty())
                AnimatedVisibility(options.scope != Scope.Trip, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(stringResource(if (options.scope == Scope.Day) R.string.summary_scope_day else R.string.summary_scope_from), style = TitleStyle.copy(color = cs.onSurfaceVariant, fontSize = 14.sp))
                        DayChips(days, options.from) { onChange(options.copy(from = it, to = if (options.to != null && options.to.isBefore(it)) it else options.to)) }
                        if (options.scope == Scope.Range) {
                            Text(stringResource(R.string.summary_scope_to), style = TitleStyle.copy(color = cs.onSurfaceVariant, fontSize = 14.sp))
                            DayChips(days.filter { d -> options.from == null || !d.isBefore(options.from) }, options.to) { onChange(options.copy(to = it)) }
                        }
                    }
                }
            }
            // Whose tracked line the maps on the posters and in the book show (only with more than one).
            val lines = rememberRouteLines(trip)
            val walkers = remember(trip, lines) { lines.orEmpty().mapNotNull { l -> trip.members.firstOrNull { it.userId == l.userId } }.distinctBy { it.userId } }
            if (lines != null && walkers.size > 1) {
                val chosen = RouteChoice.users(trip, lines)
                Header(stringResource(R.string.map_routes_title))
                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    walkers.forEachIndexed { i, m ->
                        LayerRow(m, m.userId == Data.me?.id, legibleColor(trip.color, cs.background.luminance() < 0.5f), m.userId in chosen, null, i, walkers.size) {
                            RouteChoice.toggle(trip, lines, m.userId)
                            onChange(options.copy())
                        }
                    }
                }
            }
            Header(stringResource(R.string.summary_theme))
            Panel {
                Choices(listOf(null to stringResource(R.string.summary_theme_auto), false to stringResource(R.string.settings_theme_light), true to stringResource(R.string.settings_theme_dark)), options.dark, { onChange(options.copy(dark = it)) })
            }
            Header(stringResource(R.string.summary_subtitle))
            Panel {
                Choices(listOf(SubtitleKind.Auto to stringResource(R.string.summary_subtitle_auto), SubtitleKind.Countries to stringResource(R.string.summary_subtitle_countries), SubtitleKind.Stops to stringResource(R.string.summary_subtitle_stops)), options.subtitle.takeIf { options.customSubtitle.isBlank() }, { onChange(options.copy(subtitle = it, customSubtitle = "")) })
                Choices(listOf(SubtitleKind.Place to stringResource(R.string.summary_subtitle_place), SubtitleKind.None to stringResource(R.string.summary_subtitle_none)), options.subtitle.takeIf { options.customSubtitle.isBlank() }, { onChange(options.copy(subtitle = it, customSubtitle = "")) })
                FormField(stringResource(R.string.summary_subtitle_custom), options.customSubtitle, { onChange(options.copy(customSubtitle = it.take(80))) })
                Hint(stringResource(R.string.summary_subtitle_hint))
            }
            Spacer(Modifier.height(12.dp))
            Group(null, listOf(
                Item(BookGlyph, stringResource(R.string.summary_series), stringResource(R.string.summary_series_body), toggle = options.series, action = { onChange(options.copy(series = !options.series)) }),
                Item(Glyphs.logo, stringResource(R.string.summary_logo), stringResource(R.string.summary_logo_body), toggle = options.logo, action = { onChange(options.copy(logo = !options.logo)) }),
                Item(Glyphs.partly, stringResource(R.string.summary_weather), stringResource(R.string.summary_weather_body), toggle = options.weather, action = { onChange(options.copy(weather = !options.weather)) }),
            ))
            Spacer(Modifier.height(16.dp))
            Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
        }
    }
}

@Composable
private fun DayChips(days: List<LocalDate>, selected: LocalDate?, onPick: (LocalDate) -> Unit) {
    val cs = MaterialTheme.colorScheme
    val haptics = rememberHaptics()
    val all = remember { mutableStateOf(days) }.value
    LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        itemsIndexed(days) { _, d ->
            val on = d == selected
            val bg by androidx.compose.animation.animateColorAsState(if (on) cs.primary else cs.surfaceContainerHighest, MaterialTheme.motionScheme.fastEffectsSpec(), label = "chip")
            Column(
                Modifier.clip(RoundedCornerShape(16.dp)).background(bg).dip { if (!on) haptics(Haptic.Tick); onPick(d) }.padding(horizontal = 12.dp, vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(stringResource(R.string.summary_day, (all.indexOf(d).takeIf { it >= 0 } ?: 0) + 1), style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 11.sp, color = if (on) cs.onPrimary else cs.onSurfaceVariant))
                Text("${d.dayOfMonth} ${monthShort(d.monthValue)}", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 15.sp, color = if (on) cs.onPrimary else cs.onSurface))
            }
        }
    }
}

// Versions on the server.

data class SummaryVersion(val id: String, val title: String, val template: String, val scopeLabel: String, val at: String, val by: String, val pages: List<Pair<Int, Int>>)

object SummaryRemote {
    suspend fun list(trip: Trip): List<SummaryVersion> {
        val a = JSONArray(Api.get("/api/trips/${trip.remoteId}/summaries"))
        return (0 until a.length()).map { a.getJSONObject(it) }.map { o ->
            val pages = o.optJSONArray("pages")
            SummaryVersion(
                o.getString("id"), o.optString("title"), o.optString("template"), o.optString("scopeLabel"), o.optString("createdAt"),
                o.optJSONObject("createdBy")?.optString("displayName").orEmpty(),
                (0 until (pages?.length() ?: 0)).map { i -> pages!!.getJSONObject(i).let { it.optInt("width") to it.optInt("height") } },
            )
        }
    }

    /** Saves the pages (PNG) as a new version. */
    suspend fun save(trip: Trip, title: String, template: Template, scopeLabel: String, spec: String, pages: List<Bitmap>) {
        val files = withContext(Dispatchers.Default) {
            pages.mapIndexed { i, b -> "page-${i + 1}.png" to java.io.ByteArrayOutputStream().also { b.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray() }
        }
        Api.uploadMany(
            "/api/trips/${trip.remoteId}/summaries", "pages", files, "image/png",
            mapOf(
                "title" to title, "template" to template.name.lowercase(), "scopeLabel" to scopeLabel, "spec" to spec,
                "widths" to pages.joinToString(",") { it.width.toString() }, "heights" to pages.joinToString(",") { it.height.toString() },
            ),
        )
    }

    suspend fun rename(trip: Trip, id: String, title: String) { Api.send("PATCH", "/api/trips/${trip.remoteId}/summaries/$id", JSONObject().put("title", title.trim().take(120))) }
    suspend fun delete(trip: Trip, id: String) { Api.send("DELETE", "/api/trips/${trip.remoteId}/summaries/$id") }
    fun pagePath(trip: Trip, id: String, index: Int) = "/api/trips/${trip.remoteId}/summaries/$id/pages/$index"
}

/** The versions kept on the server: each with its first page, who made it and when; share, rename or delete. */
@Composable
fun SummaryVersionsSheet(trip: Trip, onDismiss: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    var stamp by remember { mutableStateOf(0) }
    val list by produceState<List<SummaryVersion>?>(null, stamp) { value = runCatching { SummaryRemote.list(trip) }.getOrDefault(emptyList()) }
    var renaming by remember { mutableStateOf<SummaryVersion?>(null) }
    var deleting by remember { mutableStateOf<SummaryVersion?>(null) }
    var name by remember { mutableStateOf("") }
    AppSheet(onDismiss = onDismiss) {
        Column(Modifier.padding(horizontal = 16.dp).verticalScroll(rememberScrollState())) {
            Text(stringResource(R.string.summary_versions), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 24.sp, color = cs.onSurface), modifier = Modifier.padding(start = 4.dp, bottom = 10.dp))
            val l = list
            when {
                l == null -> Placeholder(Modifier.fillMaxWidth().height(96.dp).clip(RoundedCornerShape(24.dp)))
                l.isEmpty() -> Panel { Hint(stringResource(R.string.summary_versions_empty)) }
                else -> Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    l.forEachIndexed { i, v ->
                        Row(Modifier.fillMaxWidth().clip(slabShape(i, l.size)).background(cs.surfaceContainerHigh).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                            val thumb by produceState<Bitmap?>(null, v.id) { value = runCatching { Photos.loadPath("summary/${v.id}/0", SummaryRemote.pagePath(trip, v.id, 0)) }.getOrNull() }
                            Box(Modifier.size(56.dp, 72.dp).clip(RoundedCornerShape(10.dp)).background(cs.surfaceContainerHighest)) {
                                thumb?.let { androidx.compose.foundation.Image(it.asImageBitmap(), null, Modifier.size(56.dp, 72.dp), contentScale = ContentScale.Crop) }
                            }
                            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                                Text(v.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = TitleStyle.copy(color = cs.onSurface))
                                Text(
                                    stringResource(R.string.summary_version_by, pluralStringResource(R.plurals.summary_pages, v.pages.size, v.pages.size), shortDate(v.at.take(10)), v.by),
                                    maxLines = 2, style = ValueStyle.copy(color = cs.onSurfaceVariant),
                                )
                            }
                            var menu by remember { mutableStateOf(false) }
                            Box {
                                Box(Modifier.size(44.dp).clip(CircleShape).dip { menu = true }, contentAlignment = Alignment.Center) { LineIcon(Glyphs.dotsCircles, cs.onSurfaceVariant, size = 20.dp) }
                                AppMenu(menu, { menu = false }, groups = listOf(
                                    listOf(
                                        MenuEntry(stringResource(R.string.summary_share), Glyphs.share) {
                                            scope.launch {
                                                val uris = withContext(Dispatchers.IO) {
                                                    v.pages.indices.mapNotNull { idx -> Api.bytes(SummaryRemote.pagePath(trip, v.id, idx))?.let { bytes ->
                                                        val dir = java.io.File(context.cacheDir, "shared").apply { mkdirs() }
                                                        val f = java.io.File(dir, "${v.title.filter { it.isLetterOrDigit() || it == ' ' }.ifBlank { "summary" }}-${idx + 1}.png").apply { writeBytes(bytes) }
                                                        androidx.core.content.FileProvider.getUriForFile(context, context.packageName + ".files", f)
                                                    } }
                                                }
                                                if (uris.isNotEmpty()) runCatching {
                                                    context.startActivity(android.content.Intent.createChooser(
                                                        android.content.Intent(android.content.Intent.ACTION_SEND_MULTIPLE).setType("image/png")
                                                            .putParcelableArrayListExtra(android.content.Intent.EXTRA_STREAM, ArrayList(uris)).addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION),
                                                        v.title,
                                                    ))
                                                }
                                            }
                                        },
                                        MenuEntry(stringResource(R.string.summary_rename), Glyphs.pencil) { name = v.title; renaming = v },
                                    ),
                                    listOf(MenuEntry(stringResource(R.string.summary_delete), Glyphs.trash, danger = true) { deleting = v }),
                                ))
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
            Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
        }
    }
    renaming?.let { v ->
        Confirm(stringResource(R.string.summary_rename), "", stringResource(R.string.summary_rename), danger = false,
            onConfirm = { scope.launch { runCatching { SummaryRemote.rename(trip, v.id, name) }; stamp++ } }, onDismiss = { renaming = null },
            extra = { FormField(stringResource(R.string.summary_name), name, { name = it }) }, confirmEnabled = name.isNotBlank())
    }
    deleting?.let { v ->
        Confirm(stringResource(R.string.summary_delete_title), stringResource(R.string.summary_delete_body, v.title), stringResource(R.string.summary_delete),
            onConfirm = { scope.launch { runCatching { SummaryRemote.delete(trip, v.id) }; stamp++ } }, onDismiss = { deleting = null })
    }
}
