package nl.markmaaktmedia.markmysteps.next

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.zIndex
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.compose.material3.Text
import androidx.compose.ui.res.stringResource

/*
 * The home page as it is today, ported from TripsPage.tsx and trips.css.
 * Sizes follow the stylesheet: 1rem is 16, the body text 15, the page edge
 * 1.25rem. Where the web has a small correction of its own (the meta line
 * 1.5px lower so it sits level with the faces, the globe running up under the
 * status bar, the brand nudged left by its own side bearing), it is here too.
 */

private val Edge = 20.dp

@Composable
fun HomeCurrent(onLogoTap: () -> Unit) {
    val c = LocalPalette.current
    val screenH = LocalConfiguration.current.screenHeightDp
    // .globe-backdrop: clamp(300px, 46vh, 540px), full bleed, under the status bar.
    val globeH = (screenH * 0.46f).coerceIn(300f, 540f).dp
    var tab by remember { mutableStateOf(0) }

    Box(Modifier.fillMaxSize().background(c.paper)) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            Box(Modifier.fillMaxWidth().height(globeH)) {
                Globe(
                    trips = DemoPast + DemoUpcoming,
                    style = GlobeStyle(sphere = c.sphere, land = c.land, dark = c.dark),
                    modifier = Modifier.fillMaxSize(),
                )
                // ::after: the last 42% fades into the page, solid from 75% of it.
                Box(
                    Modifier.fillMaxWidth().height(globeH * 0.42f).align(Alignment.BottomCenter)
                        .background(Brush.verticalGradient(0f to Color.Transparent, 0.75f to c.paper, 1f to c.paper)),
                )
                Column(Modifier.padding(start = Edge - 4.8.dp)) {
                    Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
                    Brand(Modifier.padding(top = 11.2.dp).clickable(onClick = onLogoTap))
                }
            }

            Column(Modifier.padding(horizontal = Edge)) {
                // margin-bottom: -2rem on the globe, margin-top: 2.7rem on the head.
                Spacer(Modifier.height(43.2.dp - 32.dp))
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        stringResource(R.string.nav_trips),
                        style = TextStyle(fontFamily = Fraunces, fontWeight = FontWeight(560), fontSize = 28.8.sp, letterSpacing = (-0.015).em, color = c.ink),
                        modifier = Modifier.weight(1f),
                    )
                    PrimaryButton(stringResource(R.string.home_new_trip), leading = Glyphs.plus)
                }
                Text(
                    stringResource(R.string.home_upcoming),
                    style = TextStyle(fontFamily = Fraunces, fontWeight = FontWeight(560), fontSize = 18.4.sp, letterSpacing = (-0.015).em, color = c.inkSoft),
                    modifier = Modifier.padding(top = 16.dp, bottom = 14.4.dp),
                )
                BigTripCard(DemoUpcoming)
                Tabs(tab, past = DemoPast.size, shared = DemoSharedCount, onTab = { tab = it }, modifier = Modifier.padding(top = 25.6.dp, bottom = 16.dp))
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    DemoPast.forEach { CompactTripCard(it) }
                }
                Spacer(Modifier.height(88.dp))
                Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
            }
        }
        BottomNav(Modifier.align(Alignment.BottomCenter))
    }
}

@Composable
private fun Brand(modifier: Modifier = Modifier) {
    val c = LocalPalette.current
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        LineIcon(Glyphs.logo, c.accent, size = 40.dp, stroke = 2.1f)
        Text(
            "MarkMySteps",
            style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(620), fontSize = 25.9.sp, letterSpacing = (-0.02).em, color = c.ink),
        )
    }
}

@Composable
private fun PrimaryButton(label: String, leading: List<Shape24>? = null) {
    val c = LocalPalette.current
    Row(
        Modifier
            .shadow(2.dp, CircleShape, ambientColor = Color(0x22000000), spotColor = Color(0x22000000))
            .background(c.accent, CircleShape)
            .padding(horizontal = 18.4.dp, vertical = 9.9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (leading != null) LineIcon(leading, Color.White, size = 15.dp, stroke = 2.4f)
        Text(label, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 13.8.sp, color = Color.White))
    }
}

/** coverGradient() for a trip with no photo: 135deg, two hues 40 apart. */
private fun tripGradient(color: Color): Brush {
    val hsv = FloatArray(3)
    android.graphics.Color.colorToHSV(
        android.graphics.Color.argb(255, (color.red * 255).toInt(), (color.green * 255).toInt(), (color.blue * 255).toInt()), hsv,
    )
    val a = Color.hsl(hsv[0], 0.45f, 0.72f)
    val b = Color.hsl((hsv[0] + 40f) % 360f, 0.50f, 0.58f)
    return Brush.linearGradient(listOf(a, b), start = Offset(0f, 0f), end = Offset(Float.POSITIVE_INFINITY, Float.POSITIVE_INFINITY))
}

@Composable
private fun BigTripCard(trip: Trip) {
    val shape = RoundedCornerShape(24.dp)
    BoxWithConstraints(
        Modifier
            .fillMaxWidth()
            .aspectRatio(16f / 10f)
            .shadow(2.dp, shape)
            .background(tripGradient(trip.color), shape),
    ) {
        // A soft sheen from the top left, as .trip-card-noimg::before.
        Box(
            Modifier.fillMaxSize().background(
                Brush.radialGradient(
                    listOf(Color.White.copy(alpha = 0.28f), Color.Transparent),
                    center = Offset(0.2f * constraints.maxWidth, -0.1f * constraints.maxHeight),
                    radius = constraints.maxWidth * 0.75f,
                ),
                shape,
            ),
        )
        // The big watermark compass, top right, a little turned.
        LineIcon(
            Glyphs.compass, Color.White, size = 120.dp, stroke = 1.6f,
            modifier = Modifier.align(Alignment.TopEnd).offset(x = 14.dp, y = (-10).dp).rotate(-8f).alpha(0.22f),
        )
        // .trip-card-overlay: dark from the bottom, so the white text reads.
        Box(
            Modifier.fillMaxSize().background(
                Brush.verticalGradient(
                    0f to Color.Transparent,
                    0.45f to Color(0xFF10151B).copy(alpha = 0.05f),
                    1f to Color(0xFF10151B).copy(alpha = 0.78f),
                ),
                shape,
            ),
        )
        if (trip.startsInDays != null) {
            Row(
                Modifier.padding(13.6.dp).background(Color.White.copy(alpha = 0.92f), CircleShape)
                    .padding(start = 8.8.dp, end = 11.2.dp, top = 5.6.dp, bottom = 5.6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.8.dp),
            ) {
                LineIcon(Glyphs.hourglass, LightPalette.accentInk, size = 13.dp, stroke = 2.2f)
                Text(
                    stringResource(R.string.home_in_days, trip.startsInDays),
                    style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(650), fontSize = 11.8.sp, color = LightPalette.accentInk),
                )
            }
        }
        LineIcon(Glyphs.dotsCircles, Color.White, size = 22.dp, filled = true, modifier = Modifier.align(Alignment.TopEnd).padding(top = 16.dp, end = 16.dp))
        Column(Modifier.align(Alignment.BottomStart).padding(horizontal = 20.dp, vertical = 17.6.dp)) {
            Text(
                trip.title,
                style = TextStyle(
                    fontFamily = Fraunces, fontWeight = FontWeight(560), fontSize = 25.6.sp, letterSpacing = (-0.015).em, color = Color.White,
                    shadow = Shadow(Color(0x66000000), blurRadius = 24f),
                ),
            )
            Row(Modifier.padding(top = 8.8.dp), verticalAlignment = Alignment.CenterVertically) {
                Meta(DateText.longMonth(trip.month), trip.year)
                Spacer(Modifier.width(12.dp))
                Meta("${trip.days}", stringResource(R.string.home_days))
                if (trip.km != null) {
                    Spacer(Modifier.width(12.dp))
                    Meta("%,d".format(Lang.locale, trip.km), "km")
                }
                Spacer(Modifier.weight(1f))
                Faces(trip.people, trip.extraPeople)
            }
        }
    }
}

/** One of month, days and distance: the number in the display face, the unit small. */
@Composable
private fun Meta(value: String, unit: String) {
    // .tcm { top: 1.5px }: level with the middle of the faces beside it.
    Row(Modifier.offset(y = 1.5.dp), verticalAlignment = Alignment.Bottom) {
        Text(value, style = TextStyle(fontFamily = Fraunces, fontWeight = FontWeight(600), fontSize = 15.2.sp, color = Color.White))
        Text(
            " " + unit.uppercase(),
            style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 11.5.sp, letterSpacing = 0.04.em, color = Color.White.copy(alpha = 0.85f)),
            modifier = Modifier.padding(bottom = 1.dp),
        )
    }
}

@Composable
private fun Faces(people: List<Person>, extra: Int) {
    // .trip-card-members: 26px faces, 13px over each other, the first on top.
    val faces = people.take(2)
    val count = faces.size + if (extra > 0) 1 else 0
    Box(Modifier.width(26.dp + 13.dp * (count - 1)).height(26.dp)) {
        faces.forEachIndexed { i, p ->
            Box(
                Modifier.offset(x = 13.dp * i).zIndex((count - i).toFloat()).size(26.dp).shadow(1.5.dp, CircleShape)
                    .background(p.color, CircleShape).border(2.dp, Color.White, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text(p.initial, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(700), fontSize = 10.sp, color = Color.White))
            }
        }
        if (extra > 0) {
            Box(
                Modifier.offset(x = 13.dp * faces.size).zIndex(0f).size(26.dp)
                    .background(Color(0xFF3A4350), CircleShape).border(2.dp, Color.White, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text("+$extra", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(700), fontSize = 9.9.sp, color = Color.White))
            }
        }
    }
}

/** .trips-tabs: a sunken pill with a raised thumb that slides to the open tab. */
@Composable
private fun Tabs(tab: Int, past: Int, shared: Int, onTab: (Int) -> Unit, modifier: Modifier = Modifier) {
    val c = LocalPalette.current
    val slide by animateFloatAsState(tab.toFloat(), tween(320), label = "thumb")
    var width by remember { mutableStateOf(0) }
    val density = LocalDensity.current
    Box(
        modifier.fillMaxWidth().background(c.sunken, CircleShape).padding(4.dp).onSizeChanged { width = it.width },
    ) {
        val half = with(density) { (width / 2f).toDp() }
        Box(
            Modifier.offset { IntOffset((slide * width / 2f).toInt(), 0) }.width(half).height(36.dp)
                .shadow(1.dp, CircleShape).background(c.raised, CircleShape),
        )
        Row(Modifier.fillMaxWidth()) {
            TabLabel(stringResource(R.string.home_past), past, tab == 0, Modifier.weight(1f)) { onTab(0) }
            TabLabel(stringResource(R.string.home_shared), shared, tab == 1, Modifier.weight(1f)) { onTab(1) }
        }
    }
}

@Composable
private fun TabLabel(label: String, count: Int, active: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val c = LocalPalette.current
    Row(
        modifier.height(36.dp).clickable(remember { MutableInteractionSource() }, null, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        Text(label, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 13.8.sp, color = if (active) c.ink else c.inkFaint))
        Spacer(Modifier.width(7.2.dp))
        Text(
            "$count",
            style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(700), fontSize = 10.8.sp, color = if (active) c.accentInk else c.inkFaint),
            modifier = Modifier.background(if (active) c.accentSoft else c.paper, CircleShape).padding(horizontal = 5.4.dp, vertical = 0.8.dp),
        )
    }
}

/** .trip-card-compact without a cover: a raised row with the title and one line of facts. */
@Composable
private fun CompactTripCard(trip: Trip) {
    val c = LocalPalette.current
    val shape = RoundedCornerShape(16.dp)
    Box(
        Modifier.fillMaxWidth().shadow(1.dp, shape, ambientColor = Color(0x14000000), spotColor = Color(0x14000000))
            .background(c.raised, shape).border(1.dp, c.line, shape)
            .padding(start = 20.dp, end = 48.dp, top = 10.4.dp, bottom = 10.4.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(3.2.dp)) {
            Text(
                trip.title, maxLines = 1, overflow = TextOverflow.Ellipsis,
                style = TextStyle(fontFamily = Fraunces, fontWeight = FontWeight(560), fontSize = 19.2.sp, letterSpacing = (-0.015).em, color = c.ink),
            )
            val km = trip.km?.let { " · " + "%,d".format(Lang.locale, it) + " km" } ?: ""
            Text(
                stringResource(R.string.home_trip_line, shortMonth(trip.month), trip.year, trip.days, km),
                style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.3.sp, color = c.inkFaint),
            )
        }
        LineIcon(Glyphs.dotsCircles, c.inkFaint, size = 20.dp, filled = true, modifier = Modifier.align(Alignment.CenterEnd).offset(x = 38.dp))
    }
}

/** .bottomnav: three tabs on the glass colour, the open one in the accent ink. */
@Composable
private fun BottomNav(modifier: Modifier = Modifier) {
    val c = LocalPalette.current
    Column(modifier.fillMaxWidth().background(c.glass)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.line))
        Row(Modifier.fillMaxWidth().padding(vertical = 5.6.dp)) {
            NavItem(Glyphs.compass, stringResource(R.string.nav_trips), true, Modifier.weight(1f))
            NavItem(Glyphs.friends, stringResource(R.string.nav_travellers), false, Modifier.weight(1f))
            NavItem(Glyphs.settings, stringResource(R.string.nav_settings), false, Modifier.weight(1f))
        }
        Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
    }
}

@Composable
private fun NavItem(icon: List<Shape24>, label: String, active: Boolean, modifier: Modifier) {
    val c = LocalPalette.current
    val color = if (active) c.accentInk else c.inkFaint
    Column(modifier.padding(vertical = 4.8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        LineIcon(icon, color, size = 24.dp, stroke = 1.8f)
        Text(label, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 10.9.sp, color = color))
    }
}

/** The short month names Intl writes in Dutch: "mrt", not "maa". */
private fun shortMonth(month: String): String = DateText.shortMonthOf(month)
