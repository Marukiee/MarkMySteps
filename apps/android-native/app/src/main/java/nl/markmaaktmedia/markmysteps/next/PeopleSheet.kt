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
import androidx.compose.animation.animateContentSize
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.pluralStringResource

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
    HapticOn(error, Haptic.Reject)
    var removing by remember { mutableStateOf<Member?>(null) }
    // Whose days along are being picked.
    var daysFor by remember { mutableStateOf<Member?>(null) }
    val tripFirst = trip.start
    val tripLast = trip.start?.plusDays((trip.days - 1).toLong().coerceAtLeast(0))

    AppSheet(onDismiss = onDismiss) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 28.dp)) {
            Text(stringResource(R.string.people_title), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 24.sp, color = cs.onSurface))
            Text(
                stringResource(R.string.people_hint),
                style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.5.sp, lineHeight = 19.sp, color = cs.onSurfaceVariant),
                modifier = Modifier.padding(top = 4.dp, bottom = 14.dp),
            )
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                members.forEachIndexed { i, m ->
                    MemberRow(m, i, members.size, canChange = owner && m.role != "OWNER", tripFirst = tripFirst, tripLast = tripLast, onDays = if (owner && m.role != "GUEST" && tripFirst != null) ({ daysFor = m }) else null, onRole = { role ->
                        val before = members
                        members = members.map { if (it.userId == m.userId) it.copy(role = role) else it }
                        scope.launch { runCatching { Remote.updateMember(trip, m.userId, role = role) }.onSuccess { onChanged() }.onFailure { members = before; error = Lang.text(R.string.summary_save_failed) } }
                    }, onTrack = { on ->
                        val before = members
                        members = members.map { if (it.userId == m.userId) it.copy(canTrack = on) else it }
                        scope.launch { runCatching { Remote.updateMember(trip, m.userId, canTrack = on) }.onSuccess { onChanged() }.onFailure { members = before; error = Lang.text(R.string.summary_save_failed) } }
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

    daysFor?.let { m ->
        if (tripFirst != null && tripLast != null) DaysAlongSheet(m, tripFirst, tripLast, onDismiss = { daysFor = null }) { from, to ->
            // The whole trip is stored as nothing on that side, so moving the trip keeps meaning the whole trip.
            val f = from.takeIf { it != tripFirst }?.toString(); val t = to.takeIf { it != tripLast }?.toString()
            val before = members
            members = members.map { if (it.userId == m.userId) it.copy(from = f, to = t) else it }
            scope.launch { runCatching { SocialRemote.setMemberDays(trip, m.userId, f, t) }.onSuccess { onChanged() }.onFailure { members = before; error = (it as? Api.Failure)?.message ?: Lang.text(R.string.summary_save_failed) } }
        }
    }

    removing?.let { m ->
        AlertDialog(
            onDismissRequest = { removing = null },
            title = { Text(if (m.role == "GUEST") stringResource(R.string.people_remove_guest) else stringResource(R.string.people_remove_companion), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 20.sp)) },
            text = { Text(stringResource(R.string.people_remove_body, m.name), style = TextStyle(fontFamily = Inter, fontSize = 15.sp)) },
            confirmButton = {
                TextButton(onClick = {
                    removing = null
                    val before = members
                    members = members - m
                    scope.launch { runCatching { Remote.removeMember(trip, m.userId) }.onSuccess { onChanged() }.onFailure { members = before; error = Lang.text(R.string.people_remove_failed) } }
                }) { Text(stringResource(R.string.home_delete), color = cs.error, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600))) }
            },
            dismissButton = { TextButton(onClick = { removing = null }) { Text(stringResource(R.string.common_cancel), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600))) } },
        )
    }
}

/** To share the trip in another way: the photo book and the summary posters (PhotoBook.kt, Summary.kt). */
@Composable
private fun Make(onMake: (String) -> Unit) {
    val cs = MaterialTheme.colorScheme
    Text(stringResource(R.string.people_summary_book), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(start = 4.dp, top = 22.dp, bottom = 8.dp))
    val items = listOf(
        Triple("book", stringResource(R.string.book_title), stringResource(R.string.people_book_hint)) to Glyphs.photo,
        Triple("summary", stringResource(R.string.summary_title), stringResource(R.string.people_summary_hint)) to Glyphs.sun,
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
private fun MemberRow(
    m: Member, i: Int, n: Int, canChange: Boolean, tripFirst: java.time.LocalDate?, tripLast: java.time.LocalDate?, onDays: (() -> Unit)?,
    onRole: (String) -> Unit, onTrack: (Boolean) -> Unit, onRemove: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    var menu by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().clip(slab(i, n)).background(cs.surfaceContainerHigh).padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Avatar(m.userId, m.name, m.hasAvatar, personColor(m.userId), Modifier.size(44.dp))
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Text(m.name, maxLines = 1, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 16.5.sp, color = cs.onSurface))
            val role = when (m.role) { "OWNER" -> stringResource(R.string.people_role_owner); "GUEST" -> stringResource(R.string.people_role_guest); else -> stringResource(R.string.people_role_companion) }
            // A companion who was only there part of the time: which days, as the web writes them.
            val days = if (m.role != "GUEST" && (m.from != null || m.to != null)) {
                val a = parseDay(m.from) ?: tripFirst; val b = parseDay(m.to) ?: tripLast
                if (a != null && b != null) " · ${shortRange(a, b)}" else stringResource(R.string.people_part_of_trip)
            } else ""
            val track = if (m.role != "GUEST" && !m.canTrack) stringResource(R.string.people_no_tracking) else ""
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
                        MenuEntry(stringResource(R.string.people_companion), Glyphs.friends, selected = m.role != "GUEST") { if (m.role == "GUEST") onRole("MEMBER") },
                        MenuEntry(stringResource(R.string.people_guest), Glyphs.person, selected = m.role == "GUEST") { if (m.role != "GUEST") onRole("GUEST") },
                    ),
                    if (m.role != "GUEST") listOfNotNull(
                        MenuEntry(stringResource(R.string.people_can_track), Glyphs.distance, selected = m.canTrack) { onTrack(!m.canTrack) },
                        onDays?.let { go -> MenuEntry(stringResource(R.string.people_days_along), CalendarGlyph) { go() } },
                    ) else emptyList(),
                    listOf(MenuEntry(stringResource(R.string.home_delete), Glyphs.trash, danger = true) { onRemove() }),
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
    val haptics = rememberHaptics()
    LaunchedEffect(query) {
        if (query.isBlank()) { found = null; return@LaunchedEffect }
        delay(250) // one lookup per pause in typing, not per letter
        found = runCatching { Remote.findPeople(query) }.getOrNull()?.filter { it.username !in existing }
    }
    Text(stringResource(R.string.people_add_someone), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 22.dp, bottom = 8.dp))
    Row(Modifier.fillMaxWidth().height(52.dp).clip(CircleShape).background(cs.surfaceContainerHighest).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        LineIcon(Glyphs.search, cs.onSurfaceVariant, size = 20.dp)
        Box(Modifier.weight(1f).padding(start = 12.dp)) {
            if (query.isEmpty()) Text(stringResource(R.string.people_search), style = TextStyle(fontFamily = Inter, fontSize = 15.sp, color = cs.onSurfaceVariant))
            BasicTextField(query, { query = it }, singleLine = true, textStyle = TextStyle(fontFamily = Inter, fontSize = 15.sp, color = cs.onSurface), cursorBrush = SolidColor(cs.primary), modifier = Modifier.fillMaxWidth())
        }
    }
    val list = found
    if (list != null) {
        if (list.isEmpty()) {
            Text(stringResource(R.string.people_none_found), style = TextStyle(fontFamily = Inter, fontSize = 14.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 10.dp))
        } else Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            list.take(8).forEachIndexed { i, f ->
                val on = f.username in picked
                Row(
                    Modifier.fillMaxWidth().clip(slab(i, minOf(8, list.size))).background(if (on) cs.secondaryContainer else cs.surfaceContainerHigh)
                        .clickable { haptics.toggle(!on); picked = if (on) picked - f.username else picked + f.username }.padding(horizontal = 12.dp, vertical = 9.dp),
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
                pluralStringResource(R.plurals.people_add_as, picked.size, picked.size),
                style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.5.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(bottom = 8.dp),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(ButtonGroupDefaults.ConnectedSpaceBetween), verticalAlignment = Alignment.CenterVertically) {
                listOf(false to stringResource(R.string.people_companion), true to stringResource(R.string.people_guest)).forEachIndexed { i, (isGuest, label) ->
                    ToggleButton(
                        checked = guest == isGuest, onCheckedChange = { if (guest != isGuest) haptics(Haptic.Tick); guest = isGuest },
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
                            runCatching { Remote.addMembers(trip, picked.toList(), guest) }.onSuccess { haptics(Haptic.Confirm); picked = emptySet(); query = ""; onAdded() }
                            busy = false
                        }
                    },
                    enabled = !busy, shapes = ButtonDefaults.shapes(), modifier = Modifier.height(48.dp),
                ) {
                    if (busy) LoadingIndicator(Modifier.size(22.dp), color = cs.onPrimary)
                    else Text(stringResource(R.string.common_add), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp))
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
    val haptics = rememberHaptics()
    HapticOn(error, Haptic.Reject)
    LaunchedEffect(trip.id) { links = runCatching { Remote.shareLinks(trip) }.getOrNull() ?: emptyList() }
    LaunchedEffect(copied) { if (copied != null) { delay(1600); copied = null } }

    Text(stringResource(R.string.summary_share), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
    Text(
        if (owner) stringResource(R.string.people_share_owner) else stringResource(R.string.people_share_member),
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
                            haptics(Haptic.Confirm)
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
                        if (link.hasPassword) LinkPassword(trip, link)
                    }
                    // A clear primary button, so "Kopieer" reads on the row's tone.
                    androidx.compose.material3.Button(onClick = {
                        (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("MarkMySteps", link.url))
                        haptics(Haptic.Confirm)
                        copied = link.id
                    }, shapes = ButtonDefaults.shapes(), modifier = Modifier.padding(start = 10.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 8.dp)) {
                        Text(if (copied == link.id) stringResource(R.string.common_copied) else stringResource(R.string.people_copy), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp))
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
                        if (newPassword.isEmpty()) Text(stringResource(R.string.people_password_optional), style = TextStyle(fontFamily = Inter, fontSize = 14.5.sp, color = cs.onSurfaceVariant))
                        BasicTextField(newPassword, { newPassword = it.take(128) }, singleLine = true, textStyle = TextStyle(fontFamily = Inter, fontSize = 14.5.sp, color = cs.onSurface), cursorBrush = SolidColor(cs.primary), modifier = Modifier.fillMaxWidth())
                    }
                }
                Spacer(Modifier.size(8.dp))
                androidx.compose.material3.Button(
                    onClick = {
                        if (newPassword.isNotEmpty() && newPassword.length < 4) { error = Lang.text(R.string.people_password_min); return@Button }
                        creating = true; error = null
                        scope.launch {
                            runCatching { Remote.createShareLink(trip, newPassword.ifBlank { null }) }
                                .onSuccess { haptics(Haptic.Confirm); links = (links ?: emptyList()) + it; newPassword = "" }
                                .onFailure { error = Lang.text(R.string.people_create_failed) }
                            creating = false
                        }
                    },
                    enabled = !creating, shapes = ButtonDefaults.shapes(), modifier = Modifier.height(48.dp),
                ) {
                    Box(Modifier.size(18.dp), contentAlignment = Alignment.Center) {
                        if (creating) LoadingIndicator(Modifier.size(18.dp), color = cs.onPrimary) else LineIcon(Glyphs.plus, cs.onPrimary, size = 18.dp, stroke = 2.4f)
                    }
                    Spacer(Modifier.size(6.dp))
                    Text(stringResource(R.string.people_share_link), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp))
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
    HapticOn(error, Haptic.Reject)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (confirmRevoke) stringResource(R.string.people_revoke_title) else stringResource(R.string.people_link_settings), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 20.sp)) },
        text = {
            if (confirmRevoke) Text(stringResource(R.string.people_revoke_body), style = TextStyle(fontFamily = Inter, fontSize = 15.sp))
            else Column {
                Text(if (link.hasPassword) stringResource(R.string.people_new_password) else stringResource(R.string.auth_password), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(bottom = 6.dp))
                Row(Modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(16.dp)).background(cs.surfaceContainerHighest).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                    BasicTextField(password, { password = it.take(128) }, singleLine = true, textStyle = TextStyle(fontFamily = Inter, fontSize = 15.sp, color = cs.onSurface), cursorBrush = SolidColor(cs.primary), modifier = Modifier.fillMaxWidth())
                }
                error?.let { Text(it, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 13.sp, color = cs.error), modifier = Modifier.padding(top = 6.dp)) }
                Row(Modifier.padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (link.hasPassword) FilledTonalButton(onClick = {
                        scope.launch { runCatching { Remote.setSharePassword(trip, link.id, null) }.onSuccess { onChanged(link.copy(hasPassword = false)); onDismiss() }.onFailure { error = Lang.text(R.string.summary_save_failed) } }
                    }, shapes = ButtonDefaults.shapes()) { Text(stringResource(R.string.people_password_remove), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp)) }
                    TextButton(onClick = { confirmRevoke = true }) { Text(stringResource(R.string.people_revoke), color = cs.error, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp)) }
                }
            }
        },
        confirmButton = {
            if (confirmRevoke) TextButton(onClick = {
                scope.launch { runCatching { Remote.revokeShareLink(trip, link.id) }.onSuccess { onChanged(null); onDismiss() } }
            }) { Text(stringResource(R.string.people_revoke_confirm), color = cs.error, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600))) }
            else TextButton(onClick = {
                if (password.length < 4) { error = Lang.text(R.string.people_min_chars); return@TextButton }
                scope.launch { runCatching { Remote.setSharePassword(trip, link.id, password) }.onSuccess { onChanged(link.copy(hasPassword = true)); onDismiss() }.onFailure { error = Lang.text(R.string.summary_save_failed) } }
            }) { Text(stringResource(R.string.home_save), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600))) }
        },
        dismissButton = { TextButton(onClick = { if (confirmRevoke) confirmRevoke = false else onDismiss() }) { Text(stringResource(R.string.common_cancel), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600))) } },
    )
}


/** A calendar, for the days someone was along. */
private val CalendarGlyph = listOf(
    P("M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"), P("M4 10h16"), P("M8 3v4"), P("M16 3v4"),
)

/**
 * "Met wachtwoord", and beside it "Bekijken": whoever is on the trip may read the password back, since the link
 * is already out there. Shown, a tap on it copies it. A password from before this could be read back says so.
 */
@Composable
private fun LinkPassword(trip: Trip, link: Remote.ShareLink) {
    val cs = MaterialTheme.colorScheme
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    // Null until asked; then the password, or null inside when it cannot be read back.
    var secret by remember(link.id) { mutableStateOf<Pair<String?, Boolean>?>(null) }
    var busy by remember { mutableStateOf(false) }
    var copied by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(copied) { if (copied) { delay(1600); copied = false } }
    Column(Modifier.padding(top = 3.dp).animateContentSize(MaterialTheme.motionScheme.defaultSpatialSpec())) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            LineIcon(Glyphs.lock, cs.onSurfaceVariant, size = 13.dp, stroke = 2f)
            Text(stringResource(R.string.people_with_password), style = TextStyle(fontFamily = Inter, fontSize = 12.5.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(start = 4.dp))
            if (secret == null) Text(
                if (failed) stringResource(R.string.people_fetch_failed) else stringResource(R.string.people_view),
                style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 13.sp, color = if (failed) cs.error else cs.primary),
                modifier = Modifier.padding(start = 6.dp).clip(CircleShape).clickable(enabled = !busy) {
                    haptics(Haptic.Tap); busy = true; failed = false
                    scope.launch { runCatching { SocialRemote.sharePassword(trip, link.id) }.onSuccess { secret = it }.onFailure { failed = true }; busy = false }
                }.padding(horizontal = 6.dp, vertical = 2.dp),
            )
        }
        val shown = secret
        SecureWhile(shown != null)
        if (shown != null) {
            val (pw, recoverable) = shown
            if (pw == null || !recoverable) Text(
                stringResource(R.string.people_password_old) + if (link.canManage) stringResource(R.string.people_password_set_new) else "",
                style = TextStyle(fontFamily = Inter, fontSize = 12.5.sp, lineHeight = 17.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 4.dp),
            ) else Row(
                Modifier.padding(top = 6.dp).clip(CircleShape).background(cs.surfaceContainerHighest).clickable {
                    copySecret(context, "MarkMySteps", pw)
                    haptics(Haptic.Confirm); copied = true
                }.padding(start = 12.dp, end = 10.dp, top = 6.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(pw, style = TextStyle(fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.onSurface))
                androidx.compose.animation.Crossfade(copied, label = "copied") { done ->
                    LineIcon(if (done) Glyphs.check else listOf(P("M9 9h10v10H9z"), P("M5 15V5h10")), if (done) cs.primary else cs.onSurfaceVariant, size = 15.dp, stroke = 2f, modifier = Modifier.padding(start = 8.dp))
                }
            }
        }
    }
}

/** "Dagen mee": the days someone was along, picked on the trip's own calendar, or the whole trip again. */
@Composable
private fun DaysAlongSheet(m: Member, first: java.time.LocalDate, last: java.time.LocalDate, onDismiss: () -> Unit, onPick: (java.time.LocalDate, java.time.LocalDate) -> Unit) {
    val cs = MaterialTheme.colorScheme
    var a by remember { mutableStateOf(parseDay(m.from) ?: first) }
    var b by remember { mutableStateOf<java.time.LocalDate?>(parseDay(m.to) ?: last) }
    AppSheet(onDismiss = onDismiss) {
        val sheet = this
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 20.dp)) {
            Text(stringResource(R.string.people_days_along), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 24.sp, color = cs.onSurface))
            Text(
                stringResource(R.string.people_days_question, m.name, shortRange(a, b ?: a)),
                style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 14.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 2.dp),
            )
            RangeCalendar(a, b, onChange = { x, y -> if (x != null) { a = x; b = y } }, modifier = Modifier.padding(top = 16.dp), bounds = first..last)
            Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val label = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp)
                FilledTonalButton(onClick = { onPick(first, last); sheet.close() }, shapes = ButtonDefaults.shapes(), modifier = Modifier.weight(1f).height(50.dp)) { Text(stringResource(R.string.map_whole_trip), style = label) }
                androidx.compose.material3.Button(onClick = { onPick(a, b ?: a); sheet.close() }, shapes = ButtonDefaults.shapes(), modifier = Modifier.weight(1f).height(50.dp)) { Text(stringResource(R.string.home_save), style = label) }
            }
        }
    }
}
