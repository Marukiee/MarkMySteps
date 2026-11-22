package nl.markmaaktmedia.markmysteps.next

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/*
 * What is behind the figures on Reizigers, as on the web: every trip, country or flight with the way into
 * the trip it belongs to; the last few trips; and the green "onderweg" when someone is travelling now.
 */

/** Which list a tile opens. Distance, days and photos are per trip. */
enum class StatsKind { Trips, Countries, Flights, Places }

private val Nl = java.util.Locale.forLanguageTag("nl-NL")
private fun countryName(code: String) = java.util.Locale("", code.uppercase()).getDisplayCountry(Nl).ifBlank { code.uppercase() }
private fun stretch(from: String, to: String): String {
    val a = parseDay(from) ?: return ""; val b = parseDay(to) ?: a
    return if (a == b) shortDay(a) else shortRange(a, b, year = true)
}
private fun tripColor(hex: String?, fallback: Color) = hex?.takeIf { it.startsWith("#") }?.let { runCatching { Color(android.graphics.Color.parseColor(it)) }.getOrNull() } ?: fallback

/**
 * The list behind one tile, in the app's sheet: rows that step in, each with "Ga naar reis". A trip you are
 * not on opens its ask-to-look-along page, as the web does.
 */
@Composable
fun StatsListSheet(kind: StatsKind, lists: SocialRemote.Lists, onDismiss: () -> Unit, onGo: (String) -> Unit) {
    val cs = MaterialTheme.colorScheme
    val count = when (kind) { StatsKind.Trips -> lists.trips.size; StatsKind.Countries -> lists.countries.size; StatsKind.Flights -> lists.flights.size; StatsKind.Places -> lists.places.size }
    val title = when (kind) {
        StatsKind.Trips -> plural(count, "reis", "reizen")
        StatsKind.Countries -> plural(count, "land", "landen")
        StatsKind.Flights -> plural(count, "vlucht", "vluchten")
        StatsKind.Places -> plural(count, "plaats", "plaatsen")
    }
    // The whole distance flown, or nothing: one flight without two known airports would make it quietly too low.
    val context = androidx.compose.ui.platform.LocalContext.current
    val airports by androidx.compose.runtime.produceState(FlightAirports.ready) { FlightAirports.load(context); value = true }
    val airKm = if (kind == StatsKind.Flights && airports && lists.flights.isNotEmpty()) runCatching {
        lists.flights.sumOf { f -> FlightAirports.km(FlightAirports.byCode(f.from.airport)!!, FlightAirports.byCode(f.to.airport)!!) }
    }.getOrNull() else null
    val maxH = (LocalConfiguration.current.screenHeightDp * 0.78f).dp
    AppSheet(onDismiss = onDismiss) {
        val sheet = this
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
            Text(title, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 24.sp, color = cs.onSurface))
            airKm?.let { Text("${"%,d".format(it).replace(',', '.')} km in de lucht", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 14.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 2.dp)) }
            val go: (String) -> Unit = { id -> sheet.close(); onGo(id) }
            LazyColumn(Modifier.padding(top = 14.dp).heightIn(max = maxH), verticalArrangement = Arrangement.spacedBy(3.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 24.dp)) {
                when (kind) {
                    StatsKind.Trips -> itemsIndexed(lists.trips, key = { _, t -> t.id }) { i, t ->
                        Slab(i, lists.trips.size) {
                            Visit(
                                dot = tripColor(t.color, cs.primary), title = t.title, line = stretch(t.from, t.to),
                                second = listOfNotNull(plural(t.days, "dag", "dagen"), t.km.takeIf { it > 0 }?.let { "${"%,d".format(it).replace(',', '.')} km" }, plural(t.photos, "foto", "foto's")).joinToString(" · "),
                                onGo = { go(t.id) },
                            )
                        }
                    }
                    StatsKind.Countries -> itemsIndexed(lists.countries, key = { _, c -> c.code }) { i, c ->
                        Slab(i, lists.countries.size) {
                            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 4.dp)) {
                                FlagIcon(Remote.flag(c.code), 15.dp)
                                Text(countryName(c.code), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 17.sp, color = cs.onSurface), modifier = Modifier.padding(start = 8.dp))
                            }
                            c.visits.forEach { v -> Visit(null, v.tripTitle, listOf(stretch(v.from, v.to), v.places.joinToString(", ")).filter { it.isNotBlank() }.joinToString(" · "), null, small = true) { go(v.tripId) } }
                        }
                    }
                    StatsKind.Places -> itemsIndexed(lists.places, key = { _, p -> "${p.countryCode}/${p.name}" }) { i, p ->
                        Slab(i, lists.places.size) {
                            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 4.dp)) {
                                p.countryCode?.let { FlagIcon(Remote.flag(it), 15.dp, Modifier.padding(end = 8.dp)) }
                                Text(p.name, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 17.sp, color = cs.onSurface))
                            }
                            p.visits.forEach { v -> Visit(null, v.tripTitle, stretch(v.from, v.to), null, small = true) { go(v.tripId) } }
                        }
                    }
                    StatsKind.Flights -> {
                        // Out and back belong together: one block per trip, within it in the order they were flown.
                        val byTrip = lists.flights.groupBy { it.tripId }.values.map { it.sortedBy { f -> f.day } }
                        itemsIndexed(byTrip, key = { _, fl -> fl.first().tripId }) { i, fl ->
                            Slab(i, byTrip.size) {
                                Visit(null, fl.first().tripTitle, stretch(fl.first().day, fl.last().day), null) { go(fl.first().tripId) }
                                fl.forEach { f -> Ticket(f) { go(f.tripId) } }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Slab(i: Int, n: Int, content: @Composable () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val top = if (i == 0) 24.dp else 6.dp; val bottom = if (i == n - 1) 24.dp else 6.dp
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(top, top, bottom, bottom)).background(cs.surfaceContainerHigh).padding(horizontal = 14.dp, vertical = 12.dp)) { content() }
}

/** One stretch of one trip: its name and days, and "Ga naar reis". */
@Composable
private fun Visit(dot: Color?, title: String, line: String, second: String?, small: Boolean = false, onGo: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Row(Modifier.fillMaxWidth().padding(vertical = if (small) 3.dp else 0.dp), verticalAlignment = Alignment.CenterVertically) {
        if (dot != null) Box(Modifier.padding(end = 12.dp).size(12.dp).clip(CircleShape).background(dot))
        Column(Modifier.weight(1f)) {
            Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(if (small) 550 else 650), fontSize = if (small) 15.sp else 16.5.sp, color = cs.onSurface))
            if (line.isNotBlank()) Text(line, maxLines = 2, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = cs.onSurfaceVariant))
            second?.let { Text(it, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = cs.onSurfaceVariant)) }
        }
        GoButton(onGo)
    }
}

@Composable
private fun GoButton(onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val haptics = rememberHaptics()
    Row(
        Modifier.padding(start = 8.dp).clip(CircleShape).background(cs.secondaryContainer).clickable { haptics(Haptic.Tap); onClick() }.padding(start = 12.dp, end = 8.dp, top = 7.dp, bottom = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("Ga naar reis", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 13.sp, color = cs.onSecondaryContainer))
        LineIcon(Glyphs.chevronRight, cs.onSecondaryContainer, size = 15.dp, stroke = 2.2f, modifier = Modifier.padding(start = 2.dp))
    }
}

/** One flight as a boarding pass: the codes with a dashed arc between them, the places under them, the date on the stub. */
@Composable
private fun Ticket(f: SocialRemote.ListFlight, onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val day = parseDay(f.day)
    fun code(e: SocialRemote.FlightEnd) = e.airport ?: e.name?.take(3)?.uppercase() ?: "?"
    fun place(e: SocialRemote.FlightEnd) = e.name ?: FlightAirports.byCode(e.airport)?.city ?: ""
    val line = cs.outline
    Row(Modifier.padding(top = 8.dp).fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(cs.surfaceContainerLowest).clickable(onClick = onClick), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).padding(horizontal = 14.dp, vertical = 10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(code(f.from), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 20.sp, color = cs.onSurface))
                Box(Modifier.weight(1f).padding(horizontal = 10.dp).size(height = 18.dp, width = 1.dp).drawBehind {
                    val y = size.height * 0.7f
                    drawLine(line, androidx.compose.ui.geometry.Offset(0f, y), androidx.compose.ui.geometry.Offset(size.width, y), strokeWidth = 1.5.dp.toPx(),
                        pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 5.dp.toPx())))
                }, contentAlignment = Alignment.Center) { LineIcon(Glyphs.plane, cs.onSurfaceVariant, size = 15.dp, stroke = 1.8f, modifier = Modifier.background(cs.surfaceContainerLowest)) }
                Text(code(f.to), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 20.sp, color = cs.onSurface))
            }
            Row {
                Text(place(f.from), maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Inter, fontSize = 12.sp, color = cs.onSurfaceVariant), modifier = Modifier.weight(1f))
                Text(place(f.to), maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Inter, fontSize = 12.sp, color = cs.onSurfaceVariant))
            }
        }
        // The stub: the day big, the month small, set off by its own tone.
        Column(Modifier.background(cs.secondaryContainer).padding(horizontal = 14.dp, vertical = 14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("${day?.dayOfMonth ?: ""}", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 20.sp, color = cs.onSecondaryContainer))
            Text(day?.let { listOf("jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec")[it.monthValue - 1] } ?: "", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 12.sp, color = cs.onSecondaryContainer))
        }
    }
}

/** "Je laatste reizen" (or someone's): a dot in the trip's colour, its name and month, a tap opens it. */
@Composable
fun RecentTrips(trips: List<SocialRemote.Recent>, who: String?, onOpen: (String) -> Unit, modifier: Modifier = Modifier) {
    if (trips.isEmpty()) return
    val cs = MaterialTheme.colorScheme
    val months = listOf("januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december")
    Column(modifier) {
        Text(if (who != null) "Laatste reizen van $who" else "Je laatste reizen", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(bottom = 10.dp))
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            trips.forEachIndexed { i, t ->
                val top = if (i == 0) 26.dp else 6.dp; val bottom = if (i == trips.lastIndex) 26.dp else 6.dp
                val haptics = rememberHaptics()
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(top, top, bottom, bottom)).background(cs.surfaceContainerLow).clickable { haptics(Haptic.Tap); onOpen(t.id) }.padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(12.dp).clip(CircleShape).background(tripColor(t.color, cs.primary)))
                    Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                        Text(t.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 16.5.sp, color = cs.onSurface))
                        t.start?.let { Text("${months[it.monthValue - 1]} ${it.year}", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = cs.onSurfaceVariant)) }
                    }
                    LineIcon(Glyphs.chevronRight, cs.onSurfaceVariant, size = 18.dp, stroke = 2.2f)
                }
            }
        }
    }
}

/** The trip-ongoing green of the web, readable on light and dark. */
@Composable
private fun ongoingGreen(): Color = if (MaterialTheme.colorScheme.background.red < 0.5f) Color(0xFF5FD39E) else Color(0xFF0A7D55)

/** "onderweg" (or "2× onderweg") with a dot whose ring grows and fades, as the web's pulse. */
@Composable
fun OngoingPill(count: Int, modifier: Modifier = Modifier) {
    if (count <= 0) return
    val green = ongoingGreen()
    val t by rememberInfiniteTransition(label = "pulse").animateFloat(0f, 1f, infiniteRepeatable(tween(1800), RepeatMode.Restart), label = "ring")
    Row(modifier.clip(CircleShape).background(green.copy(alpha = 0.14f)).padding(start = 10.dp, end = 12.dp, top = 5.dp, bottom = 5.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(14.dp), contentAlignment = Alignment.Center) {
            Box(Modifier.size(14.dp).drawBehind { drawCircle(green.copy(alpha = (1f - t) * 0.45f), radius = size.minDimension / 2f * (0.5f + 0.5f * t)) })
            Box(Modifier.size(7.dp).clip(CircleShape).background(green))
        }
        Text(if (count == 1) "onderweg" else "$count× onderweg", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 13.sp, color = green), modifier = Modifier.padding(start = 6.dp))
    }
}
