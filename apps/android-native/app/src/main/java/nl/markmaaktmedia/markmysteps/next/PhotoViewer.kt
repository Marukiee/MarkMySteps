package nl.markmaaktmedia.markmysteps.next

import android.app.Activity
import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import android.os.Build
import androidx.activity.compose.PredictiveBackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import java.time.format.TextStyle as DateStyle
import java.util.Locale

/*
 * A trip's photos full screen, swiped through one by one. Each opens on the
 * quick preview and then gets the original, the only rendition that still
 * carries an HDR gain map (Immich's smaller ones drop it). While such a photo
 * is on screen the window goes into HDR mode, so it shows as bright as on the
 * phone that took it; it goes back to normal when the viewer closes.
 */

@Composable
fun PhotoViewer(trip: Trip, photos: List<Media>, start: Int, onClose: () -> Unit) {
    val pager = rememberPagerState(initialPage = start) { photos.size }
    val activity = LocalContext.current as? Activity
    var hdr by remember { mutableStateOf(false) }
    var chrome by remember { mutableStateOf(true) }
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val back = remember { Animatable(0f) }
    val appear = remember { Animatable(0f) }
    LaunchedEffect(Unit) { appear.animateTo(1f, androidx.compose.animation.core.tween(260)) }

    // The trip's comments and reactions, read once; your own changes show at once and go to the server behind them.
    var comments by remember { mutableStateOf<List<Remote.Comment>>(emptyList()) }
    var reactions by remember { mutableStateOf(Remote.Reactions(emptyMap(), emptyMap(), emptyMap())) }
    LaunchedEffect(trip.remoteId) {
        if (trip.remoteId == null) return@LaunchedEffect
        runCatching { Remote.comments(trip) }.getOrNull()?.let { comments = it }
        runCatching { Remote.reactions(trip) }.getOrNull()?.let { reactions = it }
    }
    var sheet by remember { mutableStateOf(false) }

    // HDR only while a photo with a gain map is up, and only on Android 14 and later.
    DisposableEffect(hdr) {
        val window = activity?.window
        if (window != null && Build.VERSION.SDK_INT >= 34) {
            window.colorMode = if (hdr) ActivityInfo.COLOR_MODE_HDR else ActivityInfo.COLOR_MODE_DEFAULT
            if (Build.VERSION.SDK_INT >= 35 && hdr) window.desiredHdrHeadroom = 0f
        }
        onDispose {
            if (window != null && Build.VERSION.SDK_INT >= 34) window.colorMode = ActivityInfo.COLOR_MODE_DEFAULT
        }
    }

    // Back follows the finger: the photo shrinks and the page behind shows through.
    PredictiveBackHandler { events ->
        try {
            events.collect { back.snapTo(it.progress) }
            appear.animateTo(0f, androidx.compose.animation.core.tween(180))
            onClose()
        } catch (e: kotlin.coroutines.cancellation.CancellationException) {
            scope.launch { back.animateTo(0f) }
            throw e
        }
    }

    Box(
        Modifier.fillMaxSize()
            .graphicsLayer { alpha = appear.value }
            .background(Color.Black.copy(alpha = 1f - back.value * 0.6f)),
    ) {
        HorizontalPager(pager, Modifier.fillMaxSize().graphicsLayer {
            val k = 1f - back.value * 0.12f
            scaleX = k * (0.94f + 0.06f * appear.value); scaleY = scaleX
        }) { page ->
            ViewerPhoto(photos[page], onHdr = { if (page == pager.currentPage) hdr = it }, onTap = { chrome = !chrome })
        }
        // Which day and where, and how far through the trip's photos.
        val shown by animateFloatAsState(if (chrome) 1f else 0f, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "chrome")
        Column(Modifier.fillMaxWidth().graphicsLayer { alpha = shown }.background(androidx.compose.ui.graphics.Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.55f), Color.Transparent)))) {
            Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(48.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.16f))
                        .pointerInput(Unit) { detectTapGestures { onClose() } },
                    contentAlignment = Alignment.Center,
                ) { LineIcon(listOf(P("M18 6 6 18"), P("m6 6 12 12")), Color.White, size = 22.dp, stroke = 2.2f) }
                val m = photos[pager.currentPage]
                Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                    val nl = Locale.forLanguageTag("nl-NL")
                    Text(
                        "${m.takenAt.dayOfWeek.getDisplayName(DateStyle.FULL, nl).replaceFirstChar { it.uppercase() }} ${m.takenAt.dayOfMonth} ${m.takenAt.month.getDisplayName(DateStyle.FULL, nl)}",
                        style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 17.sp, color = Color.White),
                    )
                    Text("${pager.currentPage + 1} van ${photos.size}", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = Color.White.copy(alpha = 0.75f)))
                }
                if (hdr) {
                    Text(
                        "HDR",
                        style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 12.sp, color = Color.White),
                        modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(Color.White.copy(alpha = 0.18f)).padding(horizontal = 8.dp, vertical = 4.dp),
                    )
                }
            }
        }
        // Below: how people reacted and what they said, over a soft dark fade.
        val current = photos[pager.currentPage]
        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().graphicsLayer { alpha = shown }
                .background(androidx.compose.ui.graphics.Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.6f))))
                .padding(horizontal = 16.dp).padding(top = 28.dp),
        ) {
            SocialBar(
                mine = reactions.mine[current.id],
                counts = reactions.counts[current.id].orEmpty(),
                comments = comments.count { it.mediaId == current.id },
                enabled = trip.remoteId != null,
                onReact = { kind ->
                    val before = reactions
                    reactions = withMine(reactions, current.id, kind)
                    scope.launch { runCatching { Remote.setReaction(trip, current.id, kind) }.onFailure { reactions = before } }
                },
                onComments = { sheet = true },
            )
            Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
            Spacer(Modifier.height(12.dp))
        }
        if (sheet) {
            CommentsSheet(
                comments = comments.filter { it.mediaId == current.id }.sortedBy { it.at },
                onDismiss = { sheet = false },
                onSend = { text ->
                    scope.launch {
                        runCatching { Remote.addComment(trip, current.id, text) }.getOrNull()?.let { comments = comments + it }
                    }
                },
                onDelete = { c ->
                    val before = comments
                    comments = comments - c
                    scope.launch { runCatching { Remote.deleteComment(trip, c.id) }.onFailure { comments = before } }
                },
            )
        }
    }
}

@Composable
private fun ViewerPhoto(media: Media, onHdr: (Boolean) -> Unit, onTap: () -> Unit) {
    // The preview first, so there is something at once; then the original replaces it.
    val preview by produceState<Bitmap?>(Photos.cached("${media.id}/preview"), media.id) {
        if (value == null) value = Photos.load(media.id, "preview")
    }
    val original by produceState<Bitmap?>(Photos.cached("${media.id}/original"), media.id) {
        if (value == null && !media.video) value = Photos.load(media.id, "original")
    }
    LaunchedEffect(original) {
        onHdr(Build.VERSION.SDK_INT >= 34 && original?.hasGainmap() == true)
    }
    var zoom by remember { mutableFloatStateOf(1f) }
    var pan by remember { mutableStateOf(Offset.Zero) }
    val transform = rememberTransformableState { z, p, _ ->
        zoom = (zoom * z).coerceIn(1f, 5f)
        pan = if (zoom == 1f) Offset.Zero else pan + p
    }
    Box(
        Modifier.fillMaxSize()
            .pointerInput(Unit) { detectTapGestures(onTap = { onTap() }, onDoubleTap = { zoom = if (zoom > 1f) 1f else 2.5f; pan = Offset.Zero }) }
            .transformable(transform, canPan = { zoom > 1f }),
        contentAlignment = Alignment.Center,
    ) {
        val shown = original ?: preview
        if (shown == null) {
            LoadingIndicator(Modifier.size(56.dp), color = Color.White)
        } else {
            Image(
                shown.asImageBitmap(), contentDescription = null, contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize().graphicsLayer { scaleX = zoom; scaleY = zoom; translationX = pan.x; translationY = pan.y },
            )
        }
    }
}


private val Kinds = listOf("heart" to "❤️", "laugh" to "😂", "wow" to "😮", "love" to "😍", "clap" to "👏")
private fun emojiOf(kind: String) = Kinds.firstOrNull { it.first == kind }?.second ?: "❤️"

/** Your own pick changed on one photo: the counts follow, so the bar is right before the server answers. */
private fun withMine(r: Remote.Reactions, target: String, kind: String?): Remote.Reactions {
    val old = r.mine[target]
    val counts = r.counts[target].orEmpty().associate { it }.toMutableMap()
    if (old != null) counts[old] = (counts[old] ?: 1) - 1
    if (kind != null) counts[kind] = (counts[kind] ?: 0) + 1
    val list = counts.filterValues { it > 0 }.toList().sortedByDescending { it.second }
    val mine = r.mine.toMutableMap().apply { if (kind == null) remove(target) else put(target, kind) }
    return r.copy(counts = r.counts + (target to list), mine = mine)
}

/**
 * The heart with what people gave, and the comments. A tap gives a heart (or
 * takes yours back), holding it opens the five reactions as one connected row.
 */
@Composable
private fun SocialBar(mine: String?, counts: List<Pair<String, Int>>, comments: Int, enabled: Boolean, onReact: (String?) -> Unit, onComments: () -> Unit) {
    var picking by remember { mutableStateOf(false) }
    val motion = MaterialTheme.motionScheme
    Column {
        androidx.compose.animation.AnimatedVisibility(
            picking,
            enter = androidx.compose.animation.scaleIn(motion.fastSpatialSpec(), initialScale = 0.6f, transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0f, 1f)) + androidx.compose.animation.fadeIn(motion.fastEffectsSpec()),
            exit = androidx.compose.animation.scaleOut(motion.fastSpatialSpec(), targetScale = 0.6f, transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0f, 1f)) + androidx.compose.animation.fadeOut(motion.fastEffectsSpec()),
        ) {
            Row(
                Modifier.padding(bottom = 10.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.16f)).padding(6.dp),
                horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(4.dp),
            ) {
                Kinds.forEach { (kind, emoji) ->
                    val on = mine == kind
                    Box(
                        Modifier.size(46.dp).clip(CircleShape).background(if (on) Color.White.copy(alpha = 0.3f) else Color.Transparent)
                            .pointerInput(kind) { detectTapGestures { onReact(if (on) null else kind); picking = false } },
                        contentAlignment = Alignment.Center,
                    ) { Text(emoji, fontSize = 24.sp) }
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            val total = counts.sumOf { it.second }
            Row(
                Modifier.height(48.dp).clip(CircleShape).background(if (mine != null) Color.White.copy(alpha = 0.26f) else Color.White.copy(alpha = 0.14f))
                    .pointerInput(mine, enabled) {
                        if (enabled) detectTapGestures(
                            onTap = { onReact(if (mine != null) null else "heart") },
                            onLongPress = { picking = !picking },
                        )
                    }
                    .padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (mine != null) Text(emojiOf(mine), fontSize = 20.sp)
                else LineIcon(Glyphs.heart, Color.White, size = 22.dp, stroke = 2f)
                // The others' picks as a small stack, then how many.
                counts.filter { it.first != mine }.take(3).forEach { (kind, _) -> Text(emojiOf(kind), fontSize = 16.sp, modifier = Modifier.padding(start = 4.dp)) }
                if (total > 0) Text("$total", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 16.sp, color = Color.White), modifier = Modifier.padding(start = 8.dp))
            }
            Spacer(Modifier.size(8.dp))
            Row(
                Modifier.height(48.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.14f))
                    .pointerInput(enabled) { if (enabled) detectTapGestures { onComments() } }
                    .padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                LineIcon(Glyphs.comment, Color.White, size = 21.dp, stroke = 2f)
                Text(
                    if (comments == 0) "Reageer" else "$comments",
                    style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 16.sp, color = Color.White),
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
        }
    }
}

private fun ago(at: java.time.Instant): String {
    val s = java.time.Duration.between(at, java.time.Instant.now()).seconds
    return when {
        s < 60 -> "zojuist"
        s < 3600 -> "${s / 60} min"
        s < 86400 -> "${s / 3600} u"
        s < 7 * 86400 -> "${s / 86400} d"
        else -> java.time.format.DateTimeFormatter.ofPattern("d MMM", Locale.forLanguageTag("nl-NL")).withZone(java.time.ZoneId.systemDefault()).format(at)
    }
}

/** The comments on one photo in a sheet, a field to add one at the bottom that stays above the keyboard. */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun CommentsSheet(comments: List<Remote.Comment>, onDismiss: () -> Unit, onSend: (String) -> Unit, onDelete: (Remote.Comment) -> Unit) {
    val cs = MaterialTheme.colorScheme
    var text by remember { mutableStateOf("") }
    androidx.compose.material3.ModalBottomSheet(onDismissRequest = onDismiss, containerColor = cs.surfaceContainerLow) {
        Column(Modifier.fillMaxWidth().imePadding().padding(horizontal = 16.dp)) {
            Text("Reacties", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 22.sp, color = cs.onSurface), modifier = Modifier.padding(bottom = 12.dp))
            if (comments.isEmpty()) {
                Text("Nog niemand heeft gereageerd. Wees de eerste.", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 14.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(bottom = 16.dp))
            }
            Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()), verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(3.dp)) {
                comments.forEachIndexed { i, c ->
                    val shape = RoundedCornerShape(
                        topStart = if (i == 0) 22.dp else 6.dp, topEnd = if (i == 0) 22.dp else 6.dp,
                        bottomStart = if (i == comments.lastIndex) 22.dp else 6.dp, bottomEnd = if (i == comments.lastIndex) 22.dp else 6.dp,
                    )
                    Row(Modifier.fillMaxWidth().clip(shape).background(cs.surfaceContainerHigh).padding(12.dp)) {
                        Box(Modifier.size(36.dp).clip(CircleShape).background(cs.primaryContainer), contentAlignment = Alignment.Center) {
                            Text(c.author.take(1).uppercase(), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 15.sp, color = cs.onPrimaryContainer))
                        }
                        Column(Modifier.weight(1f).padding(start = 12.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(c.author, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = cs.onSurface))
                                Text("  ${ago(c.at)}", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 12.5.sp, color = cs.onSurfaceVariant))
                            }
                            Text(c.body, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(450), fontSize = 15.sp, lineHeight = 21.sp, color = cs.onSurface), modifier = Modifier.padding(top = 2.dp))
                        }
                        if (c.canDelete) {
                            Box(Modifier.size(36.dp).clip(CircleShape).pointerInput(c.id) { detectTapGestures { onDelete(c) } }, contentAlignment = Alignment.Center) {
                                LineIcon(Glyphs.trash, cs.onSurfaceVariant, size = 18.dp)
                            }
                        }
                    }
                }
            }
            Row(Modifier.padding(top = 14.dp, bottom = 16.dp).fillMaxWidth().height(52.dp).clip(CircleShape).background(cs.surfaceContainerHighest).padding(start = 18.dp, end = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) {
                    if (text.isEmpty()) Text("Schrijf een reactie", style = TextStyle(fontFamily = Inter, fontSize = 15.sp, color = cs.onSurfaceVariant))
                    androidx.compose.foundation.text.BasicTextField(
                        text, { text = it.take(1000) },
                        textStyle = TextStyle(fontFamily = Inter, fontSize = 15.sp, color = cs.onSurface),
                        cursorBrush = androidx.compose.ui.graphics.SolidColor(cs.primary),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                val ready = text.isNotBlank()
                Box(
                    Modifier.size(42.dp).clip(CircleShape).background(if (ready) cs.primary else Color.Transparent)
                        .pointerInput(ready, text) { if (ready) detectTapGestures { onSend(text.trim()); text = "" } },
                    contentAlignment = Alignment.Center,
                ) { LineIcon(Glyphs.send, if (ready) cs.onPrimary else cs.onSurfaceVariant, size = 20.dp, stroke = 2f) }
            }
        }
    }
}
