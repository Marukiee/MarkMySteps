package nl.markmaaktmedia.markmysteps.next

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ButtonGroupDefaults
import androidx.compose.material3.MaterialShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.ToggleButton
import androidx.compose.material3.ToggleButtonDefaults
import androidx.compose.material3.ripple
import androidx.compose.material3.toShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.animation.togetherWith
import kotlinx.coroutines.launch
import androidx.compose.animation.AnimatedContent
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/*
 * Settings in the Material 3 Expressive proposal: the profile at the top, then
 * the groups of the web app's settings as slabs of rows (outer corners round,
 * inner ones tight), each icon in a shape of its own, real switches and a
 * connected toggle group for the theme. The texts are the short ones of the
 * web app: what a row does, its current value on the right.
 */

private fun Modifier.dip(onClick: () -> Unit = {}): Modifier = composed {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.97f else 1f, MaterialTheme.motionScheme.fastSpatialSpec(), label = "press")
    clickable(source, ripple(), onClick = onClick).graphicsLayer { scaleX = scale; scaleY = scale }
}

private fun slabShape(i: Int, n: Int): Shape {
    val big = 26.dp
    val small = 6.dp
    return RoundedCornerShape(
        topStart = if (i == 0) big else small, topEnd = if (i == 0) big else small,
        bottomStart = if (i == n - 1) big else small, bottomEnd = if (i == n - 1) big else small,
    )
}

private val IconShapes = listOf(
    MaterialShapes.Cookie9Sided, MaterialShapes.Sunny, MaterialShapes.Clover4Leaf,
    MaterialShapes.Cookie6Sided, MaterialShapes.SoftBurst, MaterialShapes.Flower,
)

private class Item(
    val icon: List<Shape24>,
    val title: String,
    val value: String? = null,
    val toggle: Boolean? = null,
    val action: (() -> Unit)? = null,
)

/** A page of settings under the main list: its icon, name, the line that says how it stands, and its rows. */
private class Section(val icon: List<Shape24>, val title: String, val summary: String)

private val Sections = listOf(
    Section(Glyphs.person, "Account", "Profiel, wachtwoord, 2FA"),
    Section(Glyphs.sun, "Weergave", "Thema, taal, kaartstijl"),
    Section(Glyphs.distance, "Plannen", "Vliegvelden, importeren"),
    Section(Glyphs.photo, "Foto's", "Immich, foto-cache"),
    Section(Glyphs.help, "Over", "Versie, wat is er nieuw"),
)

@Composable
fun SettingsPage(onSignIn: () -> Unit = {}) {
    var open by remember { mutableStateOf<Int?>(null) }
    // Predictive back here too: the section follows the finger and the list shows behind it.
    val state = remember { androidx.compose.animation.core.SeekableTransitionState<Int?>(null) }
    // The same seekable shared-axis transition as the pages and as Tandem.
    androidx.compose.runtime.LaunchedEffect(open) { if (state.targetState != open) state.animateTo(open) }
    androidx.activity.compose.PredictiveBackHandler(enabled = open != null) { events ->
        try {
            events.collect { state.seekTo(it.progress, null) }
            state.animateTo(null)
            open = null
        } catch (e: kotlin.coroutines.cancellation.CancellationException) {
            kotlinx.coroutines.withContext(kotlinx.coroutines.NonCancellable) { state.snapTo(open) }
            throw e
        }
    }
    val emphasized = androidx.compose.animation.core.CubicBezierEasing(0.2f, 0f, 0f, 1f)
    val ease = androidx.compose.animation.core.tween<Float>(350, easing = emphasized)
    val slide = androidx.compose.animation.core.tween<androidx.compose.ui.unit.IntOffset>(350, easing = emphasized)
    androidx.compose.animation.core.rememberTransition(state, label = "settings").AnimatedContent(
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
        contentKey = { it },
    ) { which ->
        Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
            if (which == null) SettingsMain(onOpen = { open = it }) else SectionPage(which, onBack = { open = null }, onSignIn = onSignIn)
        }
    }
}

@Composable
private fun SettingsMain(onOpen: (Int) -> Unit) {
    val cs = MaterialTheme.colorScheme
    val pageScroll = rememberScrollState()
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().background(cs.background).verticalScroll(pageScroll).padding(horizontal = 16.dp)) {
            Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
            Text(
                "Instellingen",
                style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 32.sp, letterSpacing = (-0.02).em, color = cs.onBackground),
                modifier = Modifier.padding(top = 20.dp, bottom = 18.dp),
            )
            // Who is signed in, on which server.
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(30.dp)).background(cs.surfaceContainerLow).dip { onOpen(0) }.padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Avatar(Data.me?.id, Data.me?.name ?: "Mark", Data.me?.hasAvatar == true, cs.primary, Modifier.size(64.dp), MaterialShapes.Cookie12Sided.toShape())
                Column(Modifier.weight(1f).padding(horizontal = 16.dp)) {
                    Text(Data.me?.name ?: "Mark", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 21.sp, color = cs.onSurface))
                    // The handle and the server each on a line of their own, never broken halfway.
                    Text(if (Data.live) "@${Data.me?.username}" else "voorbeelden, niet ingelogd", maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.5.sp, color = cs.onSurfaceVariant))
                    if (Data.live) Text(Api.base.removePrefix("https://").trimEnd('/'), maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 12.5.sp, color = cs.onSurfaceVariant.copy(alpha = 0.8f)))
                }
                Box(Modifier.size(44.dp).clip(androidx.compose.foundation.shape.CircleShape).background(cs.surfaceContainerHigh), contentAlignment = Alignment.Center) {
                    LineIcon(Glyphs.pencil, cs.onSurface, size = 20.dp, stroke = 2f)
                }
            }
            Spacer(Modifier.height(18.dp))
            // One slab of sections, each opening a page of its own.
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Sections.forEachIndexed { i, sec ->
                    Row(
                        Modifier.fillMaxWidth().height(80.dp).clip(slabShape(i, Sections.size)).background(cs.surfaceContainerLow)
                            .dip { onOpen(i) }.padding(horizontal = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        IconTile(sec.icon, i, big = true)
                        Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                            Text(sec.title, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 17.sp, color = cs.onSurface))
                            Text(sec.summary, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = cs.onSurfaceVariant))
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

@Composable
private fun SectionPage(index: Int, onBack: () -> Unit, onSignIn: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val sec = Sections[index]
    val theme = ThemePref.mode
    var autoUpdate by remember { mutableStateOf(true) }
    var twoFactor by remember { mutableStateOf(true) }
    var tracking by remember { mutableStateOf(true) }
    var selfLocation by remember { mutableStateOf(false) }
    var notify by remember { mutableStateOf(true) }
    var offlineMap by remember { mutableStateOf(false) }
    var confirmSignOut by remember { mutableStateOf(false) }
    var mapStyle by remember { mutableStateOf(false) }
    var cacheCleared by remember { mutableStateOf(false) }
    // The real values from the server, read when the page opens.
    val tfa by androidx.compose.runtime.produceState<Pair<Boolean, Int>?>(null, Data.live) { if (Data.live) value = runCatching { Remote.twoFactor() }.getOrNull() }
    val immich by androidx.compose.runtime.produceState<Pair<String, String?>?>(null, Data.live) { if (Data.live) value = Remote.immich() }
    val context = androidx.compose.ui.platform.LocalContext.current
    val version = remember { runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull() ?: "" }

    val pageScroll = rememberScrollState()
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().background(cs.background).verticalScroll(pageScroll).padding(horizontal = 16.dp)) {
            Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
            Box(
                Modifier.padding(top = 8.dp).size(48.dp).clip(androidx.compose.foundation.shape.CircleShape).background(cs.surfaceContainerHigh).dip(onBack),
                contentAlignment = Alignment.Center,
            ) { LineIcon(listOf(P("M19 12H5"), P("m12 19-7-7 7-7")), cs.onSurface, size = 22.dp, stroke = 2.2f) }
            Text(
                sec.title,
                style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 32.sp, letterSpacing = (-0.02).em, color = cs.onBackground),
                modifier = Modifier.padding(top = 18.dp, bottom = 4.dp),
            )
            // Only rows that do something real: a page of the web version, an Android setting, or a change here.
            fun web(path: String) = { runCatching { context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(Api.base.trimEnd('/') + path))) }; Unit }
            fun open(url: String) = { runCatching { context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url))) }; Unit }
            when (index) {
                0 -> Group("Jij", listOf(
                    Item(Glyphs.person, "Profiel", "naam en foto, in de webversie", action = web("/settings")),
                    Item(Glyphs.lock, "Wachtwoord", "in de webversie", action = web("/settings")),
                    Item(Glyphs.shield, "Tweestapsverificatie", tfa?.let { (on, left) -> if (on) "aan, nog $left herstelcodes" else "uit" }, action = web("/settings")),
                )).also {
                    Group("Server", listOf(Item(Glyphs.globe, "Server", Api.base.removePrefix("https://").trimEnd('/').ifBlank { "voorbeelden" }), Item(Glyphs.arrowRight, if (Data.live) "Uitloggen" else "Inloggen", action = { if (Data.live) confirmSignOut = true else onSignIn() })))
                }
                1 -> {
                    Header("Thema")
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(ButtonGroupDefaults.ConnectedSpaceBetween)) {
                        listOf("Licht", "Donker", "Systeem").forEachIndexed { i, label ->
                            ToggleButton(
                                checked = theme == i,
                                onCheckedChange = { ThemePref.set(i) },
                                modifier = Modifier.weight(1f).height(52.dp),
                                shapes = when (i) {
                                    0 -> ButtonGroupDefaults.connectedLeadingButtonShapes()
                                    2 -> ButtonGroupDefaults.connectedTrailingButtonShapes()
                                    else -> ButtonGroupDefaults.connectedMiddleButtonShapes()
                                },
                                colors = ToggleButtonDefaults.toggleButtonColors(
                                    containerColor = cs.surfaceContainerHigh, contentColor = cs.onSurfaceVariant,
                                    checkedContainerColor = cs.primary, checkedContentColor = cs.onPrimary,
                                ),
                            ) { Text(label, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp)) }
                        }
                    }
                    Group("Taal en kaart", listOf(
                        Item(Glyphs.globe, "Taal", "via Android", action = {
                            runCatching { context.startActivity(android.content.Intent(android.provider.Settings.ACTION_APP_LOCALE_SETTINGS, android.net.Uri.parse("package:" + context.packageName))) }; Unit
                        }),
                        Item(Glyphs.compass, "Kaartstijl", MapStylePref.ids.firstOrNull { it.first == MapStylePref.id }?.second, action = { mapStyle = true }),
                    ))
                }
                2 -> Group("Plannen", listOf(
                    Item(Glyphs.plane, "Standaard vliegvelden", "in de webversie", action = web("/settings")),
                    Item(Glyphs.download, "Route-bestanden en Polarsteps", "importeren in de webversie", action = web("/settings")),
                ))
                3 -> Group("Bron", listOf(
                    Item(Glyphs.photo, "Immich", if (!Data.live) "verbonden" else immich?.let { (url, last) ->
                        url.removePrefix("https://").removePrefix("http://").trimEnd('/') + (last?.let { " · bijgewerkt " + runCatching { java.time.LocalDate.parse(it.take(10)).let { d -> "${d.dayOfMonth} ${d.month.getDisplayName(java.time.format.TextStyle.SHORT, java.util.Locale.forLanguageTag("nl-NL")).trimEnd('.')}" } }.getOrDefault("") } ?: "")
                    } ?: "niet verbonden", action = web("/settings")),
                    Item(Glyphs.trash, "Foto-cache leegmaken", if (cacheCleared) "leeg" else "maakt ruimte vrij op dit toestel", action = { Photos.clear(); cacheCleared = true }),
                ))
                else -> Group("MarkMySteps", listOf(
                    Item(Glyphs.download, "Versie", "$version (testversie)"),
                    Item(Glyphs.help, "Wat is er nieuw", action = open("https://github.com/Marukiee/MarkMySteps/releases")),
                    Item(Glyphs.logo, "Over MarkMySteps", "AGPL-3.0", action = open("https://github.com/Marukiee/MarkMySteps")),
                ))
            }
            if (mapStyle) MapSheet(onDismiss = { mapStyle = false })
            if (confirmSignOut) androidx.compose.material3.AlertDialog(
                onDismissRequest = { confirmSignOut = false },
                title = { Text("Uitloggen?", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 20.sp)) },
                text = { Text("Je reizen blijven op je server. Daarna log je opnieuw in.", style = TextStyle(fontFamily = Inter, fontSize = 15.sp)) },
                confirmButton = { androidx.compose.material3.TextButton(onClick = { confirmSignOut = false; onSignIn() }) { Text("Uitloggen", color = cs.error, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600))) } },
                dismissButton = { androidx.compose.material3.TextButton(onClick = { confirmSignOut = false }) { Text("Annuleren", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600))) } },
            )
            Spacer(Modifier.height(120.dp))
            Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
        }
        StatusScrim(pageScroll)
    }

}

@Composable
private fun Header(text: String) {
    Text(
        text,
        style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant),
        modifier = Modifier.padding(top = 24.dp, bottom = 10.dp),
    )
}

@Composable
private fun Group(title: String, items: List<Item>, onToggle: () -> Unit = {}) {
    Header(title)
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        items.forEachIndexed { i, item -> Row0(item, i, items.size, title.length + i, onToggle) }
    }
}

@Composable
private fun IconTile(icon: List<Shape24>, seed: Int, big: Boolean = false) {
    val cs = MaterialTheme.colorScheme
    Box(Modifier.size(if (big) 50.dp else 42.dp).clip(IconShapes[seed % IconShapes.size].toShape()).background(cs.secondaryContainer), contentAlignment = Alignment.Center) {
        LineIcon(icon, cs.onSecondaryContainer, size = 20.dp, stroke = 2f)
    }
}

@Composable
private fun Row0(item: Item, i: Int, n: Int, seed: Int, onToggle: () -> Unit = {}) {
    val cs = MaterialTheme.colorScheme
    Row(
        Modifier.fillMaxWidth().clip(slabShape(i, n)).background(cs.surfaceContainerLow)
            .then(if (item.action != null || item.toggle != null) Modifier.dip { item.action?.invoke() ?: run { if (item.toggle != null) onToggle() } } else Modifier).padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconTile(item.icon, seed)
        Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
            Text(item.title, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 17.sp, color = cs.onSurface))
            if (item.value != null) {
                Text(item.value, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = cs.onSurfaceVariant))
            }
        }
        if (item.toggle != null) {
            Switch(
                checked = item.toggle,
                onCheckedChange = { item.action?.invoke() ?: onToggle() },
                thumbContent = if (item.toggle) {
                    { LineIcon(listOf(P("m5 12 5 5 9-10")), cs.primary, size = 14.dp, stroke = 2.6f) }
                } else null,
                colors = SwitchDefaults.colors(checkedTrackColor = cs.primary, checkedThumbColor = cs.onPrimary),
            )
        } else if (item.action != null) {
            LineIcon(Glyphs.chevronRight, cs.onSurfaceVariant, size = 18.dp, stroke = 2.2f)
        }
    }
}
