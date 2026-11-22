package nl.markmaaktmedia.markmysteps.next

import android.net.Uri
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import kotlinx.coroutines.launch
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.pluralStringResource

/*
 * The ways into a trip from outside it: a trip you are not on (ask to look along), a link someone sent you
 * (a share link or a trip link, opened in the app), and the note that someone put you on trips.
 */

/** A link handed to the app (a share link or a trip link), waiting until the trips are there to open it. */
object DeepLink {
    var pending by mutableStateOf<Uri?>(null)

    /** The host the app answers links for besides your own server's: set at build time (local.properties linkHost). */
    var linkHost: String = ""

    /** What a link points at: a trip by its id, or a share link by its slug; null for anything else. */
    sealed interface Target {
        data class Trip(val id: String) : Target
        data class Share(val slug: String) : Target
    }

    fun parse(uri: Uri): Target? {
        val host = uri.host?.lowercase() ?: return null
        val own = runCatching { Uri.parse(Api.base).host?.lowercase() }.getOrNull()
        if (host != linkHost.lowercase() && host != own) return null
        val parts = uri.pathSegments.orEmpty()
        return when {
            parts.size >= 2 && parts[0] == "trips" && parts[1].matches(Regex("[0-9a-fA-F-]{36}")) -> Target.Trip(parts[1].lowercase())
            parts.size >= 2 && parts[0] == "s" && parts[1].matches(Regex("[A-Za-z0-9_-]{1,128}")) -> Target.Share(parts[1])
            else -> null
        }
    }
}

/**
 * A trip of someone you travel with that you are not on: whose it is and when, and a way to ask to look along
 * with a line of your own; then that the request waits, or that it was turned down and may be asked again.
 * A trip the server will not tell you about at all is "Deze reis bestaat niet".
 */
@Composable
fun TripAccessPage(tripId: String, onBack: () -> Unit, onOpenTrip: (String) -> Unit) {
    val cs = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    var preview by remember { mutableStateOf<SocialRemote.AccessPreview?>(null) }
    var gone by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var asking by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var sent by remember { mutableStateOf(false) }
    HapticOn(error, Haptic.Reject)
    // A test looks at this page with a made-up trip (adb extra accessPreview); asking then sends nothing.
    val previewOnly = tripId == "preview"
    LaunchedEffect(tripId) {
        if (previewOnly) {
            val f = Data.all.flatMap { it.members }.firstOrNull { it.userId != Data.me?.id }
            preview = SocialRemote.AccessPreview("preview", "Weekend Rome", java.time.LocalDate.of(2026, 5, 14), java.time.LocalDate.of(2026, 5, 17), f?.userId ?: "", f?.name ?: "Sanne", f?.hasAvatar == true, "NONE")
            return@LaunchedEffect
        }
        runCatching { SocialRemote.access(tripId) }
            .onSuccess { p -> if (p.status == "MEMBER") onOpenTrip(p.tripId) else preview = p }
            .onFailure { gone = true }
    }
    Column(Modifier.fillMaxSize().background(cs.background).imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp)) {
        Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
        Box(Modifier.padding(top = 8.dp).size(48.dp).clip(CircleShape).background(cs.surfaceContainerHigh).clickable { haptics(Haptic.Tap); onBack() }, contentAlignment = Alignment.Center) {
            LineIcon(listOf(P("M19 12H5"), P("m12 19-7-7 7-7")), cs.onSurface, size = 22.dp, stroke = 2.2f)
        }
        val motion = MaterialTheme.motionScheme
        AnimatedContent(
            when { gone -> "gone"; preview == null -> "wait"; else -> "trip" },
            transitionSpec = { (fadeIn(motion.defaultEffectsSpec()) + scaleIn(motion.defaultSpatialSpec(), initialScale = 0.96f)) togetherWith fadeOut(motion.fastEffectsSpec()) },
            label = "access",
        ) { state ->
            Column(Modifier.fillMaxWidth().padding(top = 56.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                when (state) {
                    "gone" -> {
                        Glyph(Glyphs.compass, lost = true)
                        Text(stringResource(R.string.access_missing_title), textAlign = TextAlign.Center, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 26.sp, color = cs.onSurface), modifier = Modifier.padding(top = 20.dp))
                        Note(stringResource(R.string.access_missing_body))
                        Button(onClick = onBack, shapes = ButtonDefaults.shapes(), modifier = Modifier.padding(top = 24.dp).height(50.dp)) {
                            Text(stringResource(R.string.access_to_my_trips), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp))
                        }
                    }
                    "wait" -> {
                        // The page's own shapes while it is read: the lock, the title and the line under it.
                        Box(Modifier.size(84.dp).clip(CircleShape).background(cs.surfaceContainerHigh))
                        Placeholder(Modifier.padding(top = 20.dp).size(width = 220.dp, height = 28.dp).clip(CircleShape))
                        Placeholder(Modifier.padding(top = 12.dp).size(width = 140.dp, height = 18.dp).clip(CircleShape))
                    }
                    else -> preview?.let { p -> AccessBody(p, sent, message, { message = it.take(300) }, asking, error) {
                        asking = true; error = null
                        scope.launch {
                            runCatching { if (!previewOnly) SocialRemote.askAccess(p.tripId, message) }
                                .onSuccess { haptics(Haptic.Confirm); sent = true; preview = p.copy(status = "PENDING") }
                                .onFailure { error = (it as? Api.Failure)?.message ?: Lang.text(R.string.access_request_failed) }
                            asking = false
                        }
                    } }
                }
            }
        }
        Spacer(Modifier.height(48.dp))
    }
}

@Composable
private fun Glyph(icon: List<Shape24>, lost: Boolean = false) {
    val cs = MaterialTheme.colorScheme
    Box(Modifier.size(84.dp).clip(CircleShape).background(if (lost) cs.surfaceContainerHigh else cs.primaryContainer), contentAlignment = Alignment.Center) {
        LineIcon(icon, if (lost) cs.onSurfaceVariant else cs.onPrimaryContainer, size = 38.dp, stroke = 1.9f)
    }
}

@Composable
private fun Note(text: String) {
    Text(text, textAlign = TextAlign.Center, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 15.sp, lineHeight = 22.sp, color = MaterialTheme.colorScheme.onSurfaceVariant), modifier = Modifier.padding(top = 10.dp).widthIn(max = 340.dp))
}

@Composable
private fun AccessBody(p: SocialRemote.AccessPreview, sent: Boolean, message: String, onMessage: (String) -> Unit, asking: Boolean, error: String?, onAsk: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Glyph(Glyphs.lock)
    Text(p.title, textAlign = TextAlign.Center, maxLines = 3, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 28.sp, lineHeight = 32.sp, color = cs.onSurface), modifier = Modifier.padding(top = 20.dp))
    if (p.start != null && p.end != null) Text(shortRange(p.start, p.end, year = true), style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 15.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 6.dp))
    Row(Modifier.padding(top = 16.dp).clip(CircleShape).background(cs.surfaceContainerLow).padding(start = 6.dp, end = 16.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Avatar(p.ownerId, p.owner, p.ownerHasAvatar, personColor(p.ownerId), Modifier.size(34.dp))
        Text(buildAnnotatedString { append(stringResource(R.string.access_by)); pushStyle(SpanStyle(fontWeight = FontWeight(650), color = cs.onSurface)); append(p.owner); pop() },
            style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 15.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(start = 10.dp))
    }
    val waiting = p.status == "PENDING"
    val denied = p.status == "DENIED" && !sent
    // Three states in one column, each replacing the last in place, so nothing above it moves.
    val motion = MaterialTheme.motionScheme
    AnimatedContent(if (waiting) "wait" else if (denied) "no" else "ask", transitionSpec = { fadeIn(motion.defaultEffectsSpec()) togetherWith fadeOut(motion.fastEffectsSpec()) }, label = "state") { state ->
        Column(Modifier.fillMaxWidth().padding(top = 22.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            if (state == "wait") {
                Row(Modifier.clip(CircleShape).background(cs.secondaryContainer).padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    LineIcon(Glyphs.hourglass, cs.onSecondaryContainer, size = 16.dp, stroke = 2f)
                    Text(stringResource(R.string.access_request_waiting, p.owner), style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 14.5.sp, color = cs.onSecondaryContainer), modifier = Modifier.padding(start = 8.dp))
                }
                Note(stringResource(R.string.access_request_notice))
            } else {
                if (state == "no") Row(Modifier.padding(bottom = 6.dp).clip(CircleShape).background(cs.errorContainer).padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    LineIcon(listOf(P("M6 6l12 12"), P("M18 6 6 18")), cs.onErrorContainer, size = 15.dp, stroke = 2.2f)
                    Text(stringResource(R.string.access_request_denied), style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 13.5.sp, color = cs.onErrorContainer), modifier = Modifier.padding(start = 8.dp))
                }
                Note(stringResource(R.string.access_not_member, p.owner))
                Column(Modifier.padding(top = 20.dp).fillMaxWidth()) {
                    FormField(stringResource(R.string.access_message), message, onMessage, hint = stringResource(R.string.access_message_hint), capitalize = true, done = onAsk)
                }
                AnimatedVisibility(error != null, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
                    Text(error ?: "", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.error), modifier = Modifier.padding(top = 10.dp))
                }
                MainButton(if (asking) stringResource(R.string.access_sending) else stringResource(R.string.access_ask), onAsk, Modifier.padding(top = 18.dp).fillMaxWidth(), icon = Glyphs.send, busy = asking)
            }
        }
    }
}

/**
 * A share link opened in the app. Signed in and on that trip, the app opens the trip itself; anything else
 * (a trip you are not on) is the public page, which lives on the web: one tap opens it there.
 */
@Composable
fun ShareLinkPage(slug: String, url: String, onBack: () -> Unit, onOpenTrip: (String) -> Unit) {
    val cs = MaterialTheme.colorScheme
    val context = LocalContext.current
    val haptics = rememberHaptics()
    // The link's title, which is the trip's: that is how the app finds it among your own.
    // Null while it is read; a blank title when the link is gone (revoked, or never there).
    val info by produceState<Pair<String, Boolean>?>(null, slug) {
        value = runCatching { org.json.JSONObject(Api.get("/api/share/${Uri.encode(slug)}/info")).let { it.optString("title").ifBlank { Lang.text(R.string.access_shared_trip) } to it.optBoolean("hasPassword") } }.getOrNull() ?: ("" to false)
    }
    val gone = info?.first == ""
    LaunchedEffect(info) {
        val title = info?.first ?: return@LaunchedEffect
        Data.all.firstOrNull { it.remoteId != null && it.title == title }?.let { onOpenTrip(it.id) }
    }
    Column(Modifier.fillMaxSize().background(cs.background).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp)) {
        Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
        Box(Modifier.padding(top = 8.dp).size(48.dp).clip(CircleShape).background(cs.surfaceContainerHigh).clickable { haptics(Haptic.Tap); onBack() }, contentAlignment = Alignment.Center) {
            LineIcon(listOf(P("M19 12H5"), P("m12 19-7-7 7-7")), cs.onSurface, size = 22.dp, stroke = 2.2f)
        }
        Column(Modifier.fillMaxWidth().padding(top = 56.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Glyph(if (gone) Glyphs.compass else Glyphs.globe, lost = gone)
            val title = info?.first
            AnimatedContent(title, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "title") { t ->
                if (t == null) Placeholder(Modifier.padding(top = 20.dp).size(width = 220.dp, height = 28.dp).clip(CircleShape))
                else Text(if (gone) stringResource(R.string.access_link_dead) else t, textAlign = TextAlign.Center, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 26.sp, color = cs.onSurface), modifier = Modifier.padding(top = 20.dp))
            }
            if (info != null) {
                Note(when {
                    gone -> stringResource(R.string.access_link_revoked)
                    info?.second == true -> stringResource(R.string.access_link_password)
                    else -> stringResource(R.string.access_link_other)
                })
                if (gone) MainButton(stringResource(R.string.access_to_my_trips), onBack, Modifier.padding(top = 24.dp))
                else MainButton(stringResource(R.string.access_open_website), { haptics(Haptic.Tap); openOutside(context, url) }, Modifier.padding(top = 24.dp), icon = Glyphs.external)
            }
        }
    }
}

/** Opens a page in a browser, never back in this app (which answers these links itself). */
fun openOutside(context: android.content.Context, url: String) {
    // Through the browser app itself (the selector), so a verified link can never come back here.
    val view = android.content.Intent(android.content.Intent.ACTION_VIEW, Uri.parse(url)).addCategory(android.content.Intent.CATEGORY_BROWSABLE).apply {
        selector = android.content.Intent.makeMainSelectorActivity(android.content.Intent.ACTION_MAIN, android.content.Intent.CATEGORY_APP_BROWSER)
    }
    runCatching { context.startActivity(view) }.onFailure {
        // No app marks itself as the browser: the plain link, which this app only answers when it is verified.
        runCatching { context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, Uri.parse(url))) }
    }
}

/**
 * "Je bent toegevoegd aan x reizen!" once, when someone put you on trips: their names and who, with Later and
 * Bekijk de reis (or Naar mijn reizen for more than one). Closing it is what marks it seen, on every device.
 * [preview] (adb extra invitePreview) shows it with your own trips and never marks anything.
 */
@Composable
fun InviteDialog(preview: Boolean, onOpenTrip: (String) -> Unit) {
    val cs = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    var invites by remember { mutableStateOf<List<SocialRemote.Invite>>(emptyList()) }
    var shown by remember { mutableStateOf(false) }
    LaunchedEffect(Data.live) {
        if (!Data.live) return@LaunchedEffect
        invites = if (preview) Data.all.filter { it.remoteId != null }.take(2).map { SocialRemote.Invite(it.id, it.title, listOf("Sanne", "Joost")[it.title.length % 2], it.coverId) }
        else runCatching { SocialRemote.invites() }.getOrNull().orEmpty()
        shown = invites.isNotEmpty()
    }
    if (!shown || invites.isEmpty()) return
    fun close(goTo: String?) {
        shown = false
        if (!preview) scope.launch { runCatching { SocialRemote.invitesSeen() } }
        if (goTo != null && !preview) onOpenTrip(goTo)
    }
    val single = invites.size == 1
    val grow = remember { Animatable(0.9f) }
    val motion = MaterialTheme.motionScheme
    LaunchedEffect(Unit) { grow.animateTo(1f, motion.defaultSpatialSpec()) }
    Dialog(onDismissRequest = { close(null) }) {
        Column(
            Modifier.widthIn(max = 380.dp).fillMaxWidth().graphicsLayer { scaleX = grow.value; scaleY = grow.value }
                .clip(RoundedCornerShape(32.dp)).background(cs.surfaceContainerLow).padding(start = 22.dp, end = 22.dp, top = 26.dp, bottom = 22.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            LineIcon(Glyphs.logo, cs.primary, size = 48.dp, stroke = 2.1f)
            Text(
                pluralStringResource(R.plurals.access_added, invites.size, invites.size), textAlign = TextAlign.Center,
                style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 23.sp, lineHeight = 27.sp, color = cs.onSurface), modifier = Modifier.padding(top = 14.dp),
            )
            Column(Modifier.padding(top = 18.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                invites.forEachIndexed { i, inv ->
                    val top = if (i == 0) 20.dp else 6.dp; val bottom = if (i == invites.lastIndex) 20.dp else 6.dp
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(top, top, bottom, bottom)).background(cs.surfaceContainerHigh).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        // A photo when the trip has one; a pin when it does not, never an empty frame.
                        if (inv.coverId != null) RemotePhoto(inv.coverId, Modifier.size(44.dp).clip(RoundedCornerShape(12.dp)))
                        else Box(Modifier.size(44.dp).clip(RoundedCornerShape(12.dp)).background(cs.secondaryContainer), contentAlignment = Alignment.Center) { LineIcon(Glyphs.pin, cs.onSecondaryContainer, size = 18.dp) }
                        Column(Modifier.weight(1f).padding(start = 12.dp)) {
                            Text(inv.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 16.sp, color = cs.onSurface))
                            Text(stringResource(R.string.access_invite_by, inv.owner), style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = cs.onSurfaceVariant))
                        }
                    }
                }
            }
            Row(Modifier.padding(top = 20.dp).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val label = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp)
                FilledTonalButton(onClick = { close(null) }, shapes = ButtonDefaults.shapes(), modifier = Modifier.weight(1f).height(50.dp)) { Text(stringResource(R.string.access_later), style = label) }
                Button(onClick = { close(if (single) invites.first().id else null) }, shapes = ButtonDefaults.shapes(), modifier = Modifier.weight(1.4f).height(50.dp)) {
                    Text(if (single) stringResource(R.string.access_view_trip) else stringResource(R.string.access_to_my_trips), maxLines = 1, style = label)
                }
            }
        }
    }
}

/**
 * After an admin reset: "Je gebruikt nog een tijdelijk wachtwoord", on the home page until you chose your own,
 * a tap opens your account where the password is changed. Never dismissable: the point is to change it.
 */
@Composable
fun TempPasswordBar(visible: Boolean, onOpen: () -> Unit, modifier: Modifier = Modifier) {
    val cs = MaterialTheme.colorScheme
    val haptics = rememberHaptics()
    AnimatedVisibility(visible, modifier = modifier, enter = fadeIn(MaterialTheme.motionScheme.defaultEffectsSpec()) + expandVertically(MaterialTheme.motionScheme.defaultSpatialSpec()), exit = fadeOut() + shrinkVertically()) {
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(cs.errorContainer).clickable { haptics(Haptic.Tap); onOpen() }.padding(start = 16.dp, end = 12.dp, top = 14.dp, bottom = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            LineIcon(Glyphs.lock, cs.onErrorContainer, size = 22.dp, stroke = 2f)
            Text(
                buildAnnotatedString {
                    append(stringResource(R.string.access_temp_password))
                    pushStyle(SpanStyle(fontWeight = FontWeight(700))); append(stringResource(R.string.access_account)); pop(); append(".")
                },
                style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 14.sp, lineHeight = 20.sp, color = cs.onErrorContainer),
                modifier = Modifier.weight(1f).padding(horizontal = 12.dp),
            )
            LineIcon(Glyphs.chevronRight, cs.onErrorContainer, size = 18.dp, stroke = 2.2f)
        }
    }
}
