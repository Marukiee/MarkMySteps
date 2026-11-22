package nl.markmaaktmedia.markmysteps.next

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.toShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/*
 * Settings in the Material 3 Expressive proposal: the profile at the top, then the tabs of the web app's
 * settings (Profiel, Weergave, Voorkeuren, Diensten, Gegevens, Accounts, Over) as one slab of rows, each
 * opening a page of its own. Every function of the web's tabs is here, natively, through the same API.
 */

/** A page of settings under the main list: its icon, name, and the line that says what is on it. */
private class Section(val id: String, val icon: List<Shape24>, val title: String, val summary: String)

@Composable
fun SettingsPage(onSignIn: () -> Unit = {}) {
    var open by remember { mutableStateOf<String?>(Data.openSettings.also { Data.openSettings = null }) }
    var admin by remember { mutableStateOf(false) }
    LaunchedEffect(Data.live, Data.version) { admin = Data.live && runCatching { SettingsRemote.account().admin }.getOrDefault(false) }
    val sections = listOfNotNull(
        Section("account", Glyphs.person, "Account", "Profielfoto, naam, wachtwoord, 2FA"),
        Section("display", Glyphs.sun, "Weergave", "Thema, reiskaarten, kaartstijl"),
        Section("prefs", Glyphs.plane, "Voorkeuren", "Standaard vliegvelden"),
        Section("services", Glyphs.cloud, "Diensten", "Server, Immich"),
        Section("data", Glyphs.download, "Gegevens", "Back-up, importeren, route-bestanden"),
        if (admin) Section("accounts", Glyphs.friends, "Accounts", "Aanvragen en accounts op je server") else null,
        Section("about", Glyphs.help, "Over", "Versie, wat is er nieuw"),
    )
    SlideHost(open, onClose = { open = null }, base = { SettingsMain(sections, onOpen = { open = it }) }) { id ->
        val back = { open = null }
        when (id) {
            "account" -> AccountPage(back, onSignIn)
            "display" -> DisplayPage(back)
            "prefs" -> PreferencesPage(back)
            "services" -> ServicesPage(back, onSignIn)
            "data" -> DataPage(back)
            "accounts" -> AccountsPage(back)
            else -> AboutPage(back)
        }
    }
}

/**
 * The homepage with the Account page sliding over it, opened from the face at the top right: the same
 * page as Instellingen › Account, with the same predictive back.
 */
@Composable
fun AccountHost(onSignIn: () -> Unit, content: @Composable (openAccount: () -> Unit) -> Unit) {
    var open by remember { mutableStateOf<Boolean?>(null) }
    SlideHost(open, onClose = { open = null }, base = { content { open = true } }) {
        AccountPage(onBack = { open = null }, onSignIn = onSignIn)
    }
}

@Composable
private fun SettingsMain(sections: List<Section>, onOpen: (String) -> Unit) {
    val cs = MaterialTheme.colorScheme
    val pageScroll = rememberScrollState()
    Box(Modifier.fillMaxSize().background(cs.background)) {
        Column(Modifier.fillMaxSize().verticalScroll(pageScroll).padding(horizontal = 16.dp)) {
            Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
            Text(
                "Instellingen",
                style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 32.sp, letterSpacing = (-0.02).em, color = cs.onBackground),
                modifier = Modifier.padding(top = 20.dp, bottom = 18.dp),
            )
            // Who is signed in, on which server.
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(30.dp)).background(cs.surfaceContainerLow).dip { onOpen("account") }.padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Avatar(Data.me?.id, Data.me?.name ?: "Mark", Data.me?.hasAvatar == true, cs.primary, Modifier.size(64.dp), MaterialShapes.Cookie12Sided.toShape())
                Column(Modifier.weight(1f).padding(horizontal = 16.dp)) {
                    Text(Data.me?.name ?: "Mark", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 21.sp, color = cs.onSurface))
                    Text(if (Data.live) "@${Data.me?.username}" else "voorbeelden, niet ingelogd", maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.5.sp, color = cs.onSurfaceVariant))
                    if (Data.live) Text(Api.base.removePrefix("https://").trimEnd('/'), maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 12.5.sp, color = cs.onSurfaceVariant.copy(alpha = 0.8f)))
                }
                Box(Modifier.size(44.dp).clip(CircleShape).background(cs.surfaceContainerHigh), contentAlignment = Alignment.Center) {
                    LineIcon(Glyphs.pencil, cs.onSurface, size = 20.dp, stroke = 2f)
                }
            }
            Spacer(Modifier.height(18.dp))
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                sections.forEachIndexed { i, sec ->
                    Row(
                        Modifier.fillMaxWidth().height(80.dp).clip(slabShape(i, sections.size)).background(cs.surfaceContainerLow)
                            .dip { onOpen(sec.id) }.padding(horizontal = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        IconTile(sec.icon, i, big = true)
                        Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                            Text(sec.title, style = TitleStyle.copy(color = cs.onSurface))
                            Text(sec.summary, maxLines = 1, overflow = TextOverflow.Ellipsis, style = ValueStyle.copy(color = cs.onSurfaceVariant))
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

// Weergave.

@Composable
private fun DisplayPage(onBack: () -> Unit) {
    SettingsScaffold("Weergave", onBack) {
        Header("Thema", top = true)
        Panel {
            Choices(listOf(0 to "Licht", 1 to "Donker", 2 to "Systeem"), ThemePref.mode, { ThemePref.set(it) })
            Hint("Systeem volgt de licht- of donkerstand van je telefoon.")
        }
        Header("Reiskaarten op de homepage")
        Panel {
            Choices(listOf(CardSizePref.AUTO to "Automatisch", CardSizePref.LARGE to "Groot", CardSizePref.COMPACT to "Klein"), CardSizePref.standard, { CardSizePref.choose(it) })
            Hint("Automatisch: komende reizen en de laatste groot, de rest klein. Per reis kies je het via het ⋯-menu op de kaart.")
            SoftButton(
                "Handmatige keuzes wissen",
                { CardSizePref.clear() }, Modifier.fillMaxWidth(), icon = Glyphs.trash, enabled = CardSizePref.overrides.isNotEmpty(),
            )
        }
        Header("Kaartstijl")
        Panel {
            MapStyleGrid()
            Hint("Geldt voor alle kaarten in de app. In de donkere stand worden de lichte stijlen vanzelf de donkere kaart.")
        }
    }
}

/** The four map styles as previews, two by two, the chosen one outlined. */
@Composable
fun MapStyleGrid() {
    val cs = MaterialTheme.colorScheme
    val dark = cs.background.luminance() < 0.5f
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        MapStylePref.ids.chunked(2).forEach { pair ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                pair.forEach { (id, label) ->
                    val on = MapStylePref.id == id
                    val edge by androidx.compose.animation.animateColorAsState(if (on) cs.primary else Color.Transparent, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "edge")
                    val fill by androidx.compose.animation.animateColorAsState(if (on) cs.secondaryContainer else cs.surfaceContainerHigh, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "fill")
                    Column(
                        Modifier.weight(1f).clip(RoundedCornerShape(22.dp)).background(fill)
                            .border(2.dp, edge, RoundedCornerShape(22.dp))
                            .dip { MapStylePref.set(id) }.padding(8.dp),
                    ) {
                        MapStylePreview(id, dark, Modifier.fillMaxWidth().height(84.dp).clip(RoundedCornerShape(16.dp)))
                        Row(Modifier.padding(top = 8.dp, bottom = 2.dp, start = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(label, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = if (on) cs.onSecondaryContainer else cs.onSurface), modifier = Modifier.weight(1f))
                            AnimatedVisibility(on, enter = fadeIn() + androidx.compose.animation.scaleIn(), exit = fadeOut() + androidx.compose.animation.scaleOut()) {
                                LineIcon(listOf(P("m5 12 5 5 9-10")), cs.primary, size = 18.dp, stroke = 2.6f)
                            }
                        }
                    }
                }
            }
        }
    }
}

// Voorkeuren.

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PreferencesPage(onBack: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val context = LocalContext.current
    LaunchedEffect(Unit) { kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { Airports.load(context) } }
    var query by remember { mutableStateOf("") }
    val results = remember(query, AirportPref.codes.toList(), Airports.ready) { Airports.search(query).filter { it.iata !in AirportPref.codes } }
    SettingsScaffold("Voorkeuren", onBack) {
        Header("Standaard vliegvelden", top = true)
        Panel {
            Hint("Je thuisvliegvelden. Tik er een aan om hem de eerste te maken: die geldt als thuis op de globe.")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                AirportPref.codes.forEachIndexed { i, code ->
                    val first = i == 0
                    val a = Airports.byCode(code)
                    Row(
                        Modifier.height(48.dp).clip(CircleShape).background(if (first) cs.primary else cs.secondaryContainer)
                            .dip { if (!first) AirportPref.set(listOf(code) + AirportPref.codes.filter { it != code }) }
                            .padding(start = 16.dp, end = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        val ink = if (first) cs.onPrimary else cs.onSecondaryContainer
                        Text(code, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 15.sp, color = ink))
                        if (a != null) Text(a.city, maxLines = 1, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = ink.copy(alpha = 0.8f)), modifier = Modifier.padding(start = 6.dp))
                        Box(Modifier.padding(start = 4.dp).size(40.dp).clip(CircleShape).dip { AirportPref.set(AirportPref.codes.filter { it != code }) }, contentAlignment = Alignment.Center) {
                            LineIcon(listOf(P("M18 6 6 18"), P("m6 6 12 12")), ink, size = 16.dp, stroke = 2.4f)
                        }
                    }
                }
            }
            FormField("Vliegveld toevoegen", query, { query = it }, hint = "bv. Eindhoven", type = KeyboardType.Text)
            AnimatedVisibility(results.isNotEmpty(), enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    results.forEachIndexed { i, a ->
                        Row(
                            Modifier.fillMaxWidth().clip(slabShape(i, results.size)).background(cs.surfaceContainerHigh)
                                .dip { AirportPref.set(AirportPref.codes + a.iata); query = "" }.padding(horizontal = 14.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(a.iata, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 15.sp, color = cs.onSurface), modifier = Modifier.width(48.dp))
                            Column(Modifier.weight(1f)) {
                                Text(a.city, style = TitleStyle.copy(fontSize = 15.sp, color = cs.onSurface))
                                Text(a.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = ValueStyle.copy(color = cs.onSurfaceVariant))
                            }
                            LineIcon(Glyphs.plus, cs.primary, size = 20.dp, stroke = 2.2f)
                        }
                    }
                }
            }
        }
    }
}

// Diensten.

@Composable
private fun ServicesPage(onBack: () -> Unit, onSignIn: () -> Unit) {
    SettingsScaffold("Diensten", onBack) {
        ServerPanel(onSignIn)
        ImmichPanel()
    }
}

/** Which server this app talks to; another one signs you out, since tokens belong to the server that gave them. */
@Composable
private fun ServerPanel(onSignIn: () -> Unit) {
    val current = Api.base.trimEnd('/')
    var url by remember { mutableStateOf(current) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf<String?>(null) }
    val trimmed = url.trim().trimEnd('/')
    val changed = trimmed != current
    Header("Server", top = true)
    Panel {
        Hint("De server waarmee deze app praat. Een andere kiezen logt je uit; daarna log je daar opnieuw in.")
        FormField("Adres", url, { url = it; error = null }, hint = "https://jouw-server.nl", type = KeyboardType.Uri)
        Note(error, true)
        ButtonRow {
            AnimatedVisibility(changed, Modifier.weight(1f), enter = fadeIn(), exit = fadeOut()) {
                SoftButton("Herstellen", { url = current; error = null }, Modifier.fillMaxWidth())
            }
            MainButton("Server wijzigen", {
                val u = runCatching { java.net.URI(trimmed) }.getOrNull()
                error = when {
                    u?.host.isNullOrBlank() -> "Dat is geen geldig adres. Begin met https:// en vul een domein in."
                    u?.scheme != "https" && u?.host != "localhost" -> "Gebruik https, anders reist je wachtwoord onversleuteld mee."
                    else -> null
                }
                if (error == null) confirm = "${u!!.scheme}://${u.host}${if (u.port > 0) ":${u.port}" else ""}"
            }, Modifier.weight(1f), enabled = changed && trimmed.isNotEmpty())
        }
    }
    confirm?.let { origin ->
        Confirm(
            "Andere server gebruiken?",
            "De app praat daarna met $origin. Je wordt uitgelogd en logt daar opnieuw in. Reizen op de oude server blijven daar.",
            "Wisselen",
            onConfirm = {
                // Never in test mode: signing out there cannot be undone from the test.
                if (!Api.dryRun) { Api.setServer(trimmed); onSignIn() } else android.util.Log.i("MmsDryRun", "server change [blocked]")
            },
            onDismiss = { confirm = null },
        )
    }
}

@Composable
private fun ImmichPanel() {
    val cs = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf<SettingsRemote.Immich?>(null) }
    var loaded by remember { mutableStateOf(!Data.live) }
    var serverUrl by remember { mutableStateOf("") }
    var publicUrl by remember { mutableStateOf("") }
    var apiKey by remember { mutableStateOf("") }
    var note by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var busy by remember { mutableStateOf(false) }
    var confirmOff by remember { mutableStateOf(false) }
    DisposableEffect(Unit) { onDispose { apiKey = "" } }
    LaunchedEffect(Data.live) {
        if (!Data.live) return@LaunchedEffect
        runCatching { SettingsRemote.immich() }.onSuccess { s -> status = s; serverUrl = s?.serverUrl ?: ""; publicUrl = s?.publicUrl ?: "" }
            .onFailure { note = "Kon de Immich-status niet laden" to true }
        loaded = true
    }
    Header("Immich")
    Panel {
        // The answer takes the placeholder's place in the same spot, so nothing jumps.
        androidx.compose.animation.Crossfade(if (!loaded) 0 else if (status != null) 1 else 2, animationSpec = MaterialTheme.motionScheme.defaultEffectsSpec(), label = "immich") { s ->
            when (s) {
                0 -> Placeholder(Modifier.fillMaxWidth().height(64.dp).clip(RoundedCornerShape(18.dp)))
                1 -> status?.let { st ->
                    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(cs.surfaceContainerHigh).padding(14.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(10.dp).clip(CircleShape).background(cs.primary))
                            Text("Verbonden", style = TitleStyle.copy(fontSize = 15.sp, color = cs.onSurface), modifier = Modifier.padding(start = 8.dp))
                        }
                        Text(
                            listOfNotNull(st.serverUrl.removePrefix("https://").removePrefix("http://"), "key ${st.keyPreview}".takeIf { st.keyPreview.isNotBlank() }, st.lastSync?.let { "laatste sync ${shortDate(it)}" }).joinToString(" · "),
                            style = ValueStyle.copy(color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 4.dp),
                        )
                        st.lastError?.let { Text(it, style = ValueStyle.copy(color = cs.error), modifier = Modifier.padding(top = 4.dp)) }
                    }
                }
                else -> Hint("Niet verbonden. Immich is een fotobibliotheek die je zelf draait; je foto's blijven daar, MarkMySteps bewaart alleen verwijzingen.")
            }
        }
        FormField("Server-URL", serverUrl, { serverUrl = it; note = null }, hint = "https://immich.example.com", type = KeyboardType.Uri)
        FormField("API-key", apiKey, { apiKey = it; note = null }, hint = if (status != null) "Nieuwe key om te vervangen" else "Immich API-key", secret = true, type = KeyboardType.Password)
        PathHint("Maak er een in ", listOf("Immich", "Accountinstellingen", "API-keys"), ". Hij wordt versleuteld opgeslagen.")
        FormField("Publieke URL (optioneel)", publicUrl, { publicUrl = it; note = null }, hint = "Voor de knop Openen in Immich", type = KeyboardType.Uri)
        ButtonRow {
            if (status != null) QuietDangerButton("Verbreken", { confirmOff = true }, Modifier.weight(1f))
            MainButton(if (status != null) "Bijwerken" else "Verbinden", {
                busy = true; note = null
                val key = apiKey; apiKey = ""
                scope.launch {
                    note = runCatching { SettingsRemote.connectImmich(serverUrl, key, publicUrl) }.fold({ s ->
                        if (s != null) status = s
                        "Verbonden met Immich. De key is gecontroleerd en versleuteld opgeslagen." to false
                    }, { (it.message ?: "Opslaan mislukt") to true })
                    busy = false
                }
            }, Modifier.weight(1f), busy = busy, enabled = Data.live && serverUrl.isNotBlank() && apiKey.length >= 10)
        }
        Note(note?.first, note?.second == true)
    }
    if (confirmOff) Confirm(
        "Immich loskoppelen?", "Nieuwe foto's komen dan niet meer binnen. Wat al in je reizen staat blijft staan.", "Verbreken",
        onConfirm = {
            scope.launch {
                note = runCatching { SettingsRemote.disconnectImmich() }.fold({ status = null; serverUrl = ""; publicUrl = ""; "Verbinding verwijderd." to false }, { (it.message ?: "Mislukt") to true })
            }
        },
        onDismiss = { confirmOff = false },
    )
}

private val MonthsShort = listOf("jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec")

/** "3 mrt 2026" from an ISO date or time. */
fun shortDate(iso: String): String = runCatching {
    val d = java.time.LocalDate.parse(iso.take(10)); "${d.dayOfMonth} ${MonthsShort[d.monthValue - 1]} ${d.year}"
}.getOrDefault(iso.take(10))

// Gegevens.

/** A trip to pick in a list: its id, name and year. */
private data class TripChoice(val id: String, val title: String, val year: String)

@Composable
private fun DataPage(onBack: () -> Unit) {
    var trips by remember { mutableStateOf<List<TripChoice>?>(null) }
    LaunchedEffect(Data.live) {
        trips = if (!Data.live) emptyList() else runCatching {
            val a = SettingsRemote.tripsRaw()
            (0 until a.length()).map { a.getJSONObject(it) }.map { TripChoice(it.getString("id"), it.optString("title"), it.optString("startDate").take(4)) }
        }.getOrDefault(emptyList())
    }
    SettingsScaffold("Gegevens", onBack) {
        BackupPanel()
        PolarstepsPanel()
        TrackFilesPanel(trips)
        CachePanel()
    }
}

/** One file with all your trips, stops, route points and notes plus your settings, and the way to read it back. */
@Composable
private fun BackupPanel() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var progress by remember { mutableStateOf<Pair<Float, String>?>(null) }
    var note by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var pending by remember { mutableStateOf<JSONObject?>(null) }
    var made by remember { mutableStateOf<String?>(null) }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        val text = made; made = null
        if (uri == null || text == null) { busy = false; return@rememberLauncherForActivityResult }
        scope.launch {
            note = runCatching {
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { context.contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray()) } ?: error("") }
                "Back-up opgeslagen · ${bytes(text.length.toLong())}" to false
            }.getOrElse { "Back-up mislukt" to true }
            busy = false
        }
    }
    val open = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val parsed = runCatching {
                JSONObject(kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { context.contentResolver.openInputStream(uri)?.use { it.bufferedReader().readText() } ?: "" })
            }.getOrNull()
            note = when {
                parsed == null -> "Dit is geen leesbaar back-upbestand." to true
                parsed.optString("app") != "MarkMySteps" || parsed.optJSONArray("trips") == null -> "Dit bestand komt niet van MarkMySteps." to true
                parsed.optInt("version") > 1 -> "Deze back-up komt van een nieuwere versie van de app." to true
                else -> { pending = parsed; null }
            }
        }
    }
    Header("Back-up", top = true)
    Panel {
        Hint("Al je reizen, stops, routepunten en notities in één bestand, plus je instellingen. Foto's staan erin als verwijzing. Terugzetten voegt toe wat je nog niet hebt en laat bestaande reizen met rust.")
        AnimatedVisibility(busy, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                SmoothProgress(progress?.first ?: 0.05f, Modifier.fillMaxWidth())
                Hint(progress?.second?.takeIf { it.isNotBlank() } ?: "Verzamelen")
            }
        }
        ButtonRow {
            SoftButton("Terugzetten", { open.launch(arrayOf("application/json", "text/plain", "application/octet-stream")) }, Modifier.weight(1f), enabled = Data.live && !busy)
            MainButton("Back-up maken", {
                busy = true; note = null
                scope.launch {
                    runCatching {
                        val trips = SettingsRemote.tripsRaw()
                        val out = JSONArray()
                        for (i in 0 until trips.length()) {
                            val t = trips.getJSONObject(i)
                            progress = i.toFloat() / trips.length().coerceAtLeast(1) to t.optString("title")
                            val parts = SettingsRemote.tripParts(t.getString("id"))
                            out.put(parts.put("trip", t))
                        }
                        progress = 1f to ""
                        JSONObject().put("version", 1).put("createdAt", java.time.Instant.now().toString()).put("app", "MarkMySteps")
                            .put("trips", out).put("settings", settingsSnapshot()).toString(2)
                    }.onSuccess { made = it; save.launch("markmysteps-backup-${java.time.LocalDate.now()}.json") }
                        .onFailure { note = (it.message ?: "Back-up mislukt") to true; busy = false }
                    progress = null
                }
            }, Modifier.weight(1f), icon = Glyphs.download, busy = busy, enabled = Data.live)
        }
        Note(note?.first, note?.second == true)
    }
    pending?.let { backup ->
        val count = backup.optJSONArray("trips")?.length() ?: 0
        Confirm(
            "Back-up terugzetten?",
            "Deze back-up is van ${shortDate(backup.optString("createdAt"))} en bevat $count ${if (count == 1) "reis" else "reizen"}. Reizen die je al hebt blijven zoals ze zijn; de rest wordt toegevoegd.",
            "Terugzetten", danger = false,
            onConfirm = {
                busy = true; note = null
                scope.launch {
                    // The airport list, so restored home airports also move the globe's home.
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { Airports.load(context) }
                    note = runCatching { restore(backup) { p, label -> progress = p to label } }.fold({ it to false }, { (it.message ?: "Terugzetten mislukt") to true })
                    busy = false; progress = null
                    Data.load()
                }
            },
            onDismiss = { pending = null },
        )
    }
}

/** The settings a backup carries, under the web's keys, so a file from either app reads in the other. */
private fun settingsSnapshot(): JSONObject = JSONObject()
    .put("mms.theme", when (ThemePref.mode) { 0 -> "light"; 1 -> "dark"; else -> "system" })
    .put("mms.mapstyle", MapStylePref.id)
    .put("mms.airports", JSONArray(AirportPref.codes.toList()).toString())
    .put("mms.cardsize", CardSizePref.standard)
    .put("mms.cardsize.overrides", JSONObject(CardSizePref.overrides.toMap()).toString())
    .put("mms.tripFacts", JSONObject(TripFactsPref.chosen.mapValues { JSONArray(it.value) }).toString())

/** Puts a backup back trip by trip, as the web's restoreBackup: a trip that is already here is left alone. */
private suspend fun restore(backup: JSONObject, onProgress: (Float, String) -> Unit): String {
    val known = runCatching { SettingsRemote.tripsRaw() }.getOrDefault(JSONArray()).let { a -> (0 until a.length()).map { a.getJSONObject(it).optString("id") }.toSet() }
    val entries = backup.getJSONArray("trips")
    var added = 0; var skipped = 0; var points = 0; var coversLost = 0
    fun JSONObject.opt2(k: String): Any? = if (isNull(k)) null else opt(k)
    for (i in 0 until entries.length()) {
        val e = entries.getJSONObject(i)
        val trip = e.getJSONObject("trip")
        val id = trip.getString("id")
        onProgress(i.toFloat() / entries.length(), trip.optString("title"))
        if (id in known) { skipped++; continue }
        Api.send("POST", "/api/trips", JSONObject().put("id", id).put("title", trip.optString("title")).put("startDate", trip.optString("startDate")).put("endDate", trip.optString("endDate"))
            .apply { trip.opt2("description")?.let { put("description", it) } })
        runCatching {
            Api.send("PATCH", "/api/trips/$id", JSONObject().put("color", trip.opt2("color") ?: JSONObject.NULL).put("markerLng", trip.opt2("markerLng") ?: JSONObject.NULL)
                .put("markerLat", trip.opt2("markerLat") ?: JSONObject.NULL).put("autoTrack", trip.optBoolean("autoTrack")))
        }
        if (trip.opt2("coverMediaId") != null) coversLost++
        added++
        val stops = e.optJSONArray("stops") ?: JSONArray()
        val all = (0 until stops.length()).map { stops.getJSONObject(it) }
        val route = all.filter { it.isNull("parentStopId") || !it.has("parentStopId") }
        val dayTrips = all - route.toSet()
        for (s in route + dayTrips) runCatching {
            val body = JSONObject().put("id", s.optString("id")).put("name", s.optString("name")).put("nights", s.optInt("nights")).put("travelMode", s.optString("travelMode"))
            listOf("latitude", "longitude", "countryCode", "flightNumber", "fromAirport", "toAirport", "notes", "parentStopId").forEach { k -> s.opt2(k)?.let { body.put(k, it) } }
            s.optJSONArray("viaAirports")?.takeIf { it.length() > 0 }?.let { body.put("viaAirports", it) }
            if (s.opt2("parentStopId") != null) body.put("dayTripDate", s.optString("arrivalDate").take(10))
            Api.send("POST", "/api/trips/$id/stops", body)
        }
        if (route.size > 1) runCatching { Api.send("PUT", "/api/trips/$id/stops/order", JSONObject().put("stopIds", JSONArray(route.map { it.optString("id") }))) }
        val pts = e.optJSONArray("points") ?: JSONArray()
        var k = 0
        while (k < pts.length()) {
            val batch = JSONArray()
            for (j in k until minOf(k + 400, pts.length())) pts.getJSONObject(j).let { p ->
                batch.put(JSONObject().put("clientId", p.optString("id")).put("recordedAt", p.optString("recordedAt")).put("latitude", p.optDouble("latitude")).put("longitude", p.optDouble("longitude")))
            }
            runCatching { Api.send("POST", "/api/trips/$id/points/batch", JSONObject().put("points", batch)) }
            points += batch.length(); k += 400
        }
        val notes = e.optJSONArray("notes") ?: JSONArray()
        for (j in 0 until notes.length()) notes.getJSONObject(j).let { n -> runCatching { Api.send("POST", "/api/trips/$id/notes", JSONObject().put("day", n.optString("day")).put("body", n.optString("body"))) } }
    }
    onProgress(1f, "")
    // The settings that mean something here.
    backup.optJSONObject("settings")?.let { s ->
        when (s.optString("mms.theme")) { "light" -> ThemePref.set(0); "dark" -> ThemePref.set(1); "system" -> ThemePref.set(2) }
        s.optString("mms.mapstyle").takeIf { id -> MapStylePref.ids.any { it.first == id } }?.let { MapStylePref.set(it) }
        runCatching { JSONArray(s.getString("mms.airports")) }.getOrNull()?.let { a -> AirportPref.set((0 until a.length()).map { a.getString(it) }) }
        s.optString("mms.cardsize").takeIf { it in listOf(CardSizePref.AUTO, CardSizePref.LARGE, CardSizePref.COMPACT) }?.let { CardSizePref.choose(it) }
    }
    return listOfNotNull(
        "$added ${if (added == 1) "reis" else "reizen"} teruggezet",
        if (skipped > 0) "$skipped overgeslagen" else null,
        if (points > 0) "$points ${if (points == 1) "routepunt" else "routepunten"}" else null,
        if (coversLost > 0) "covers komen terug zodra je foto's gekoppeld zijn" else null,
    ).joinToString(" · ") + "."
}

private fun bytes(b: Long): String = when {
    b < 1024 -> "$b B"
    b < 1024 * 1024 -> "${b / 1024} kB"
    b < 1024L * 1024 * 1024 -> "${b / (1024 * 1024)} MB"
    else -> "%.1f GB".format(b / (1024.0 * 1024 * 1024))
}

@Composable
private fun PolarstepsPanel() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var file by remember { mutableStateOf<Pair<android.net.Uri, String>?>(null) }
    var busy by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<List<SettingsRemote.Imported>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) file = uri to (displayName(context, uri) ?: "polarsteps.zip")
    }
    val cs = MaterialTheme.colorScheme
    Header("Polarsteps importeren")
    Panel {
        PathHint("Vraag je export op via ", listOf("polarsteps.com", "Settings", "Privacy", "Download my data"), " en kies de zip hier. Elke reis erin wordt aangemaakt met de volledige GPS-route.")
        Row(
            Modifier.fillMaxWidth().height(64.dp).clip(RoundedCornerShape(18.dp)).background(cs.surfaceContainerHigh)
                .dip { pick.launch(arrayOf("application/zip", "application/x-zip-compressed", "application/octet-stream")) }.padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            LineIcon(Glyphs.download, cs.primary, size = 22.dp)
            Text(file?.second ?: "Kies je Polarsteps-zip", maxLines = 1, overflow = TextOverflow.Ellipsis, style = TitleStyle.copy(fontSize = 15.sp, color = cs.onSurface), modifier = Modifier.padding(start = 12.dp))
        }
        MainButton("Importeren", {
            val (uri, _) = file ?: return@MainButton
            busy = true; error = null; result = null
            scope.launch {
                runCatching {
                    val data = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } } ?: error("Bestand kon niet gelezen worden")
                    SettingsRemote.importPolarsteps(data)
                }.onSuccess { result = it; Data.load() }.onFailure { error = it.message ?: "Import mislukt" }
                busy = false
            }
        }, Modifier.fillMaxWidth(), busy = busy, enabled = Data.live && file != null)
        result?.let { list ->
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (list.isEmpty()) Hint("Klaar.")
                list.forEach { t ->
                    Text(
                        pathText("", listOf(t.title), " · ${shortDate(t.start)} t/m ${shortDate(t.end)}, ${t.points} ${if (t.points == 1) "routepunt" else "routepunten"}", cs.onSurface),
                        style = ValueStyle.copy(color = cs.onSurfaceVariant),
                    )
                }
            }
        }
        Note(error, true)
    }
}

private fun displayName(context: android.content.Context, uri: android.net.Uri): String? = runCatching {
    context.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
}.getOrNull()

/** A trip exported as GPX or KML, or a track recorded somewhere else added to it. */
@Composable
private fun TrackFilesPanel(trips: List<TripChoice>?) {
    val cs = MaterialTheme.colorScheme
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var tripId by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(trips) { if (tripId == null) tripId = trips?.firstOrNull()?.id }
    val trip = trips?.firstOrNull { it.id == tripId }
    var picker by remember { mutableStateOf(false) }
    var formats by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf<String?>(null) }
    var note by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var export by remember { mutableStateOf<ByteArray?>(null) }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val data = export; export = null
        if (uri != null && data != null) scope.launch {
            note = runCatching {
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { context.contentResolver.openOutputStream(uri)?.use { it.write(data) } }
                "Bewaard" to false
            }.getOrElse { "Exporteren lukte niet" to true }
        }
    }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val id = tripId
        if (uri == null || id == null) return@rememberLauncherForActivityResult
        busy = "import"; note = null
        scope.launch {
            note = runCatching {
                val data = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } } ?: error("Bestand kon niet gelezen worden")
                val r = SettingsRemote.importTrack(id, displayName(context, uri) ?: "track.gpx", data)
                listOfNotNull(
                    "${r.added} van ${r.found} punten toegevoegd",
                    if (r.outside > 0) "${r.outside} buiten de reisdagen" else null,
                    if (r.undated > 0) "${r.undated} zonder tijd" else null,
                ).joinToString(", ") + (if (r.added == 0 && r.found > 0) " (stonden er al in)" else "") to false
            }.getOrElse { (it.message ?: "Importeren mislukt") to true }
            busy = null
        }
    }
    Header("Route-bestanden")
    Panel {
        Hint("Exporteer een reis als GPX of KML, of voeg een track toe die je ergens anders opnam. Punten buiten de reisdagen worden overgeslagen.")
        Box {
            Row(
                Modifier.fillMaxWidth().height(56.dp).clip(RoundedCornerShape(18.dp)).background(cs.surfaceContainerHigh)
                    .dip { if (!trips.isNullOrEmpty()) picker = true }.padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                LineIcon(Glyphs.compass, cs.onSurfaceVariant, size = 20.dp)
                if (trips == null) Placeholder(Modifier.padding(start = 12.dp).weight(1f).height(18.dp).clip(RoundedCornerShape(6.dp)))
                else Text(trip?.title ?: "Geen reizen", maxLines = 1, overflow = TextOverflow.Ellipsis, style = TitleStyle.copy(fontSize = 15.sp, color = cs.onSurface), modifier = Modifier.weight(1f).padding(start = 12.dp))
                trip?.let { Text(it.year, style = ValueStyle.copy(color = cs.onSurfaceVariant), modifier = Modifier.padding(horizontal = 8.dp)) }
                LineIcon(listOf(P("m6 9 6 6 6-6")), cs.onSurfaceVariant, size = 18.dp, stroke = 2.2f)
            }
            AppMenu(picker, { picker = false }, listOf(trips.orEmpty().map { t -> MenuEntry("${t.title} · ${t.year}", Glyphs.compass, selected = t.id == tripId) { tripId = t.id; note = null } }))
        }
        ButtonRow {
            Box(Modifier.weight(1f)) {
                SoftButton("Exporteren", { formats = true }, Modifier.fillMaxWidth(), icon = Glyphs.download, busy = busy == "export", enabled = trip != null && busy == null)
                AppMenu(formats, { formats = false }, listOf(listOf("gpx" to "GPX, voor apps en horloges", "kml" to "KML, voor Google Earth").map { (f, label) ->
                    MenuEntry(label, Glyphs.download) {
                        val id = tripId ?: return@MenuEntry
                        busy = "export"; note = null
                        scope.launch {
                            val data = SettingsRemote.exportTrack(id, f)
                            busy = null
                            if (data == null) note = "Exporteren lukte niet" to true
                            else { export = data; save.launch("${slug(trip?.title ?: "reis")}.$f") }
                        }
                    }
                }))
            }
            MainButton("Importeren", { pick.launch(arrayOf("*/*")) }, Modifier.weight(1f), icon = Glyphs.plus, busy = busy == "import", enabled = trip != null && busy == null)
        }
        Note(note?.first, note?.second == true)
    }
}

private fun slug(text: String): String = java.text.Normalizer.normalize(text.lowercase(), java.text.Normalizer.Form.NFD)
    .replace(Regex("\\p{Mn}+"), "").replace(Regex("[^a-z0-9]+"), "-").trim('-').take(60).ifBlank { "reis" }

/** The photos kept in memory while the app runs. */
@Composable
private fun CachePanel() {
    var used by remember { mutableStateOf(Photos.usedBytes()) }
    var confirm by remember { mutableStateOf(false) }
    Header("Foto-cache")
    Panel {
        Hint("Foto's die je bekijkt blijven in het geheugen zolang de app open is. Nu ${bytes(used)} in gebruik.")
        SoftButton("Cache leegmaken", { confirm = true }, Modifier.fillMaxWidth(), icon = Glyphs.trash, enabled = used > 0)
    }
    if (confirm) Confirm(
        "Cache leegmaken?", "Bewaarde foto's worden gewist en opnieuw opgehaald als je ze bekijkt. Er gaat niets van je reizen verloren.", "Leegmaken",
        onConfirm = { Photos.clear(); used = Photos.usedBytes() }, onDismiss = { confirm = false },
    )
}

// Accounts (admins only).

@Composable
private fun AccountsPage(onBack: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    var users by remember { mutableStateOf<List<SettingsRemote.AdminUser>?>(null) }
    var meId by remember { mutableStateOf(Data.me?.id) }
    var reload by remember { mutableIntStateOf(0) }
    LaunchedEffect(reload) { users = runCatching { SettingsRemote.adminUsers() }.getOrDefault(users ?: emptyList()) }
    var note by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var query by remember { mutableStateOf("") }
    // Confirmations, as on the web: reject, reset password, reset 2FA, delete.
    var ask by remember { mutableStateOf<Pair<String, SettingsRemote.AdminUser>?>(null) }
    var tempForReset by remember { mutableStateOf("") }
    DisposableEffect(Unit) { onDispose { tempForReset = "" } }
    fun act(done: String, block: suspend () -> Unit) {
        note = null
        scope.launch { note = runCatching { block() }.fold({ reload++; done to false }, { (it.message ?: "Mislukt") to true }) }
    }
    SettingsScaffold("Accounts", onBack) {
        val requests = users.orEmpty().filter { it.status == "PENDING" }
        AnimatedVisibility(requests.isNotEmpty(), enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
            Column {
                Header(if (requests.size == 1) "1 aanvraag" else "${requests.size} aanvragen", top = true)
                Panel {
                    Hint("Deze mensen hebben zich aangemeld op je server. Tot je ze toelaat kunnen ze niets.")
                    requests.forEach { u ->
                        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(cs.surfaceContainerHigh).padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Column {
                                Text("${u.displayName}  @${u.username}", style = TitleStyle.copy(fontSize = 15.sp, color = cs.onSurface))
                                Text("${u.email} · aangemeld ${shortDate(u.createdAt)}", style = ValueStyle.copy(color = cs.onSurfaceVariant))
                            }
                            ButtonRow {
                                SoftButton("Afwijzen", { ask = "reject" to u }, Modifier.weight(1f))
                                MainButton("Toelaten", { act("${u.displayName} is toegelaten.") { SettingsRemote.decide(u.id, true) } }, Modifier.weight(1f), icon = Glyphs.check)
                            }
                        }
                    }
                }
            }
        }
        CreateAccountPanel(onCreated = { reload++ })
        Header("Accounts")
        Panel {
            FormField("Zoeken", query, { query = it }, hint = "Naam, gebruikersnaam of e-mail")
            val settled = users.orEmpty().filter { it.status != "PENDING" }
            val needle = query.trim().lowercase()
            val shown = if (needle.isEmpty()) settled else settled.filter { u -> listOf(u.displayName, u.username, u.email).any { it.lowercase().contains(needle) } }
            if (users == null) repeat(3) { Placeholder(Modifier.fillMaxWidth().height(72.dp).clip(RoundedCornerShape(18.dp))) }
            else if (shown.isEmpty()) Hint("Geen account gevonden met die naam.")
            shown.forEach { u ->
                var menu by remember(u.id) { mutableStateOf(false) }
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(cs.surfaceContainerHigh).padding(start = 14.dp, top = 10.dp, bottom = 10.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("${u.displayName}  @${u.username}", maxLines = 1, overflow = TextOverflow.Ellipsis, style = TitleStyle.copy(fontSize = 15.sp, color = cs.onSurface))
                        Text(
                            listOfNotNull(u.email, "${u.trips} ${if (u.trips == 1) "reis" else "reizen"}", if (u.admin) "admin" else null, if (u.status == "REJECTED") "afgewezen" else null, if (u.tempPassword) "tijdelijk wachtwoord" else null, if (u.twoFactor) "2FA" else null).joinToString(" · "),
                            style = ValueStyle.copy(color = cs.onSurfaceVariant),
                        )
                    }
                    if (u.id != meId) Box {
                        Box(Modifier.size(44.dp).clip(CircleShape).dip { menu = true }, contentAlignment = Alignment.Center) {
                            LineIcon(listOf(C(5f, 12f, 1.2f), C(12f, 12f, 1.2f), C(19f, 12f, 1.2f)), cs.onSurfaceVariant, size = 22.dp, stroke = 2.4f)
                        }
                        AppMenu(menu, { menu = false }, listOf(
                            listOfNotNull(
                                MenuEntry("Wachtwoord resetten", Glyphs.lock) { tempForReset = tempPassword(); ask = "reset" to u },
                                if (u.twoFactor) MenuEntry("2FA resetten", Glyphs.shield) { ask = "2fa" to u } else null,
                                MenuEntry(if (u.admin) "Geen admin meer" else "Maak admin", Glyphs.person) { act(if (u.admin) "@${u.username} is geen admin meer." else "@${u.username} is nu admin.") { SettingsRemote.setRole(u.id, !u.admin) } },
                            ),
                            listOf(MenuEntry("Account verwijderen", Glyphs.trash, danger = true) { ask = "delete" to u }),
                        ))
                    }
                }
            }
            Note(note?.first, note?.second == true)
        }
    }
    ask?.let { (what, u) ->
        when (what) {
            "reject" -> Confirm("Aanvraag van ${u.displayName} afwijzen?", "Diegene kan niet inloggen. Het account blijft bestaan, zodat dezelfde naam en e-mail niet meteen opnieuw gebruikt worden.", "Afwijzen",
                onConfirm = { act("Aanvraag van ${u.displayName} afgewezen.") { SettingsRemote.decide(u.id, false) } }, onDismiss = { ask = null })
            "reset" -> Confirm("Nieuw tijdelijk wachtwoord", "@${u.username} wordt overal uitgelogd en kiest bij de volgende keer inloggen zelf een nieuw wachtwoord.", "Resetten",
                onConfirm = { val t = tempForReset; tempForReset = ""; act("Wachtwoord van @${u.username} gereset. Geef het tijdelijke wachtwoord door: $t") { SettingsRemote.resetPassword(u.id, t) } },
                onDismiss = { ask = null; tempForReset = "" }, confirmEnabled = tempForReset.length >= 10,
                extra = { FormField("Tijdelijk wachtwoord", tempForReset, { tempForReset = it }, type = KeyboardType.Ascii, support = if (tempForReset.length < 10) "Minstens 10 tekens" else null, supportError = true) })
            "2fa" -> Confirm("2FA resetten?", "@${u.username} kan daarna weer inloggen met alleen een wachtwoord en wordt overal uitgelogd. Doe dit alleen als diegene telefoon én herstelcodes kwijt is.", "Resetten",
                onConfirm = { act("2FA van @${u.username} is uitgezet.") { SettingsRemote.resetTwoFactor(u.id) } }, onDismiss = { ask = null })
            else -> Confirm("Account verwijderen?", "Account @${u.username} wordt verwijderd, samen met hun eigen reizen en routes.", "Verwijderen",
                onConfirm = { act("Account @${u.username} verwijderd.") { SettingsRemote.deleteUser(u.id) } }, onDismiss = { ask = null })
        }
    }
}

/** A temporary password that is easy to read out: no 0/O or 1/l, in groups. */
private fun tempPassword(): String {
    val chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    val r = java.security.SecureRandom()
    return (0 until 3).joinToString("-") { (0 until 4).map { chars[r.nextInt(chars.length)] }.joinToString("") }
}

@Composable
private fun CreateAccountPanel(onCreated: () -> Unit) {
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var username by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var temp by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    DisposableEffect(Unit) { onDispose { temp = "" } }
    Header("Account aanmaken")
    Panel {
        Hint("Voor een reisgenoot, met een tijdelijk wachtwoord. Bij de eerste keer inloggen kiezen ze zelf iets anders.")
        FormField("Naam", name, { name = it }, capitalize = true)
        FormField("Gebruikersnaam", username, { username = it.filter { c -> !c.isWhitespace() }.take(30) }, prefix = "@", type = KeyboardType.Ascii)
        FormField("E-mail", email, { email = it.trim() }, type = KeyboardType.Email)
        FormField("Tijdelijk wachtwoord", temp, { temp = it }, type = KeyboardType.Ascii, support = if (temp.isNotEmpty() && temp.length < 10) "Minstens 10 tekens" else null, supportError = true)
        ButtonRow {
            SoftButton("Genereer", { temp = tempPassword() }, Modifier.weight(1f))
            MainButton("Aanmaken", {
                busy = true; note = null
                val t = temp
                scope.launch {
                    note = runCatching { SettingsRemote.createUser(email, username, name, t) }.fold({
                        val u = username
                        name = ""; username = ""; email = ""; temp = ""
                        onCreated()
                        "Account @$u aangemaakt. Geef het tijdelijke wachtwoord door: $t" to false
                    }, { (it.message ?: "Aanmaken mislukt") to true })
                    busy = false
                }
            }, Modifier.weight(1f), busy = busy, enabled = name.isNotBlank() && Regex("^[a-zA-Z0-9._-]{3,30}$").matches(username) && email.contains('@') && temp.length >= 10)
        }
        Note(note?.first, note?.second == true)
    }
}

// Over.

@Composable
private fun AboutPage(onBack: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val context = LocalContext.current
    val version = remember { runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull() ?: "" }
    fun open(url: String) = { runCatching { context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url))) }; Unit }
    SettingsScaffold("Over", onBack) {
        Spacer(Modifier.height(12.dp))
        Panel {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(52.dp).clip(MaterialShapes.Cookie9Sided.toShape()).background(cs.primary), contentAlignment = Alignment.Center) {
                    LineIcon(Glyphs.logo, cs.onPrimary, size = 28.dp, stroke = 2f)
                }
                Column(Modifier.padding(start = 14.dp)) {
                    Text("MarkMySteps", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 21.sp, color = cs.onSurface))
                    Text("Versie $version", style = ValueStyle.copy(color = cs.onSurfaceVariant))
                }
            }
            Hint("Self-hosted reistracker op je eigen Immich-server. Open source (AGPL-3.0).")
        }
        Group("Meer", listOf(
            Item(Glyphs.help, "Wat is er nieuw", "op GitHub", external = true, action = open("https://github.com/Marukiee/MarkMySteps/releases")),
            Item(Glyphs.logo, "Broncode", "github.com/Marukiee/MarkMySteps", external = true, action = open("https://github.com/Marukiee/MarkMySteps")),
            Item(Glyphs.shield, "Licentie", "AGPL-3.0", external = true, action = open("https://www.gnu.org/licenses/agpl-3.0.html")),
        ))
    }
}
