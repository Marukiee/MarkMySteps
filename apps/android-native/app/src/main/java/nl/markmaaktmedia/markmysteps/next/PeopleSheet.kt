package nl.markmaaktmedia.markmysteps.next

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ButtonGroupDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.ToggleButton
import androidx.compose.material3.ToggleButtonDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/*
 * People and sharing, as on the web (MembersPanel, MemberAdd, SharePanel): who
 * is on the trip and as what, adding people by name, and the read-only links
 * for those at home. Only the organiser changes roles and removes people;
 * companions see the links so they can pass one on.
 */

private val PersonColors = listOf(Color(0xFFE8613C), Color(0xFF5B8DEF), Color(0xFF2BB6A8), Color(0xFFD9A441), Color(0xFF7A5BD6), Color(0xFFE34B8A))

private fun slab(i: Int, n: Int): Shape = RoundedCornerShape(
    topStart = if (i == 0) 24.dp else 6.dp, topEnd = if (i == 0) 24.dp else 6.dp,
    bottomStart = if (i == n - 1) 24.dp else 6.dp, bottomEnd = if (i == n - 1) 24.dp else 6.dp,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PeopleSheet(trip: Trip, onDismiss: () -> Unit, onChanged: () -> Unit, onMake: ((String) -> Unit)? = null) {
    val cs = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    val me = Data.me?.id
    val owner = trip.ownerId != null && trip.ownerId == me
    val editor = owner || trip.members.any { it.userId == me && it.role == "MEMBER" }
    var members by remember(trip.id) { mutableStateOf(trip.members.sortedBy { when (it.role) { "OWNER" -> 0; "MEMBER" -> 1; else -> 2 } }) }
    var error by remember { mutableStateOf<String?>(null) }
    var removing by remember { mutableStateOf<Member?>(null) }

    AppSheet(onDismiss = onDismiss) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 28.dp)) {
            Text("Mensen", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 24.sp, color = cs.onSurface))
            Text(
                "Reisgenoten waren erbij en tellen de reis mee in hun statistieken. Gasten kijken alleen mee: voor hen telt deze reis niet.",
                style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.5.sp, lineHeight = 19.sp, color = cs.onSurfaceVariant),
                modifier = Modifier.padding(top = 4.dp, bottom = 14.dp),
            )
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                members.forEachIndexed { i, m ->
                    MemberRow(m, i, members.size, canChange = owner && m.role != "OWNER", onRole = { role ->
                        val before = members
                        members = members.map { if (it.userId == m.userId) it.copy(role = role) else it }
                        scope.launch { runCatching { Remote.updateMember(trip, m.userId, role = role) }.onSuccess { onChanged() }.onFailure { members = before; error = "Opslaan mislukt" } }
                    }, onTrack = { on ->
                        val before = members
                        members = members.map { if (it.userId == m.userId) it.copy(canTrack = on) else it }
                        scope.launch { runCatching { Remote.updateMember(trip, m.userId, canTrack = on) }.onSuccess { onChanged() }.onFailure { members = before; error = "Opslaan mislukt" } }
                    }, onRemove = { removing = m })
                }
            }
            AnimatedVisibility(error != null, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
                Text(error ?: "", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.error), modifier = Modifier.padding(top = 10.dp, start = 4.dp))
            }
            if (owner) AddPeople(trip, existing = members.map { it.username }.toSet(), onAdded = onChanged)
            if (editor) ShareLinks(trip, owner)
            if (onMake != null) Make(onMake)
        }
    }

    removing?.let { m ->
        AlertDialog(
            onDismissRequest = { removing = null },
            title = { Text(if (m.role == "GUEST") "Gast verwijderen?" else "Reisgenoot verwijderen?", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 20.sp)) },
            text = { Text("${m.name} wordt uit de reis verwijderd.", style = TextStyle(fontFamily = Inter, fontSize = 15.sp)) },
            confirmButton = {
                TextButton(onClick = {
                    removing = null
                    val before = members
                    members = members - m
                    scope.launch { runCatching { Remote.removeMember(trip, m.userId) }.onSuccess { onChanged() }.onFailure { members = before; error = "Verwijderen mislukt" } }
                }) { Text("Verwijderen", color = cs.error, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600))) }
            },
            dismissButton = { TextButton(onClick = { removing = null }) { Text("Annuleren", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600))) } },
        )
    }
}

/** To share the trip in another way: the photo book and the summary posters (PhotoBook.kt, Summary.kt). */
@Composable
private fun Make(onMake: (String) -> Unit) {
    val cs = MaterialTheme.colorScheme
    Text("Samenvatting en fotoboek", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(start = 4.dp, top = 22.dp, bottom = 8.dp))
    val items = listOf(
        Triple("book", "Fotoboek", "Een boek van de mooiste foto's per dag") to Glyphs.photo,
        Triple("summary", "Samenvatting", "Een poster om te delen") to Glyphs.sun,
    )
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        items.forEachIndexed { i, (item, glyph) ->
            val (key, title, line) = item
            Row(
                Modifier.fillMaxWidth().clip(slab(i, items.size)).background(cs.surfaceContainerHigh).clickable { onMake(key) }.padding(horizontal = 12.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                LineIcon(glyph, cs.onSurface, size = 22.dp, modifier = Modifier.padding(start = 6.dp))
                Column(Modifier.weight(1f).padding(horizontal = 16.dp)) {
                    Text(betaTitle(title, cs.onSurfaceVariant, 12.sp), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 16.5.sp, color = cs.onSurface))
                    Text(line, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = cs.onSurfaceVariant))
                }
                LineIcon(Glyphs.chevronRight, cs.onSurfaceVariant, size = 20.dp)
            }
        }
    }
}

@Composable
private fun MemberRow(m: Member, i: Int, n: Int, canChange: Boolean, onRole: (String) -> Unit, onTrack: (Boolean) -> Unit, onRemove: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    var menu by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().clip(slab(i, n)).background(cs.surfaceContainerHigh).padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Avatar(m.userId, m.name, m.hasAvatar, personColor(m.userId), Modifier.size(44.dp))
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Text(m.name, maxLines = 1, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 16.5.sp, color = cs.onSurface))
            val role = when (m.role) { "OWNER" -> "organisator"; "GUEST" -> "gast"; else -> "reisgenoot" }
            val days = if (m.from != null || m.to != null) " · deel van de reis" else ""
            val track = if (m.role != "GUEST" && !m.canTrack) " · trackt niet" else ""
            // The handle on its own line and the role under it, so neither is ever cut off.
            Text("@${m.username}", maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = cs.onSurfaceVariant))
            Text(role.replaceFirstChar { it.uppercase() } + days + track, maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = cs.onSurfaceVariant))
        }
        if (canChange) {
            Box {
                Box(Modifier.size(40.dp).clip(CircleShape).clickable { menu = true }, contentAlignment = Alignment.Center) {
                    LineIcon(Glyphs.dotsCircles, cs.onSurfaceVariant, size = 20.dp, filled = true)
                }
                // The same menu as everywhere: the role as a choice with a tick, tracking, then removing.
                AppMenu(menu, onDismiss = { menu = false }, groups = listOf(
                    listOf(
                        MenuEntry("Reisgenoot", Glyphs.friends, selected = m.role != "GUEST") { if (m.role == "GUEST") onRole("MEMBER") },
                        MenuEntry("Gast", Glyphs.person, selected = m.role == "GUEST") { if (m.role != "GUEST") onRole("GUEST") },
                    ),
                    if (m.role != "GUEST") listOf(MenuEntry("Mag tracken", Glyphs.distance, selected = m.canTrack) { onTrack(!m.canTrack) }) else emptyList(),
                    listOf(MenuEntry("Verwijderen", Glyphs.trash, danger = true) { onRemove() }),
                ))
            }
        }
    }
}

/** Search people by name or @username, tick one or more, add them as companions or guests. */
@Composable
private fun AddPeople(trip: Trip, existing: Set<String>, onAdded: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var found by remember { mutableStateOf<List<Remote.Friend>?>(null) }
    var picked by remember { mutableStateOf(setOf<String>()) }
    var guest by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(query) {
        if (query.isBlank()) { found = null; return@LaunchedEffect }
        delay(250) // one lookup per pause in typing, not per letter
        found = runCatching { Remote.findPeople(query) }.getOrNull()?.filter { it.username !in existing }
    }
    Text("Iemand toevoegen", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 22.dp, bottom = 8.dp))
    Row(Modifier.fillMaxWidth().height(52.dp).clip(CircleShape).background(cs.surfaceContainerHighest).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        LineIcon(Glyphs.search, cs.onSurfaceVariant, size = 20.dp)
        Box(Modifier.weight(1f).padding(start = 12.dp)) {
            if (query.isEmpty()) Text("Zoek op naam of @gebruikersnaam", style = TextStyle(fontFamily = Inter, fontSize = 15.sp, color = cs.onSurfaceVariant))
            BasicTextField(query, { query = it }, singleLine = true, textStyle = TextStyle(fontFamily = Inter, fontSize = 15.sp, color = cs.onSurface), cursorBrush = SolidColor(cs.primary), modifier = Modifier.fillMaxWidth())
        }
    }
    val list = found
    if (list != null) {
        if (list.isEmpty()) {
            Text("Niemand gevonden met die naam.", style = TextStyle(fontFamily = Inter, fontSize = 14.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 10.dp))
        } else Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            list.take(8).forEachIndexed { i, f ->
                val on = f.username in picked
                Row(
                    Modifier.fillMaxWidth().clip(slab(i, minOf(8, list.size))).background(if (on) cs.secondaryContainer else cs.surfaceContainerHigh)
                        .clickable { picked = if (on) picked - f.username else picked + f.username }.padding(horizontal = 12.dp, vertical = 9.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Avatar(f.id, f.name, f.hasAvatar, personColor(f.id), Modifier.size(36.dp))
                    Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                        Text(f.name, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = cs.onSurface))
                        Text("@${f.username}", style = TextStyle(fontFamily = Inter, fontSize = 12.5.sp, color = cs.onSurfaceVariant))
                    }
                    if (on) LineIcon(listOf(P("m5 12 5 5 9-10")), cs.onSecondaryContainer, size = 20.dp, stroke = 2.4f)
                }
            }
        }
    }
    AnimatedVisibility(picked.isNotEmpty(), enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
        Column(Modifier.padding(top = 12.dp)) {
            Text(
                if (picked.size == 1) "1 persoon toevoegen als" else "${picked.size} mensen toevoegen als",
                style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.5.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(bottom = 8.dp),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(ButtonGroupDefaults.ConnectedSpaceBetween), verticalAlignment = Alignment.CenterVertically) {
                listOf(false to "Reisgenoot", true to "Gast").forEachIndexed { i, (isGuest, label) ->
                    ToggleButton(
                        checked = guest == isGuest, onCheckedChange = { guest = isGuest },
                        modifier = Modifier.weight(1f).height(48.dp),
                        shapes = if (i == 0) ButtonGroupDefaults.connectedLeadingButtonShapes() else ButtonGroupDefaults.connectedTrailingButtonShapes(),
                        colors = ToggleButtonDefaults.toggleButtonColors(containerColor = cs.surfaceContainerHighest, contentColor = cs.onSurfaceVariant, checkedContainerColor = cs.secondaryContainer, checkedContentColor = cs.onSecondaryContainer),
                    ) { Text(label, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp)) }
                }
                Spacer(Modifier.size(8.dp))
                androidx.compose.material3.Button(
                    onClick = {
                        busy = true
                        scope.launch {
                            runCatching { Remote.addMembers(trip, picked.toList(), guest) }.onSuccess { picked = emptySet(); query = ""; onAdded() }
                            busy = false
                        }
                    },
                    enabled = !busy, shapes = ButtonDefaults.shapes(), modifier = Modifier.height(48.dp),
                ) {
                    if (busy) LoadingIndicator(Modifier.size(22.dp), color = cs.onPrimary)
                    else Text("Toevoegen", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp))
                }
            }
        }
    }
}

/**
 * The trip's read-only links, as in the web app's SharePanel: the link itself as an orange link,
 * Kopieer beside it and a settings button for its password and revoking it; under the list an
 * optional password and "Deellink +" to make a new one. Companions only copy and pass them on.
 */
@Composable
private fun ShareLinks(trip: Trip, owner: Boolean) {
    val cs = MaterialTheme.colorScheme
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var links by remember { mutableStateOf<List<Remote.ShareLink>?>(null) }
    var copied by remember { mutableStateOf<String?>(null) }
    var settingsFor by remember { mutableStateOf<Remote.ShareLink?>(null) }
    var newPassword by remember { mutableStateOf("") }
    var creating by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(trip.id) { links = runCatching { Remote.shareLinks(trip) }.getOrNull() ?: emptyList() }
    LaunchedEffect(copied) { if (copied != null) { delay(1600); copied = null } }

    Text("Delen", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
    Text(
        if (owner) "Publieke, alleen-lezen link voor thuisblijvers, zonder account." else "De link die de beheerder maakte. Doorsturen mag; wijzigen doet de beheerder.",
        style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.5.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(bottom = 10.dp),
    )
    val list = links
    if (list == null) {
        Box(Modifier.fillMaxWidth().height(64.dp).clip(RoundedCornerShape(24.dp)).background(cs.surfaceContainerHigh))
    } else {
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            list.forEachIndexed { i, link ->
                Row(Modifier.fillMaxWidth().clip(slab(i, list.size)).background(cs.surfaceContainerHigh).padding(start = 16.dp, end = 6.dp, top = 10.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        // The whole address as on the web, cut at the end when it is long, with a soft underline in
                        // the accent; a tap copies it, the same as the button.
                        val copy = {
                            (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("MarkMySteps", link.url))
                            copied = link.id
                        }
                        val line = cs.primary.copy(alpha = 0.4f)
                        Text(
                            link.url.substringAfter("://"), maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                            style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 14.5.sp, color = cs.primary),
                            modifier = Modifier.clickable(onClick = copy).drawBehind {
                                val y = size.height - 1.dp.toPx()
                                drawLine(line, androidx.compose.ui.geometry.Offset(0f, y), androidx.compose.ui.geometry.Offset(size.width, y), strokeWidth = 1.5.dp.toPx())
                            },
                        )
                        if (link.hasPassword) Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 3.dp)) {
                            LineIcon(Glyphs.lock, cs.onSurfaceVariant, size = 13.dp, stroke = 2f)
                            Text("Met wachtwoord", style = TextStyle(fontFamily = Inter, fontSize = 12.5.sp, color = cs.onSurfaceVariant), modifier = Modifier)
                        }
                    }
                    // A clear primary button, so "Kopieer" reads on the row's tone.
                    androidx.compose.material3.Button(onClick = {
                        (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("MarkMySteps", link.url))
                        copied = link.id
                    }, shapes = ButtonDefaults.shapes(), modifier = Modifier.padding(start = 10.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 8.dp)) {
                        Text(if (copied == link.id) "Gekopieerd" else "Kopieer", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp))
                    }
                    if (owner && link.canManage) {
                        Box(Modifier.padding(start = 2.dp).size(42.dp).clip(CircleShape).clickable { settingsFor = link }, contentAlignment = Alignment.Center) {
                            LineIcon(Glyphs.settings, cs.onSurfaceVariant, size = 20.dp, stroke = 1.8f)
                        }
                    }
                }
            }
        }
        if (owner) {
            // A new link: an optional password, then "Deellink +".
            Row(Modifier.padding(top = 12.dp).fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.weight(1f).height(48.dp).clip(CircleShape).background(cs.surfaceContainerHighest).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.weight(1f)) {
                        if (newPassword.isEmpty()) Text("wachtwoord (optioneel)", style = TextStyle(fontFamily = Inter, fontSize = 14.5.sp, color = cs.onSurfaceVariant))
                        BasicTextField(newPassword, { newPassword = it.take(128) }, singleLine = true, textStyle = TextStyle(fontFamily = Inter, fontSize = 14.5.sp, color = cs.onSurface), cursorBrush = SolidColor(cs.primary), modifier = Modifier.fillMaxWidth())
                    }
                }
                Spacer(Modifier.size(8.dp))
                androidx.compose.material3.Button(
                    onClick = {
                        if (newPassword.isNotEmpty() && newPassword.length < 4) { error = "Een wachtwoord heeft minstens 4 tekens"; return@Button }
                        creating = true; error = null
                        scope.launch {
                            runCatching { Remote.createShareLink(trip, newPassword.ifBlank { null }) }
                                .onSuccess { links = (links ?: emptyList()) + it; newPassword = "" }
                                .onFailure { error = "Aanmaken mislukt" }
                            creating = false
                        }
                    },
                    enabled = !creating, shapes = ButtonDefaults.shapes(), modifier = Modifier.height(48.dp),
                ) {
                    Box(Modifier.size(18.dp), contentAlignment = Alignment.Center) {
                        if (creating) LoadingIndicator(Modifier.size(18.dp), color = cs.onPrimary) else LineIcon(Glyphs.plus, cs.onPrimary, size = 18.dp, stroke = 2.4f)
                    }
                    Spacer(Modifier.size(6.dp))
                    Text("Deellink", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp))
                }
            }
            error?.let { Text(it, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 13.5.sp, color = cs.error), modifier = Modifier.padding(top = 8.dp)) }
        }
    }

    settingsFor?.let { link -> LinkSettings(trip, link, onDismiss = { settingsFor = null }, onChanged = { updated ->
        links = if (updated == null) links?.filter { it.id != link.id } else links?.map { if (it.id == link.id) updated else it }
    }) }
}

/** One link's settings: set, change or remove its password, or revoke it. */
@Composable
private fun LinkSettings(trip: Trip, link: Remote.ShareLink, onDismiss: () -> Unit, onChanged: (Remote.ShareLink?) -> Unit) {
    val cs = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    var password by remember { mutableStateOf("") }
    var confirmRevoke by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (confirmRevoke) "Link intrekken?" else "Instellingen van deze link", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 20.sp)) },
        text = {
            if (confirmRevoke) Text("Wie de link heeft kan de reis daarna niet meer bekijken.", style = TextStyle(fontFamily = Inter, fontSize = 15.sp))
            else Column {
                Text(if (link.hasPassword) "Nieuw wachtwoord" else "Wachtwoord", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(bottom = 6.dp))
                Row(Modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(16.dp)).background(cs.surfaceContainerHighest).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                    BasicTextField(password, { password = it.take(128) }, singleLine = true, textStyle = TextStyle(fontFamily = Inter, fontSize = 15.sp, color = cs.onSurface), cursorBrush = SolidColor(cs.primary), modifier = Modifier.fillMaxWidth())
                }
                error?.let { Text(it, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 13.sp, color = cs.error), modifier = Modifier.padding(top = 6.dp)) }
                Row(Modifier.padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (link.hasPassword) FilledTonalButton(onClick = {
                        scope.launch { runCatching { Remote.setSharePassword(trip, link.id, null) }.onSuccess { onChanged(link.copy(hasPassword = false)); onDismiss() }.onFailure { error = "Opslaan mislukt" } }
                    }, shapes = ButtonDefaults.shapes()) { Text("Wachtwoord verwijderen", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp)) }
                    TextButton(onClick = { confirmRevoke = true }) { Text("Link intrekken", color = cs.error, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp)) }
                }
            }
        },
        confirmButton = {
            if (confirmRevoke) TextButton(onClick = {
                scope.launch { runCatching { Remote.revokeShareLink(trip, link.id) }.onSuccess { onChanged(null); onDismiss() } }
            }) { Text("Intrekken", color = cs.error, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600))) }
            else TextButton(onClick = {
                if (password.length < 4) { error = "Minstens 4 tekens"; return@TextButton }
                scope.launch { runCatching { Remote.setSharePassword(trip, link.id, password) }.onSuccess { onChanged(link.copy(hasPassword = true)); onDismiss() }.onFailure { error = "Opslaan mislukt" } }
            }) { Text("Opslaan", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600))) }
        },
        dismissButton = { TextButton(onClick = { if (confirmRevoke) confirmRevoke = false else onDismiss() }) { Text("Annuleren", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600))) } },
    )
}
