package nl.markmaaktmedia.markmysteps.next

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.SeekableTransitionState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.rememberTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ButtonGroupDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.LoadingIndicator
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/*
 * The building blocks every settings page shares: the slabs of rows (outer corners round, inner ones
 * tight) with an icon in a shape of its own, the fields and buttons of a form, a line that says how a
 * save went, and the slide that opens a page over another one with predictive back.
 */

/** A press that sinks a little, as on the rest of the app. */
fun Modifier.dip(onClick: () -> Unit = {}): Modifier = composed {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.97f else 1f, MaterialTheme.motionScheme.fastSpatialSpec(), label = "press")
    clickable(source, ripple(), onClick = onClick).graphicsLayer { scaleX = scale; scaleY = scale }
}

fun slabShape(i: Int, n: Int): Shape {
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

val TitleStyle get() = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 17.sp)
val ValueStyle get() = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp)

class Item(
    val icon: List<Shape24>,
    val title: String,
    val value: String? = null,
    val toggle: Boolean? = null,
    val action: (() -> Unit)? = null,
    /** Opens another site: an "open outside" mark instead of a chevron. */
    val external: Boolean = false,
    /** An action that is not a page, like signing out: no mark at the end. */
    val plain: Boolean = false,
    val danger: Boolean = false,
    val enabled: Boolean = true,
    /** Cannot work right now: grey, but a tap still runs [action], which says why. */
    val dimmed: Boolean = false,
)

@Composable
fun Header(text: String, top: Boolean = false) {
    Text(
        text,
        style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant),
        modifier = Modifier.padding(top = if (top) 12.dp else 24.dp, bottom = 10.dp, start = 4.dp),
    )
}

@Composable
fun Group(title: String?, items: List<Item>) {
    if (title != null) Header(title)
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        items.forEachIndexed { i, item -> SettingRow(item, i, items.size, (title?.length ?: 0) + i) }
    }
}

@Composable
fun IconTile(icon: List<Shape24>, seed: Int, big: Boolean = false, danger: Boolean = false) {
    val cs = MaterialTheme.colorScheme
    Box(
        Modifier.size(if (big) 50.dp else 42.dp).clip(IconShapes[seed % IconShapes.size].toShape()).background(if (danger) cs.errorContainer else cs.secondaryContainer),
        contentAlignment = Alignment.Center,
    ) { LineIcon(icon, if (danger) cs.onErrorContainer else cs.onSecondaryContainer, size = 20.dp, stroke = 2f) }
}

@Composable
fun SettingRow(item: Item, i: Int, n: Int, seed: Int) {
    val cs = MaterialTheme.colorScheme
    val alpha by animateFloatAsState(if (item.enabled && !item.dimmed) 1f else 0.45f, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "enabled")
    Row(
        Modifier.fillMaxWidth().clip(slabShape(i, n)).background(cs.surfaceContainerLow)
            .then(if (item.enabled && (item.action != null || item.toggle != null)) Modifier.dip { item.action?.invoke() } else Modifier)
            .graphicsLayer { this.alpha = alpha }
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconTile(item.icon, seed, danger = item.danger)
        Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
            Text(item.title, style = TitleStyle.copy(color = if (item.danger) cs.error else cs.onSurface))
            if (item.value != null) Text(item.value, style = ValueStyle.copy(color = cs.onSurfaceVariant))
        }
        if (item.toggle != null) {
            AppSwitch(item.toggle, enabled = item.enabled) { item.action?.invoke() }
        } else if (item.action != null && !item.plain) {
            LineIcon(if (item.external) Glyphs.external else Glyphs.chevronRight, cs.onSurfaceVariant, size = 18.dp, stroke = 2.2f)
        }
    }
}

@Composable
fun AppSwitch(checked: Boolean, enabled: Boolean = true, onChange: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Switch(
        checked = checked,
        onCheckedChange = { onChange() },
        enabled = enabled,
        thumbContent = if (checked) {
            { LineIcon(listOf(P("m5 12 5 5 9-10")), cs.primary, size = 14.dp, stroke = 2.6f) }
        } else null,
        colors = SwitchDefaults.colors(checkedTrackColor = cs.primary, checkedThumbColor = cs.onPrimary),
    )
}

/** A block of its own for a form or a choice: the slab's tone, round corners, room inside. */
@Composable
fun Panel(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(26.dp)).background(MaterialTheme.colorScheme.surfaceContainerLow).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        content = content,
    )
}

/** Explanation under a choice, quiet and short. */
@Composable
fun Hint(text: String, modifier: Modifier = Modifier) {
    Text(text, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, lineHeight = 18.sp, color = MaterialTheme.colorScheme.onSurfaceVariant), modifier = modifier)
}

/** A path through menus as on the web: the steps bold, joined by ›. */
fun pathText(prefix: String, steps: List<String>, suffix: String = "", color: Color): AnnotatedString = buildAnnotatedString {
    append(prefix)
    steps.forEachIndexed { i, s ->
        if (i > 0) append(" › ")
        pushStyle(SpanStyle(fontWeight = FontWeight(650), color = color)); append(s); pop()
    }
    append(suffix)
}

@Composable
fun PathHint(prefix: String, steps: List<String>, suffix: String = "") {
    val cs = MaterialTheme.colorScheme
    Text(pathText(prefix, steps, suffix, cs.onSurface), style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, lineHeight = 18.sp, color = cs.onSurfaceVariant))
}

/** The answer to a save: green-ish when it went well, red when not; it grows in and out. */
@Composable
fun Note(text: String?, error: Boolean = false) {
    val cs = MaterialTheme.colorScheme
    var last by remember { mutableStateOf(text ?: "") }
    if (text != null) last = text
    AnimatedVisibility(
        text != null,
        enter = fadeIn(MaterialTheme.motionScheme.defaultEffectsSpec()) + expandVertically(MaterialTheme.motionScheme.defaultSpatialSpec()),
        exit = fadeOut(MaterialTheme.motionScheme.fastEffectsSpec()) + shrinkVertically(MaterialTheme.motionScheme.fastSpatialSpec()),
    ) {
        Text(last, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(550), fontSize = 13.5.sp, lineHeight = 19.sp, color = if (error) cs.error else cs.primary), modifier = Modifier.padding(horizontal = 4.dp))
    }
}

/** One field of a form, the look of the sign-in page. Secret fields are masked with an eye to show them. */
@Composable
fun FormField(
    label: String, value: String, onChange: (String) -> Unit,
    hint: String = "", type: KeyboardType = KeyboardType.Text, secret: Boolean = false,
    autofill: androidx.compose.ui.autofill.ContentType? = null, prefix: String? = null,
    done: (() -> Unit)? = null, enabled: Boolean = true, capitalize: Boolean = false,
    support: String? = null, supportError: Boolean = false,
) {
    val cs = MaterialTheme.colorScheme
    var show by remember { mutableStateOf(false) }
    Column {
        Text(label, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(start = 6.dp, bottom = 6.dp))
        Row(
            Modifier.fillMaxWidth().height(54.dp).clip(RoundedCornerShape(18.dp)).background(cs.surfaceContainerHighest).padding(start = 16.dp, end = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (prefix != null) Text(prefix, style = TextStyle(fontFamily = Inter, fontSize = 16.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(end = 2.dp))
            Box(Modifier.weight(1f)) {
                if (value.isEmpty() && hint.isNotEmpty()) Text(hint, maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Inter, fontSize = 16.sp, color = cs.onSurfaceVariant.copy(alpha = 0.7f)))
                BasicTextField(
                    value, onChange, singleLine = true, enabled = enabled,
                    textStyle = TextStyle(fontFamily = Inter, fontSize = 16.sp, color = cs.onSurface),
                    cursorBrush = SolidColor(cs.primary),
                    visualTransformation = if (secret && !show) PasswordVisualTransformation() else VisualTransformation.None,
                    keyboardOptions = KeyboardOptions(
                        keyboardType = if (secret && type == KeyboardType.Text) KeyboardType.Password else type,
                        imeAction = if (done != null) ImeAction.Done else ImeAction.Next,
                        autoCorrectEnabled = !secret && capitalize,
                        capitalization = if (capitalize) KeyboardCapitalization.Sentences else KeyboardCapitalization.None,
                    ),
                    keyboardActions = KeyboardActions(onDone = { done?.invoke() }),
                    modifier = Modifier.fillMaxWidth().then(if (autofill != null) Modifier.semantics { contentType = autofill } else Modifier),
                )
            }
            if (secret) {
                Box(Modifier.size(42.dp).clip(CircleShape).clickable { show = !show }, contentAlignment = Alignment.Center) {
                    LineIcon(
                        if (show) listOf(P("M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"), C(12f, 12f, 3f))
                        else listOf(P("M3 3l18 18"), P("M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6"), P("M9.9 9.9a3 3 0 0 0 4.2 4.2")),
                        cs.onSurfaceVariant, size = 20.dp,
                    )
                }
            } else Spacer(Modifier.size(10.dp))
        }
        if (support != null) {
            androidx.compose.animation.Crossfade(support to supportError, animationSpec = MaterialTheme.motionScheme.defaultEffectsSpec(), label = "support") { (s, err) ->
                Text(s, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 12.5.sp, color = if (err) cs.error else cs.onSurfaceVariant), modifier = Modifier.padding(start = 6.dp, top = 6.dp))
            }
        }
    }
}

/** The main button of a form; while busy a spinner takes the icon's place, so the button keeps its size. */
@Composable
fun MainButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, icon: List<Shape24>? = null, busy: Boolean = false, enabled: Boolean = true, danger: Boolean = false) {
    val cs = MaterialTheme.colorScheme
    Button(
        onClick = onClick, enabled = enabled && !busy, shapes = ButtonDefaults.shapes(), modifier = modifier.height(50.dp),
        colors = if (danger) ButtonDefaults.buttonColors(containerColor = cs.error, contentColor = cs.onError) else ButtonDefaults.buttonColors(),
    ) { ButtonInside(label, icon, busy) }
}

@Composable
fun SoftButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, icon: List<Shape24>? = null, busy: Boolean = false, enabled: Boolean = true, danger: Boolean = false) {
    val cs = MaterialTheme.colorScheme
    FilledTonalButton(
        onClick = onClick, enabled = enabled && !busy, shapes = ButtonDefaults.shapes(), modifier = modifier.height(50.dp),
        colors = if (danger) ButtonDefaults.filledTonalButtonColors(containerColor = cs.errorContainer, contentColor = cs.onErrorContainer) else ButtonDefaults.filledTonalButtonColors(),
    ) { ButtonInside(label, icon, busy) }
}

@Composable
private fun ButtonInside(label: String, icon: List<Shape24>?, busy: Boolean) {
    // The button's own content colour, so a disabled button greys its icon too.
    val tint = androidx.compose.material3.LocalContentColor.current
    if (icon != null || busy) {
        Box(Modifier.size(20.dp), contentAlignment = Alignment.Center) {
            if (busy) LoadingIndicator(Modifier.size(20.dp), color = tint)
            else if (icon != null) LineIcon(icon, tint, size = 20.dp, stroke = 2f)
        }
        Spacer(Modifier.size(8.dp))
    }
    Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp))
}

/**
 * A danger that is not the biggest one on the page (wiping data, disconnecting, turning off): error-coloured
 * text in an error outline, quieter than the filled red of deleting the whole thing.
 */
@Composable
fun QuietDangerButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, icon: List<Shape24>? = null, busy: Boolean = false, enabled: Boolean = true) {
    val cs = MaterialTheme.colorScheme
    androidx.compose.material3.OutlinedButton(
        onClick = onClick, enabled = enabled && !busy, shapes = ButtonDefaults.shapes(), modifier = modifier.height(50.dp),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = cs.error),
        border = androidx.compose.foundation.BorderStroke(1.5.dp, if (enabled && !busy) cs.error.copy(alpha = 0.7f) else cs.onSurface.copy(alpha = 0.12f)),
    ) { ButtonInside(label, icon, busy) }
}

/** Two buttons side by side, each half the width. */
@Composable
fun ButtonRow(content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), content = content)
}

/** A connected row of choices, like the theme. */
@Composable
fun <T> Choices(options: List<Pair<T, String>>, selected: T?, onSelect: (T) -> Unit, enabled: Boolean = true) {
    val cs = MaterialTheme.colorScheme
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(ButtonGroupDefaults.ConnectedSpaceBetween)) {
        options.forEachIndexed { i, (value, label) ->
            ToggleButton(
                checked = selected == value,
                onCheckedChange = { onSelect(value) },
                enabled = enabled,
                // A long word gets more of the row, so no label is ever cut off.
                modifier = Modifier.weight(maxOf(1f, label.length / 9f)).height(52.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 10.dp),
                shapes = when (i) {
                    0 -> ButtonGroupDefaults.connectedLeadingButtonShapes()
                    options.lastIndex -> ButtonGroupDefaults.connectedTrailingButtonShapes()
                    else -> ButtonGroupDefaults.connectedMiddleButtonShapes()
                },
                colors = ToggleButtonDefaults.toggleButtonColors(
                    containerColor = cs.surfaceContainerHigh, contentColor = cs.onSurfaceVariant,
                    checkedContainerColor = cs.primary, checkedContentColor = cs.onPrimary,
                ),
            ) { Text(label, maxLines = 1, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp)) }
        }
    }
}

/** A grey block the size of what is still loading, breathing softly as the photos do. */
@Composable
fun Placeholder(modifier: Modifier) {
    val tone = MaterialTheme.colorScheme.surfaceContainerHigh
    val a by androidx.compose.animation.core.rememberInfiniteTransition(label = "breathe").animateFloat(
        0.55f, 1f, androidx.compose.animation.core.infiniteRepeatable(tween(1100), androidx.compose.animation.core.RepeatMode.Reverse), label = "a",
    )
    Box(modifier.drawBehind { drawRect(tone, alpha = a) })
}

/** Asks before something that cannot be undone, or that signs you out. */
@Composable
fun Confirm(title: String, text: String, confirm: String, danger: Boolean = true, onConfirm: () -> Unit, onDismiss: () -> Unit, extra: (@Composable () -> Unit)? = null, confirmEnabled: Boolean = true) {
    val cs = MaterialTheme.colorScheme
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 20.sp)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text(text, style = TextStyle(fontFamily = Inter, fontSize = 15.sp, lineHeight = 21.sp))
                extra?.invoke()
            }
        },
        // Two pills side by side on the right: cancel tonal, the action filled (red when it removes something).
        confirmButton = { DialogButtons(confirm, danger, confirmEnabled, onConfirm = { onConfirm(); onDismiss() }, onDismiss = onDismiss) },
    )
}

/** The buttons of every dialog here: "Annuleren" as a tonal pill, the action as a filled one, both morphing on press. */
@Composable
fun DialogButtons(confirm: String, danger: Boolean, enabled: Boolean = true, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val label = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        FilledTonalButton(onClick = onDismiss, shapes = ButtonDefaults.shapes(), modifier = Modifier.height(44.dp)) { Text("Annuleren", style = label) }
        Button(
            onClick = onConfirm, enabled = enabled, shapes = ButtonDefaults.shapes(), modifier = Modifier.height(44.dp),
            colors = if (danger) ButtonDefaults.buttonColors(containerColor = cs.error, contentColor = cs.onError) else ButtonDefaults.buttonColors(),
        ) { Text(confirm, style = label) }
    }
}

/** A settings page: the round back button, the big title, and its content scrolling under the clock. */
@Composable
fun SettingsScaffold(title: String, onBack: () -> Unit, trailing: (@Composable () -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    val cs = MaterialTheme.colorScheme
    val scroll = rememberScrollState()
    Box(Modifier.fillMaxSize().background(cs.background)) {
        Column(Modifier.fillMaxSize().verticalScroll(scroll).padding(horizontal = 16.dp)) {
            Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(48.dp).clip(CircleShape).background(cs.surfaceContainerHigh).dip(onBack),
                    contentAlignment = Alignment.Center,
                ) { LineIcon(listOf(P("M19 12H5"), P("m12 19-7-7 7-7")), cs.onSurface, size = 22.dp, stroke = 2.2f) }
                Spacer(Modifier.weight(1f))
                trailing?.invoke()
            }
            Text(
                title,
                style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 32.sp, letterSpacing = (-0.02).em, color = cs.onBackground),
                modifier = Modifier.padding(top = 18.dp, bottom = 4.dp),
            )
            content()
            Spacer(Modifier.height(120.dp))
            Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
            // Room for the keyboard, so the last field can always scroll above it.
            Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.ime))
        }
        StatusScrim(scroll)
    }
}

/**
 * Opens [over] on top of [base] with the shared axis of the pages (in from a third away, the page under
 * it sliding the other way and shrinking) and predictive back: the gesture seeks the same transition, so
 * the page follows the finger and the one under it shows; letting go finishes it, pulling back undoes it.
 * The page under it stays composed the whole time (a trip's map and timeline are not built again).
 */
@Composable
fun <T : Any> SlideHost(open: T?, onClose: () -> Unit, base: @Composable () -> Unit, over: @Composable (T) -> Unit) {
    val state = remember { SeekableTransitionState(open) }
    var last by remember { mutableStateOf(open) }
    if (open != null) last = open
    LaunchedEffect(open) { if (state.targetState != open) state.animateTo(open) }
    androidx.activity.compose.PredictiveBackHandler(enabled = open != null) { events ->
        try {
            events.collect { state.seekTo(it.progress, null) }
            state.animateTo(null)
            onClose()
        } catch (e: kotlin.coroutines.cancellation.CancellationException) {
            kotlinx.coroutines.withContext(kotlinx.coroutines.NonCancellable) { state.snapTo(open) }
            throw e
        }
    }
    val transition = rememberTransition(state, label = "slide")
    val emphasized = remember { CubicBezierEasing(0.2f, 0f, 0f, 1f) }
    val eased by transition.animateFloat({ tween(350, easing = emphasized) }, label = "eased") { if (it != null) 1f else 0f }
    val linear by transition.animateFloat({ tween(350, easing = LinearEasing) }, label = "linear") { if (it != null) 1f else 0f }
    val opening = transition.targetState != null
    Box(Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxSize().graphicsLayer {
            translationX = -size.width / 3f * eased
            val k = 1f - 0.08f * eased; scaleX = k; scaleY = k
        }) { base() }
        val shown = transition.currentState != null || transition.targetState != null
        val item = last
        if (shown && item != null) {
            Box(
                Modifier.fillMaxSize()
                    .graphicsLayer {
                        if (opening) {
                            translationX = size.width / 3f * (1f - eased); alpha = eased
                        } else {
                            // Going back the page leaves all the way, speeding up, and shrinks a little.
                            val t = 1f - linear
                            translationX = size.width * t * t * t
                            val k = 1f - 0.15f * emphasized.transform(t); scaleX = k; scaleY = k
                        }
                    }
                    .background(MaterialTheme.colorScheme.background)
                    // Taps on the page under it never reach it.
                    .pointerInput(Unit) { awaitPointerEventScope { while (true) awaitPointerEvent() } },
            ) { over(item) }
        }
    }
}
