package nl.markmaaktmedia.markmysteps.next

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
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
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.layout.layout
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

/*
 * The talk around a trip, as on the web: each day's stories (yours to write, change and remove, the others'
 * to read), the comments under a day's story with a like on each, and on the photo tiles how many people
 * reacted and how many wrote something.
 */

/** The trip's stories, comments and reactions, read once by the trip page and shared by the timeline. */
class TripTalk(val trip: Trip) {
    var notes by mutableStateOf<List<SocialRemote.DayNote>>(emptyList())
    var comments by mutableStateOf<List<SocialRemote.Comment>>(emptyList())
    var reactions by mutableStateOf(Remote.Reactions(emptyMap(), emptyMap(), emptyMap()))

    suspend fun load() {
        if (trip.remoteId == null) return
        runCatching { SocialRemote.notes(trip) }.getOrNull()?.let { notes = it }
        loadTalk()
    }

    /** Comments and reactions again, after the viewer (where most of them are made) closes. */
    suspend fun loadTalk() {
        if (trip.remoteId == null) return
        runCatching { SocialRemote.comments(trip) }.getOrNull()?.let { comments = it }
        runCatching { Remote.reactions(trip) }.getOrNull()?.let { reactions = it }
    }

    /** Your like on a comment, shown at once and taken back if the server says no. */
    fun likeTarget(target: String, on: Boolean) {
        val before = reactions
        val counts = reactions.counts.toMutableMap()
        val list = counts[target].orEmpty().toMutableList()
        val had = reactions.mine[target] != null
        if (on && !had) {
            val i = list.indexOfFirst { it.first == "heart" }
            if (i >= 0) list[i] = "heart" to list[i].second + 1 else list += "heart" to 1
        } else if (!on && had) {
            val i = list.indexOfFirst { it.first == "heart" }
            if (i >= 0) list[i] = "heart" to (list[i].second - 1)
        }
        counts[target] = list.filter { it.second > 0 }
        val mine = reactions.mine.toMutableMap().apply { if (on) put(target, "heart") else remove(target) }
        val me = Data.me?.name
        val names = reactions.names.toMutableMap().apply {
            val who = get(target).orEmpty().filter { it.second != me }
            put(target, if (on && me != null) who + ("heart" to me) else who)
        }
        reactions = Remote.Reactions(counts, mine, names)
        scope?.launch { runCatching { SocialRemote.likeComment(trip, target.removePrefix("c:"), on) }.onFailure { reactions = before } }
    }

    var scope: kotlinx.coroutines.CoroutineScope? = null
}

private val ReactionEmoji = mapOf("heart" to "❤️", "laugh" to "😂", "wow" to "😮", "love" to "😍", "clap" to "👏")

/**
 * Top right on a photo tile, side by side: the most given emoji with the total, and a speech bubble with how
 * many wrote something; a tap on that one goes straight to the conversation.
 */
@Composable
fun TileFlags(reactions: List<Pair<String, Int>>, comments: Int, onComments: () -> Unit, modifier: Modifier = Modifier) {
    val total = reactions.sumOf { it.second }
    if (total <= 0 && comments <= 0) return
    val pill = Color.Black.copy(alpha = 0.5f)
    val style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(650), fontSize = 11.5.sp, color = Color.White)
    Row(modifier.padding(6.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        if (total > 0) Row(Modifier.heightIn(min = 22.dp).clip(CircleShape).background(pill).padding(horizontal = 7.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            reactions.take(2).forEach { (kind, _) -> Text(ReactionEmoji[kind] ?: "", style = style.copy(fontSize = 11.sp)) }
            Text("$total", style = style, modifier = Modifier.padding(start = 3.dp))
        }
        if (comments > 0) {
            val haptics = rememberHaptics()
            Row(
                Modifier.heightIn(min = 22.dp).clip(CircleShape).background(pill).clickable { haptics(Haptic.Tap); onComments() }.padding(horizontal = 7.dp, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                LineIcon(Glyphs.comment, Color.White, size = 12.dp, stroke = 2.2f)
                Text("$comments", style = style, modifier = Modifier.padding(start = 3.dp))
            }
        }
    }
}

/** The pencil beside a day's date that starts a story on a day without one. */
@Composable
fun WriteStoryButton(onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val haptics = rememberHaptics()
    Box(
        Modifier.padding(start = 8.dp).size(34.dp).clip(CircleShape).background(cs.surfaceContainerHigh).clickable { haptics(Haptic.Tap); onClick() },
        contentAlignment = Alignment.Center,
    ) { LineIcon(Glyphs.pencil, cs.onSurfaceVariant, size = 16.dp, stroke = 2f) }
}

/**
 * A day's stories: the others' to read, yours with Bewerken and Verwijderen, and the box to write or change
 * yours. Changing between reading and writing morphs in place; nothing pops in.
 */
@Composable
fun DayStory(
    day: String, notes: List<SocialRemote.DayNote>, canEdit: Boolean, editing: Boolean,
    onEdit: () -> Unit, onDone: () -> Unit, onSave: suspend (String) -> Unit, onDelete: (SocialRemote.DayNote) -> Unit,
    modifier: Modifier = Modifier,
) {
    val cs = MaterialTheme.colorScheme
    val me = Data.me?.id
    val own = notes.firstOrNull { me != null && it.authorId == me }
    val others = notes.filter { it !== own }
    val motion = MaterialTheme.motionScheme
    Column(modifier.fillMaxWidth().animateContentSize(motion.defaultSpatialSpec()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        // No name under the story: whose trip it is, the page already says.
        others.forEach { n -> StoryCard(n.body, own = false) }
        AnimatedContent(
            editing to own?.body,
            transitionSpec = { (fadeIn(motion.defaultEffectsSpec()) + scaleIn(motion.defaultSpatialSpec(), initialScale = 0.97f)) togetherWith fadeOut(motion.fastEffectsSpec()) using SizeTransform(clip = false) },
            contentKey = { it.first },
            label = "story",
        ) { (writing, body) ->
            if (writing && canEdit) StoryEditor(day, body.orEmpty(), onCancel = onDone, onSave = onSave)
            else if (body != null && own != null) Column {
                StoryCard(body, own = true)
                if (canEdit) Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    SmallPill("Bewerken", Glyphs.pencil, cs.surfaceContainerHigh, cs.onSurface, onEdit)
                    SmallPill("Verwijderen", Glyphs.trash, cs.errorContainer.copy(alpha = 0.55f), cs.error) { onDelete(own) }
                }
            } else Spacer(Modifier.size(0.dp))
        }
    }
}

@Composable
private fun StoryCard(body: String, own: Boolean) {
    val cs = MaterialTheme.colorScheme
    Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(if (own) cs.secondaryContainer.copy(alpha = 0.55f) else cs.surfaceContainerLow).padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 14.dp)) {
        // The little opening quote in the accent, as the web has on its story.
        // Drawn without taking room, so the card is as tall as its words.
        Text("“", style = TextStyle(fontFamily = Fraunces, fontWeight = FontWeight(600), fontSize = 30.sp, color = cs.primary.copy(alpha = 0.5f)),
            modifier = Modifier.layout { m, c -> val p = m.measure(c.copy(minWidth = 0, minHeight = 0)); layout(0, 0) { p.place(-8.dp.roundToPx(), -14.dp.roundToPx()) } })
        Text(body, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(450), fontSize = 16.sp, lineHeight = 24.sp, color = cs.onSurface))
    }
}

@Composable
private fun SmallPill(label: String, icon: List<Shape24>, bg: Color, fg: Color, onClick: () -> Unit) {
    val haptics = rememberHaptics()
    Row(
        Modifier.clip(CircleShape).background(bg).clickable { haptics(Haptic.Tap); onClick() }.padding(start = 12.dp, end = 14.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LineIcon(icon, fg, size = 15.dp, stroke = 2f)
        Text(label, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 13.5.sp, color = fg), modifier = Modifier.padding(start = 6.dp))
    }
}

@Composable
private fun StoryEditor(day: String, start: String, onCancel: () -> Unit, onSave: suspend (String) -> Unit) {
    val cs = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    var draft by remember(day) { mutableStateOf(start) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    HapticOn(error, Haptic.Reject)
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    Column(Modifier.fillMaxWidth()) {
        Box(Modifier.fillMaxWidth().heightIn(min = 104.dp).clip(RoundedCornerShape(20.dp)).background(cs.surfaceContainerHighest).padding(16.dp)) {
            val text = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(450), fontSize = 16.sp, lineHeight = 24.sp, color = cs.onSurface)
            if (draft.isEmpty()) Text("Schrijf iets over deze dag…", style = text.copy(color = cs.onSurfaceVariant.copy(alpha = 0.7f)))
            BasicTextField(
                draft, { draft = it.take(8000) }, textStyle = text, cursorBrush = SolidColor(cs.primary),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                modifier = Modifier.fillMaxWidth().focusRequester(focus),
            )
        }
        AnimatedVisibility(error != null, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
            Text(error ?: "", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 13.5.sp, color = cs.error), modifier = Modifier.padding(top = 8.dp, start = 4.dp))
        }
        Row(Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            val label = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp)
            FilledTonalButton(onClick = onCancel, shapes = ButtonDefaults.shapes()) { Text("Annuleren", style = label) }
            Button(
                onClick = {
                    busy = true; error = null
                    scope.launch { runCatching { onSave(draft.trim()) }.onFailure { error = "Opslaan mislukt" }; busy = false }
                },
                enabled = !busy && draft.isNotBlank(), shapes = ButtonDefaults.shapes(),
            ) {
                Box(Modifier.width(if (busy) 24.dp else 0.dp), contentAlignment = Alignment.CenterStart) {
                    if (busy) androidx.compose.material3.LoadingIndicator(Modifier.size(18.dp), color = cs.onPrimary)
                }
                Text("Opslaan", style = label)
            }
        }
    }
}

/** "12 aug 14:05", as the web writes when a comment was made. */
private fun commentTime(at: java.time.Instant): String {
    val t = at.atZone(java.time.ZoneId.systemDefault())
    return "${t.dayOfMonth} ${listOf("jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec")[t.monthValue - 1]} %02d:%02d".format(t.hour, t.minute)
}

/**
 * Under a day's story: the last comment and a clear "Reageer" with the count; open, the thread in place
 * with a like on each comment and the box to add one.
 */
@Composable
fun DayThread(talk: TripTalk, day: String, modifier: Modifier = Modifier) {
    val cs = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val comments = talk.comments.filter { it.mediaId == null && it.day == day }.sortedBy { it.at }
    var open by androidx.compose.runtime.saveable.rememberSaveable(day) { mutableStateOf(false) }
    val motion = MaterialTheme.motionScheme
    AnimatedContent(
        open, modifier = modifier.fillMaxWidth(),
        transitionSpec = { (fadeIn(motion.defaultEffectsSpec()) + expandVertically(motion.defaultSpatialSpec())) togetherWith (fadeOut(motion.fastEffectsSpec()) + shrinkVertically(motion.fastSpatialSpec())) using SizeTransform(clip = false) },
        label = "thread",
    ) { shown ->
        if (!shown) Column {
            comments.lastOrNull()?.let { last ->
                val body = if (last.body.length > 90) last.body.take(90) + "…" else last.body
                Text(
                    androidx.compose.ui.text.buildAnnotatedString {
                        pushStyle(androidx.compose.ui.text.SpanStyle(fontWeight = FontWeight(650), color = cs.onSurface)); append(last.author); pop(); append(": $body")
                    },
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                    style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(450), fontSize = 14.sp, lineHeight = 20.sp, color = cs.onSurfaceVariant),
                    modifier = Modifier.padding(bottom = 6.dp, start = 4.dp),
                )
            }
            Row(
                Modifier.clip(CircleShape).background(cs.surfaceContainerHigh).clickable { haptics(Haptic.Tap); open = true }.padding(start = 12.dp, end = 14.dp, top = 8.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                LineIcon(Glyphs.comment, cs.onSurface, size = 15.dp, stroke = 2f)
                Text("Reageer", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 13.5.sp, color = cs.onSurface), modifier = Modifier.padding(start = 6.dp))
                if (comments.isNotEmpty()) Box(Modifier.padding(start = 8.dp).clip(CircleShape).background(cs.primary).padding(horizontal = 7.dp, vertical = 1.dp)) {
                    Text("${comments.size}", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 12.sp, color = cs.onPrimary))
                }
            }
        } else Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(cs.surfaceContainerLow).padding(start = 14.dp, end = 8.dp, top = 6.dp, bottom = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (comments.isEmpty()) "Reacties" else plural(comments.size, "reactie", "reacties"),
                    style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 15.5.sp, color = cs.onSurface), modifier = Modifier.weight(1f),
                )
                Box(Modifier.size(40.dp).clip(CircleShape).clickable { open = false }, contentAlignment = Alignment.Center) {
                    LineIcon(listOf(P("m6 15 6-6 6 6")), cs.onSurfaceVariant, size = 20.dp, stroke = 2.2f)
                }
            }
            comments.forEach { c ->
                androidx.compose.runtime.key(c.id) {
                    CommentRow(c, talk, onDelete = {
                        val before = talk.comments
                        talk.comments = talk.comments.filter { it.id != c.id }
                        scope.launch { runCatching { SocialRemote.deleteComment(talk.trip, c.id) }.onFailure { talk.comments = before } }
                    })
                }
            }
            CommentBox(onSend = { text ->
                val made = SocialRemote.addDayComment(talk.trip, day, text)
                // In a dry run nothing comes back: the comment still shows, as written, so the flow can be seen.
                talk.comments = talk.comments + (made ?: SocialRemote.Comment(
                    "local-" + java.util.UUID.randomUUID(), null, day, Data.me?.name ?: "Jij", text, java.time.Instant.now(), canDelete = true, traveller = true,
                ))
            })
        }
    }
}

@Composable
private fun CommentRow(c: SocialRemote.Comment, talk: TripTalk, onDelete: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val haptics = rememberHaptics()
    val target = "c:${c.id}"
    val liked = talk.reactions.mine[target] != null
    val likes = talk.reactions.counts[target].orEmpty().sumOf { it.second }
    Column(Modifier.fillMaxWidth().padding(top = 8.dp, end = 6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(c.author, maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 14.sp, color = cs.onSurface), modifier = Modifier.widthIn(max = 170.dp))
            if (c.traveller) Box(Modifier.padding(start = 6.dp).clip(CircleShape).background(cs.secondaryContainer).padding(horizontal = 7.dp, vertical = 1.dp)) {
                Text("reiziger", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 11.sp, color = cs.onSecondaryContainer))
            }
            Text(commentTime(c.at), style = TextStyle(fontFamily = Inter, fontSize = 12.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(start = 8.dp))
            Spacer(Modifier.weight(1f))
            if (c.canDelete) Box(Modifier.size(32.dp).clip(CircleShape).clickable { haptics(Haptic.Tap); onDelete() }, contentAlignment = Alignment.Center) {
                LineIcon(Glyphs.trash, cs.onSurfaceVariant, size = 15.dp, stroke = 1.9f)
            }
        }
        Text(c.body, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(450), fontSize = 14.5.sp, lineHeight = 21.sp, color = cs.onSurface), modifier = Modifier.padding(top = 2.dp))
        // One like: a heart and how many, filled when it is yours.
        val heart by animateColorAsState(if (liked) Color(0xFFE5484D) else cs.onSurfaceVariant, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "heart")
        val pop by animateFloatAsState(if (liked) 1f else 0f, MaterialTheme.motionScheme.fastSpatialSpec(), label = "pop")
        Row(
            Modifier.padding(top = 4.dp).clip(CircleShape).clickable { haptics(if (liked) Haptic.Tick else Haptic.Confirm); talk.likeTarget(target, !liked) }.padding(horizontal = 6.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            LineIcon(Glyphs.heart, heart, size = 15.dp, stroke = 2f, filled = liked, modifier = Modifier.graphicsLayer { val s = 1f + 0.18f * pop * (1f - pop) * 4f; scaleX = s; scaleY = s })
            if (likes > 0) Text("$likes", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 12.5.sp, color = heart), modifier = Modifier.padding(start = 4.dp))
        }
    }
}

@Composable
private fun CommentBox(onSend: suspend (String) -> Unit) {
    val cs = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    var body by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    HapticOn(error, Haptic.Reject)
    Row(Modifier.fillMaxWidth().padding(top = 10.dp, end = 6.dp), verticalAlignment = Alignment.Bottom) {
        Box(Modifier.weight(1f).heightIn(min = 46.dp).clip(RoundedCornerShape(23.dp)).background(cs.surfaceContainerHighest).padding(horizontal = 16.dp, vertical = 12.dp)) {
            val text = TextStyle(fontFamily = Inter, fontSize = 15.sp, lineHeight = 21.sp, color = cs.onSurface)
            if (body.isEmpty()) Text("Schrijf een reactie…", style = text.copy(color = cs.onSurfaceVariant.copy(alpha = 0.7f)))
            BasicTextField(body, { body = it.take(2000) }, textStyle = text, cursorBrush = SolidColor(cs.primary), maxLines = 5,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences), modifier = Modifier.fillMaxWidth())
        }
        Button(
            onClick = {
                val text = body.trim()
                busy = true; error = null
                scope.launch {
                    runCatching { onSend(text) }
                        .onSuccess { body = ""; haptics(Haptic.Confirm) }
                        .onFailure { error = if ((it as? Api.Failure)?.status == 429) "Even geduld, je reageert wat snel. Probeer het zo opnieuw." else "Je reactie is niet verstuurd. Probeer het opnieuw." }
                    busy = false
                }
            },
            enabled = !busy && body.isNotBlank(), shapes = ButtonDefaults.shapes(),
            modifier = Modifier.padding(start = 8.dp).heightIn(min = 46.dp),
        ) { Text("Plaats", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp)) }
    }
    AnimatedVisibility(error != null, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
        Text(error ?: "", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 13.sp, color = cs.error), modifier = Modifier.padding(top = 6.dp, start = 4.dp))
    }
}
