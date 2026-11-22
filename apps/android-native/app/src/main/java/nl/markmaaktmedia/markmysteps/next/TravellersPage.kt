package nl.markmaaktmedia.markmysteps.next

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.material3.toShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt

/*
 * Reizigers, as in the web app: your own figures first (they are why you open
 * the page), the countries you have been to, then the people on your trips.
 *
 * Expressive: each figure a big number on a tonal tile in a shape of its own,
 * the numbers counting up as the page arrives, the people as one slab of rows.
 */

private fun Modifier.tap(onClick: () -> Unit = {}): Modifier = composed {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.96f else 1f, MaterialTheme.motionScheme.fastSpatialSpec(), label = "tap")
    // A light tick under the finger on every tap, as Tandem and PixelPlayer do.
    val haptics = androidx.compose.ui.platform.LocalHapticFeedback.current
    clickable(source, ripple(), onClick = { haptics.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.ContextClick); onClick() }).graphicsLayer { scaleX = scale; scaleY = scale }
}

private class Stat(val value: Int, val label: String, val icon: List<Shape24>, val shape: androidx.graphics.shapes.RoundedPolygon)

private data class Friend(val name: String, val handle: String, val color: Color, val shared: Int, val id: String? = null, val hasAvatar: Boolean = false)

private val Friends = listOf(
    Friend("Sanne", "sanne", Color(0xFFD9A441), 3),
    Friend("Joris", "joris", Color(0xFF5B8DEF), 2),
    Friend("Lotte", "lotte", Color(0xFF2BB6A8), 1),
    Friend("Daan", "daan", Color(0xFF7A5BD6), 1),
)

private fun dots(n: Int) = "%,d".format(n).replace(',', '.')

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TravellersPage() {
    var openFriend by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf<Friend?>(null) }
    // A companion's own page slides in over the list; back follows the finger with the list already
    // showing underneath, the same seekable shared-axis transition as Settings, the pages and Tandem.
    val state = androidx.compose.runtime.remember { androidx.compose.animation.core.SeekableTransitionState<Friend?>(null) }
    androidx.compose.runtime.LaunchedEffect(openFriend) { if (state.targetState != openFriend) state.animateTo(openFriend) }
    androidx.activity.compose.PredictiveBackHandler(enabled = openFriend != null) { events ->
        try {
            events.collect { state.seekTo(it.progress, null) }
            state.animateTo(null)
            openFriend = null
        } catch (e: kotlin.coroutines.cancellation.CancellationException) {
            kotlinx.coroutines.withContext(kotlinx.coroutines.NonCancellable) { state.snapTo(openFriend) }
            throw e
        }
    }
    val emphasized = androidx.compose.animation.core.CubicBezierEasing(0.2f, 0f, 0f, 1f)
    val ease = androidx.compose.animation.core.tween<Float>(350, easing = emphasized)
    val slide = androidx.compose.animation.core.tween<androidx.compose.ui.unit.IntOffset>(350, easing = emphasized)
    androidx.compose.animation.core.rememberTransition(state, label = "friend").AnimatedContent(
        transitionSpec = {
            if (targetState != null) {
                (androidx.compose.animation.slideInHorizontally(slide) { it / 3 } + androidx.compose.animation.fadeIn(ease)) togetherWith
                    (androidx.compose.animation.slideOutHorizontally(slide) { -it / 3 } + androidx.compose.animation.scaleOut(ease, targetScale = 0.92f))
            } else {
                ((androidx.compose.animation.slideInHorizontally(slide) { -it / 3 } + androidx.compose.animation.fadeIn(ease)) togetherWith
                    (androidx.compose.animation.slideOutHorizontally(androidx.compose.animation.core.tween(350, easing = androidx.compose.animation.core.Easing { f -> f * f * f })) { it } +
                        androidx.compose.animation.scaleOut(ease, targetScale = 0.85f)))
                    .apply { targetContentZIndex = -1f }
            }
        },
        contentKey = { it?.id ?: it?.name },
    ) { friend ->
        Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
            if (friend == null) TravellersList(onFriend = { openFriend = it })
            else FriendPage(friend, onBack = { openFriend = null })
        }
    }
}

@Composable
private fun TravellersList(onFriend: (Friend) -> Unit) {
    val cs = MaterialTheme.colorScheme
    val trips = Data.past
    val countries = Data.all.flatMap { t -> t.stops.map { it.flag } }.distinct()
    val names = mapOf(
        "🇮🇸" to "IJsland", "🇩🇰" to "Denemarken", "🇸🇪" to "Zweden", "🇮🇹" to "Italië", "🇵🇹" to "Portugal",
        "🇲🇦" to "Marokko", "🇳🇴" to "Noorwegen", "🇬🇪" to "Georgië",
    )
    val visited = trips.flatMap { t -> t.stops.map { it.flag } }.distinct()
    // Signed in, the figures come from the server (as on the web); the demo counts its own trips.
    val me = Data.me
    val live by androidx.compose.runtime.produceState<Remote.Stats?>(null, me?.id, Data.version) {
        if (Data.live && me != null) value = runCatching { Remote.stats(me.id) }.getOrNull()
    }
    val friends by androidx.compose.runtime.produceState<List<Remote.Friend>?>(null, Data.version) {
        value = if (Data.live) runCatching { Remote.friends() }.getOrNull() else null
    }
    val stats = listOf(
        Stat(live?.trips ?: trips.size, "reizen", Glyphs.compass, MaterialShapes.Cookie9Sided),
        Stat(live?.countries?.size ?: visited.size, "landen", Glyphs.globe, MaterialShapes.Clover4Leaf),
        Stat(live?.km ?: trips.sumOf { it.km ?: 0 }, "kilometer", Glyphs.distance, MaterialShapes.Cookie6Sided),
        Stat(live?.days ?: trips.sumOf { it.days }, "dagen op reis", Glyphs.hourglass, MaterialShapes.Sunny),
        Stat(live?.photos ?: trips.sumOf { it.photos }, "foto's", Glyphs.camera, MaterialShapes.Flower),
        Stat(live?.flights ?: trips.sumOf { it.flights.size }, "vluchten", Glyphs.plane, MaterialShapes.SoftBurst),
    )
    val countryFlags = live?.countries?.map { Remote.flag(it) to java.util.Locale("", it).getDisplayCountry(java.util.Locale.forLanguageTag("nl-NL")) }

    val pageScroll = rememberScrollState()
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().background(cs.background).verticalScroll(pageScroll).padding(horizontal = 16.dp)) {
            Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
            Row(Modifier.fillMaxWidth().padding(top = 20.dp, bottom = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "Reizigers",
                    style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 32.sp, letterSpacing = (-0.02).em, color = cs.onBackground),
                    modifier = Modifier.weight(1f),
                )
                // Requests to join a trip and invitations land here, where the people are.
                var bell by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
                var unread by androidx.compose.runtime.remember { androidx.compose.runtime.mutableIntStateOf(0) }
                androidx.compose.runtime.LaunchedEffect(Data.version) { if (Data.live) unread = runCatching { Remote.noticeCount() }.getOrDefault(0) }
                Box(Modifier.size(48.dp).clip(CircleShape).background(cs.surfaceContainerHigh).tap { if (Data.live) bell = true }, contentAlignment = Alignment.Center) {
                    LineIcon(Glyphs.bell, cs.onSurface, size = 22.dp)
                    // The dot only when there is something unread or waiting for an answer.
                    if (unread > 0) Box(Modifier.align(Alignment.TopEnd).padding(top = 11.dp, end = 12.dp).size(9.dp).clip(CircleShape).background(cs.primary))
                }
                if (bell) NoticesSheet(onDismiss = { bell = false }, onChanged = { unread = 0 })
            }

            // Whose numbers these are.
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 14.dp)) {
                Avatar(me?.id, me?.name ?: "Mark", me?.hasAvatar == true, cs.primary, Modifier.size(52.dp), MaterialShapes.Cookie12Sided.toShape())
                Column(Modifier.weight(1f).padding(start = 14.dp)) {
                    Text(me?.name ?: "Mark", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 20.sp, color = cs.onSurface))
                    Text("Jouw statistieken", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = cs.onSurfaceVariant))
                }
            }

            if (Data.live && live == null) {
                // Signed in, the server's figures are awaited in the tiles' own shape, so nothing shows wrong numbers first.
                val tone = cs.surfaceContainerHigh
                repeat(3) { Row(Modifier.fillMaxWidth().padding(bottom = 3.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) { repeat(2) { Box(Modifier.weight(1f).height(112.dp).clip(RoundedCornerShape(8.dp)).background(tone)) } } }
            } else StatsGrid(stats)

            // The countries you have been to on a slowly turning globe, as on the web.
            if (Data.live && live == null) {
                // While the countries are read, the globe's own round shape holds its place, so nothing below jumps.
                Box(Modifier.fillMaxWidth().padding(top = 22.dp), contentAlignment = Alignment.Center) {
                    Box(Modifier.size(192.dp).clip(CircleShape).background(cs.surfaceContainerHigh))
                }
            } else if (!countryFlags.isNullOrEmpty() || !Data.live) {
                val codes = live?.countries ?: countries.mapNotNull { flagCode(it)?.uppercase() }
                Box(Modifier.fillMaxWidth().padding(top = 22.dp), contentAlignment = Alignment.Center) {
                    CountryGlobe(codes, dark = cs.background.luminance() < 0.5f, modifier = Modifier.size(200.dp))
                }
            }
            Text(
                "Landen",
                style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = cs.onSurfaceVariant),
                modifier = Modifier.padding(top = 24.dp, bottom = 10.dp),
            )
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                (countryFlags ?: countries.map { it to (names[it] ?: "") }).forEach { (flag, countryName) ->
                    val planned = countryFlags == null && flag !in visited
                    Row(
                        Modifier.height(40.dp).clip(CircleShape)
                            .background(if (planned) cs.surfaceContainerLow else cs.secondaryContainer)
                            .padding(start = 10.dp, end = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        FlagIcon(flag, 15.dp)
                        Text(
                            countryName,
                            style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = if (planned) cs.onSurfaceVariant else cs.onSecondaryContainer),
                            modifier = Modifier.padding(start = 8.dp),
                        )
                        if (planned) {
                            LineIcon(Glyphs.hourglass, cs.onSurfaceVariant, size = 14.dp, stroke = 2f, modifier = Modifier)
                        }
                    }
                }
            }

            Text(
                "Mensen op je reizen",
                style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = cs.onSurfaceVariant),
                modifier = Modifier.padding(top = 28.dp, bottom = 4.dp),
            )
            Text(
                "Toevoegen doe je per reis: open een reis en tik op de mensen.",
                style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = cs.onSurfaceVariant),
                modifier = Modifier.padding(bottom = 12.dp),
            )
            val palette = listOf(Color(0xFFE8613C), Color(0xFF5B8DEF), Color(0xFF2BB6A8), Color(0xFFD9A441), Color(0xFF7A5BD6), Color(0xFFE34B8A), Color(0xFF4CAF50))
            // Each person their own colour behind their initial, stable per name.
            val people = friends?.map { Friend(it.name, it.username, personColor(it.id), it.sharedTrips, it.id, it.hasAvatar) } ?: if (Data.live) emptyList() else Friends
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                people.forEachIndexed { i, f ->
                    val shape = RoundedCornerShape(
                        topStart = if (i == 0) 26.dp else 6.dp, topEnd = if (i == 0) 26.dp else 6.dp,
                        bottomStart = if (i == people.lastIndex) 26.dp else 6.dp, bottomEnd = if (i == people.lastIndex) 26.dp else 6.dp,
                    )
                    Row(
                        Modifier.fillMaxWidth().clip(shape).background(cs.surfaceContainerLow).tap { if (f.id != null) onFriend(f) }.padding(horizontal = 14.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Avatar(f.id, f.name, f.hasAvatar, f.color, Modifier.size(44.dp))
                        Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                            Text(f.name, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 17.sp, color = cs.onSurface))
                            Text(
                                "@${f.handle} · ${f.shared} ${if (f.shared == 1) "gedeelde reis" else "gedeelde reizen"}",
                                style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = cs.onSurfaceVariant),
                            )
                        }
                        LineIcon(Glyphs.chevronRight, cs.onSurfaceVariant, size = 18.dp, stroke = 2.2f)
                    }
                }
            }

            Spacer(Modifier.height(120.dp))
            Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
        }
        StatusScrim(pageScroll)
    }

}

/** A big number on a tonal tile, counting up when the page arrives; a small shape in the corner. */
@Composable
private fun StatTile(value: Int, label: String, icon: List<Shape24>, mark: Shape, shape: Shape, order: Int, modifier: Modifier) {
    val cs = MaterialTheme.colorScheme
    val count = remember { Animatable(0f) }
    val spec = MaterialTheme.motionScheme.slowEffectsSpec<Float>()
    LaunchedEffect(value) {
        kotlinx.coroutines.delay(60L * order)
        count.animateTo(value.toFloat(), spec)
    }
    val tones = listOf(cs.primaryContainer to cs.onPrimaryContainer, cs.secondaryContainer to cs.onSecondaryContainer, cs.tertiaryContainer to cs.onTertiaryContainer)
    val (bg, fg) = tones[order % tones.size]
    Box(modifier.height(112.dp).clip(shape).background(bg).tap().padding(16.dp)) {
        // The figure's icon on its own in the top right corner, as on the web.
        LineIcon(icon, fg.copy(alpha = 0.85f), size = 26.dp, stroke = 1.9f, modifier = Modifier.align(Alignment.TopEnd))
        Column(Modifier.align(Alignment.BottomStart)) {
            Text(
                dots(count.value.roundToInt()),
                style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 34.sp, letterSpacing = (-0.03).em, color = fg),
            )
            Text(label, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 13.sp, color = fg.copy(alpha = 0.8f)))
        }
    }
}


/** Two columns of tonal tiles, one connected block with round outer corners. */
@Composable
private fun StatsGrid(stats: List<Stat>) {
    stats.chunked(2).forEachIndexed { row, pair ->
        Row(Modifier.fillMaxWidth().padding(bottom = 3.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            pair.forEachIndexed { col, stat ->
                val i = row * 2 + col
                val last = stats.lastIndex
                val outer = 28.dp
                val inner = 8.dp
                val tileShape: Shape = RoundedCornerShape(
                    topStart = if (i == 0) outer else inner, topEnd = if (i == 1) outer else inner,
                    bottomStart = if (i == last - 1) outer else inner, bottomEnd = if (i == last) outer else inner,
                )
                StatTile(stat.value, stat.label, stat.icon, stat.shape.toShape(), tileShape, i, Modifier.weight(1f))
            }
        }
    }
}

/** A companion's own figures and countries, as the web's traveller page. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FriendPage(f: Friend, onBack: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val stats by androidx.compose.runtime.produceState<Remote.Stats?>(null, f.id) { value = f.id?.let { runCatching { Remote.stats(it) }.getOrNull() } }
    val scroll = rememberScrollState()
    Box(Modifier.fillMaxSize()) {
    Column(Modifier.fillMaxSize().background(cs.background).verticalScroll(scroll).padding(horizontal = 16.dp)) {
        Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
        Box(Modifier.padding(top = 8.dp).size(48.dp).clip(CircleShape).background(cs.surfaceContainerHigh).tap(onBack), contentAlignment = Alignment.Center) {
            LineIcon(listOf(P("M19 12H5"), P("m12 19-7-7 7-7")), cs.onSurface, size = 22.dp, stroke = 2.2f)
        }
        Row(Modifier.padding(top = 18.dp, bottom = 18.dp), verticalAlignment = Alignment.CenterVertically) {
            Avatar(f.id, f.name, f.hasAvatar, f.color, Modifier.size(64.dp))
            Column(Modifier.padding(start = 16.dp)) {
                Text(f.name, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 28.sp, letterSpacing = (-0.02).em, color = cs.onBackground))
                Text("@${f.handle} · ${f.shared} ${if (f.shared == 1) "reis samen" else "reizen samen"}", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.5.sp, color = cs.onSurfaceVariant))
            }
        }
        val st = stats
        if (st == null) {
            // The tiles' own shape while the figures are read, so nothing jumps.
            repeat(3) { Row(Modifier.fillMaxWidth().padding(bottom = 3.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) { repeat(2) { Box(Modifier.weight(1f).height(112.dp).clip(RoundedCornerShape(8.dp)).background(cs.surfaceContainerHigh)) } } }
        } else {
            StatsGrid(listOf(
                Stat(st.trips, "reizen", Glyphs.compass, MaterialShapes.Cookie9Sided),
                Stat(st.countries.size, "landen", Glyphs.globe, MaterialShapes.Clover4Leaf),
                Stat(st.km, "kilometer", Glyphs.distance, MaterialShapes.Cookie6Sided),
                Stat(st.days, "dagen op reis", Glyphs.hourglass, MaterialShapes.Sunny),
                Stat(st.photos, "foto's", Glyphs.camera, MaterialShapes.Flower),
                Stat(st.flights, "vluchten", Glyphs.plane, MaterialShapes.SoftBurst),
            ))
            if (st.countries.isNotEmpty()) {
                Box(Modifier.fillMaxWidth().padding(top = 22.dp), contentAlignment = Alignment.Center) {
                    CountryGlobe(st.countries, dark = cs.background.luminance() < 0.5f, modifier = Modifier.size(200.dp))
                }
                FlowRow(Modifier.padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    st.countries.forEach { code ->
                        Row(Modifier.height(40.dp).clip(CircleShape).background(cs.secondaryContainer).padding(start = 10.dp, end = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                            FlagIcon(code, 15.dp)
                            Text(java.util.Locale("", code).getDisplayCountry(java.util.Locale.forLanguageTag("nl-NL")), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.onSecondaryContainer), modifier = Modifier.padding(start = 8.dp))
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(120.dp))
        Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
    }
    // Behind the clock once the page scrolls under it, as on every other page.
    StatusScrim(scroll)
    }
}
