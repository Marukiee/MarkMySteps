package nl.markmaaktmedia.markupdate.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.VisibilityThreshold
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import kotlin.math.roundToInt
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale
import nl.markmaaktmedia.markupdate.MarkUpdate
import nl.markmaaktmedia.markupdate.MarkUpdater
import nl.markmaaktmedia.markupdate.ReleaseInfo
import nl.markmaaktmedia.markupdate.UpdateState
import nl.markmaaktmedia.markupdate.highlights

/** Waar de kaart is: wachten op een tik, downloaden of (de download is klaar) installeren. */
private enum class Phase { Rest, Busy, Installing }

/** Wat de kaart toont, bewaard terwijl hij wegschuift: dan is de toestand al verder en zou hij de kaart onderweg veranderen. */
private class Shown(var release: ReleaseInfo? = null, var failure: UpdateState.Failed? = null, var phase: Phase = Phase.Rest)

private val IconSize = 46.dp
private val ButtonHeight = 46.dp

/** Later neemt een derde van de breedte, Bijwerken de rest. */
private const val LaterFraction = 1f / 3f

/**
 * De kaart bovenaan de app als er een nieuwe versie is: een icoon, "Nieuwe versie X", in twee korte regels wat er nieuw is, en Later en
 * Bijwerken naast elkaar over de hele breedte. Bijwerken wordt een voortgangsbalk over de hele kaart terwijl Later wegschuift; is de
 * download klaar, dan installeert de app meteen (geen tweede tik) en zegt de balk dat. Android vraagt de eerste keer zelf om een
 * bevestiging, of als hij niet stil wil installeren; die vraag opent vanzelf.
 *
 * Kleuren, lettertypen en hoeken komen uit [androidx.compose.material3.MaterialTheme]; [style] is voor wat per app anders is.
 */
@Composable
fun UpdateCard(
    modifier: Modifier = Modifier,
    style: UpdateCardStyle = UpdateCardStyle(),
    updater: MarkUpdater = MarkUpdate.get(),
) {
    val state by updater.state.collectAsState()
    val dismissed by updater.dismissed.collectAsState()

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        // Terug van het scherm "onbekende apps installeren" met de schakelaar aan: ga door waar het stopte (in de scope van de updater, niet van dit scherm).
        updater.resume()
        // Een update die klaar was terwijl de app niet in beeld was, stelt zijn vraag nu.
        updater.resumeConfirmation()
    }

    val release: ReleaseInfo? = when (val s = state) {
        is UpdateState.Available -> s.release
        is UpdateState.Downloading -> s.release
        is UpdateState.ReadyToInstall -> s.release
        is UpdateState.NeedsPermission -> s.release
        is UpdateState.Installing -> s.release
        is UpdateState.AwaitingConfirmation -> s.release
        else -> null
    }
    val failed = state as? UpdateState.Failed
    // Een mislukking blijft staan tot hij opnieuw geprobeerd is of de app opnieuw opent; een release waar "Later" voor gekozen is blijft weg.
    val visible = failed != null || (release != null && release.tag != dismissed)
    val shown = remember { Shown() }
    if (visible) {
        shown.release = release
        shown.failure = failed
        shown.phase = when (state) {
            is UpdateState.Downloading -> Phase.Busy
            is UpdateState.ReadyToInstall, is UpdateState.Installing, is UpdateState.AwaitingConfirmation -> Phase.Installing
            else -> Phase.Rest
        }
    }

    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(style.motion.fade()) + expandVertically(style.motion.sizeSpring()),
        exit = fadeOut(style.motion.fade()) + shrinkVertically(style.motion.sizeSpring()),
        modifier = modifier,
    ) {
        val failure = shown.failure
        val shownRelease = shown.release
        when {
            failure != null -> FailedCard(failure.reason, style) { updater.startRetry() }
            shownRelease != null -> UpdateContent(
                release = shownRelease,
                phase = shown.phase,
                state = state,
                currentVersion = updater.currentVersion,
                style = style,
                onBar = {
                    when (val s = state) {
                        is UpdateState.Available -> updater.startUpdate(s.release)
                        is UpdateState.NeedsPermission -> updater.openInstallPermissionSettings()
                        // Android liet de vraag niet vanzelf openen (de app stond niet voorin): de balk opent hem.
                        is UpdateState.AwaitingConfirmation -> updater.launchConfirmation()
                        else -> Unit
                    }
                },
                onLater = { updater.dismiss(shownRelease.tag) },
            )
        }
    }
}

/**
 * De balk van de kaart, los, voor de instellingen van een app (onder "Controleren op updates"): staat er alleen als er een nieuwere versie
 * is, en zegt dan "Bijwerken naar versie X". Een tik doet precies wat Bijwerken op de kaart doet: hij wordt een voortgangsbalk met het
 * percentage, en is de download klaar, dan installeert hij meteen met "Installeren…" en de glans. Zelfde kleuren, veren en tijden als
 * de kaart, zonder Later (in de instellingen kies je er zelf voor). Mislukt het, dan zegt hij "Opnieuw proberen".
 *
 * Kaart en balk lezen dezelfde updater: tik je op de een, dan loopt de ander mee.
 */
@Composable
fun UpdateBar(
    modifier: Modifier = Modifier,
    style: UpdateCardStyle = UpdateCardStyle(),
    updater: MarkUpdater = MarkUpdate.get(),
) {
    val state by updater.state.collectAsState()
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        updater.resume()
        updater.resumeConfirmation()
    }
    val release = releaseOf(state)
    val failed = state as? UpdateState.Failed
    val visible = release != null || failed != null
    // Wat de balk toont, bewaard terwijl hij wegschuift (net als de kaart).
    val shown = remember { Shown() }
    if (visible) {
        shown.release = release
        shown.failure = failed
        shown.phase = phaseOf(state)
    }
    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(style.motion.fade()) + expandVertically(style.motion.sizeSpring()),
        exit = fadeOut(style.motion.fade()) + shrinkVertically(style.motion.sizeSpring()),
        modifier = modifier,
    ) {
        val phase = shown.phase
        val progress = when (phase) {
            Phase.Rest -> 0f
            Phase.Busy -> (state as? UpdateState.Downloading)?.progress ?: 0f
            Phase.Installing -> 1f
        }
        val restLabel = when {
            shown.failure != null -> stringResource(R.string.markupdate_retry)
            state is UpdateState.NeedsPermission -> stringResource(R.string.markupdate_allow)
            else -> stringResource(R.string.markupdate_update_to, shown.release?.versionName ?: "")
        }
        Actions(
            phase = phase, progress = progress, style = style, restLabel = restLabel,
            barEnabled = phase == Phase.Rest || state is UpdateState.AwaitingConfirmation,
            onBar = {
                when (val s = state) {
                    is UpdateState.Available -> updater.startUpdate(s.release)
                    is UpdateState.NeedsPermission -> updater.openInstallPermissionSettings()
                    is UpdateState.AwaitingConfirmation -> updater.launchConfirmation()
                    is UpdateState.Failed -> updater.startRetry()
                    else -> Unit
                }
            },
            onLater = {},
            showLater = false,
        )
    }
}

/** De release waar de updater mee bezig is, of null als er niets nieuws is. */
private fun releaseOf(state: UpdateState): ReleaseInfo? = when (state) {
    is UpdateState.Available -> state.release
    is UpdateState.Downloading -> state.release
    is UpdateState.ReadyToInstall -> state.release
    is UpdateState.NeedsPermission -> state.release
    is UpdateState.Installing -> state.release
    is UpdateState.AwaitingConfirmation -> state.release
    else -> null
}

private fun phaseOf(state: UpdateState): Phase = when (state) {
    is UpdateState.Downloading -> Phase.Busy
    is UpdateState.ReadyToInstall, is UpdateState.Installing, is UpdateState.AwaitingConfirmation -> Phase.Installing
    else -> Phase.Rest
}

@Composable
private fun UpdateContent(
    release: ReleaseInfo, phase: Phase, state: UpdateState, currentVersion: String, style: UpdateCardStyle, onBar: () -> Unit, onLater: () -> Unit,
) {
    val colors = MaterialTheme.colorScheme
    val dutch = LocalConfiguration.current.locales[0].language == "nl"
    val lines = remember(release, dutch) { release.highlights(dutch) }
    // De echte voortgang; de balk volgt hem iets zachter (een veer), want hij komt binnen in stappen van een procent.
    val progress = when (phase) {
        Phase.Rest -> 0f
        Phase.Busy -> (state as? UpdateState.Downloading)?.progress ?: 0f
        Phase.Installing -> 1f
    }
    Column(Modifier.fillMaxWidth().clip(style.shape).background(colors.surfaceContainer).padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            UpdateIcon(done = phase == Phase.Installing, style = style)
            AnimatedContent(
                targetState = phase, transitionSpec = slideUp(2, style), modifier = Modifier.weight(1f), label = "updateText",
            ) { p ->
                Column(Modifier.fillMaxWidth()) {
                    Text(
                        stringResource(if (p == Phase.Installing) R.string.markupdate_installing_title else R.string.markupdate_title, release.versionName),
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold), maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        when (p) {
                            Phase.Rest -> if (state is UpdateState.NeedsPermission) stringResource(R.string.markupdate_needs_permission) else stringResource(R.string.markupdate_on_version, currentVersion)
                            Phase.Busy -> downloaded(release, progress)
                            Phase.Installing -> if (state is UpdateState.AwaitingConfirmation) stringResource(R.string.markupdate_confirm_hint) else style.installingSubtitle ?: stringResource(R.string.markupdate_installing_sub)
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
        // Twee korte regels van wat er nieuw is, onder de titel; ze schuiven weg als de installatie begint.
        AnimatedVisibility(
            visible = lines.isNotEmpty() && phase != Phase.Installing,
            enter = fadeIn(style.motion.fade()) + expandVertically(style.motion.sizeSpring()),
            exit = fadeOut(style.motion.fade()) + shrinkVertically(style.motion.sizeSpring()),
        ) {
            Column(Modifier.padding(start = IconSize + 12.dp, top = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                lines.forEach { Text("• $it", style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            }
        }
        Actions(
            phase = phase, progress = progress, style = style,
            restLabel = stringResource(if (state is UpdateState.NeedsPermission) R.string.markupdate_allow else R.string.markupdate_update),
            barEnabled = phase == Phase.Rest || state is UpdateState.AwaitingConfirmation,
            onBar = onBar, onLater = onLater,
        )
    }
}

/** "6,3 van 22,0 MB" (megabytes met één decimaal), of alleen het percentage als de release niet zegt hoe groot het bestand is. */
@Composable
private fun downloaded(release: ReleaseInfo, progress: Float): String {
    val total = release.apkSizeBytes
    if (total <= 0) return stringResource(R.string.markupdate_downloading, (progress * 100).toInt())
    val format = DecimalFormat("0.0", DecimalFormatSymbols(Locale.getDefault()))
    val done = format.format(total * progress / 1e6)
    val all = format.format(total / 1e6)
    return stringResource(R.string.markupdate_progress, done, all)
}

/** Het vierkante icoon: een sparkle op de primaire container, een groene cirkel met vinkje zodra het installeert. */
@Composable
private fun UpdateIcon(done: Boolean, style: UpdateCardStyle) {
    val colors = MaterialTheme.colorScheme
    val green = style.successColor.takeIf { it != Color.Unspecified }
        ?: if (colors.background.luminance() < 0.5f) Color(0xFF30D158) else Color(0xFF1A8F37)
    val radius by animateDpAsState(if (done) IconSize / 2 else 15.dp, style.motion.spatial(), label = "updateIconRadius")
    val fill by animateColorAsState(
        if (done) green.copy(alpha = 0.2f).compositeOver(colors.surfaceContainer) else colors.primaryContainer, style.motion.colour(), label = "updateIconFill",
    )
    val ink by animateColorAsState(if (done) green else colors.onPrimaryContainer, style.motion.colour(), label = "updateIconInk")
    Box(Modifier.size(IconSize).clip(RoundedCornerShape(radius)).background(fill), contentAlignment = Alignment.Center) {
        AnimatedContent(
            targetState = done,
            transitionSpec = {
                (scaleIn(spring(dampingRatio = 0.7f, stiffness = Spring.StiffnessMediumLow), initialScale = 0.3f) + fadeIn(tween(220))) togetherWith
                    (scaleOut(tween(160), targetScale = 0.3f) + fadeOut(tween(160)))
            },
            label = "updateIcon",
        ) { d ->
            Icon(painterResource(if (d) R.drawable.markupdate_ic_check else R.drawable.markupdate_ic_sparkle), contentDescription = null, tint = ink, modifier = Modifier.size(24.dp))
        }
    }
}

/**
 * Later (een derde van de breedte) en Bijwerken (de rest) staan naast elkaar. Begint het bijwerken, dan krimpt Later tot niets en vervaagt, en Bijwerken
 * groeit tot een balk over de hele breedte: de vulling volgt de download, het percentage staat in het midden. Is het klaar, dan blijft
 * de balk vol en zegt hij "Installeren…" met een zachte glans.
 */
@Composable
private fun Actions(
    phase: Phase, progress: Float, style: UpdateCardStyle, restLabel: String, barEnabled: Boolean, onBar: () -> Unit, onLater: () -> Unit,
    showLater: Boolean = true,
) {
    val colors = MaterialTheme.colorScheme
    val motion = style.motion
    // Later is een derde van de breedte en krimpt tot niets: de breedte zelf is de veer, geen gewicht (dat krimpt te snel).
    val laterFraction by animateFloatAsState(if (phase == Phase.Rest && showLater) LaterFraction else 0f, motion.laterSpring(), label = "laterFraction")
    // Doorzichtigheid is een tween, geen veer: een veer laat het knopje flikkeren.
    val laterAlpha by animateFloatAsState(if (phase == Phase.Rest) 1f else 0f, tween(260), label = "laterAlpha")
    val barFill by animateColorAsState(
        // Het spoor van de download is de lichte tint, de vulling het volle primair: dat leest als een balk. Is hij vol (installeren), dan is de hele
        // balk de vulling, zodat er geen kleursprong is.
        when (phase) { Phase.Rest -> colors.primary; Phase.Busy -> colors.primaryContainer; Phase.Installing -> colors.primary },
        motion.colour(), label = "barFill",
    )
    val ink by animateColorAsState(if (phase == Phase.Busy) colors.onPrimaryContainer else colors.onPrimary, motion.colour(), label = "barInk")
    val shownProgress by animateFloatAsState(progress, motion.spatial(), label = "updateProgress")
    val fillAlpha by animateFloatAsState(if (phase == Phase.Busy) 1f else 0f, tween(400), label = "fillAlpha")
    val pill = RoundedCornerShape(percent = 50)

    Row(Modifier.padding(top = if (showLater) 14.dp else 0.dp).fillMaxWidth().height(ButtonHeight)) {
        if (laterFraction > 0.002f) {
            val fraction = laterFraction.coerceIn(0.001f, LaterFraction)
            Box(
                Modifier.weight(fraction).fillMaxHeight().graphicsLayer { alpha = laterAlpha }
                    .clip(pill).background(colors.surfaceContainerHighest).pressable(phase == Phase.Rest, style, onLater),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    stringResource(R.string.markupdate_later), style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold),
                    color = colors.primary, maxLines = 1, softWrap = false,
                )
            }
            Spacer(Modifier.width(8.dp * (fraction / LaterFraction)))
        }
        Box(
            Modifier.weight(1f - laterFraction.coerceIn(0f, LaterFraction)).fillMaxHeight().clip(pill).background(barFill).pressable(barEnabled, style, onBar),
        ) {
            Box(
                Modifier.fillMaxHeight().fillMaxWidth(shownProgress.coerceIn(0f, 1f)).graphicsLayer { alpha = fillAlpha }
                    .clip(pill).background(colors.primary),
            )
            if (phase == Phase.Installing) Sheen(Modifier.matchParentSize())
            AnimatedContent(
                targetState = phase, transitionSpec = slideUp(3, style), modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center, label = "updateLabel",
            ) { p ->
                val label = when (p) {
                    Phase.Rest -> restLabel
                    Phase.Busy -> "${(progress * 100).toInt()}%"
                    Phase.Installing -> stringResource(R.string.markupdate_installing)
                }
                val textStyle = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold)
                if (p == Phase.Busy) {
                    ProgressLabel(label, textStyle, shownProgress.coerceIn(0f, 1f), colors.onPrimary, colors.onPrimaryContainer)
                } else {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(label, style = textStyle, color = ink, maxLines = 1) }
                }
            }
        }
    }
}

/**
 * Het percentage rijdt mee op de rand van de vulling en staat nooit half op de vulling en half op het spoor: is er plek, dan staat het in de vulling
 * (wit op primair) tegen de rand aan, anders vlak achter de rand op het spoor (donker op de tint). Het springt bij die overgang met een veer over.
 */
@Composable
private fun ProgressLabel(label: String, style: androidx.compose.ui.text.TextStyle, progress: Float, onFill: Color, onTrack: Color) {
    val pad = with(LocalDensity.current) { 14.dp.toPx() }
    var textWidth by remember { mutableIntStateOf(0) }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val fillEnd = constraints.maxWidth * progress
        val inside = fillEnd >= textWidth + pad * 2
        val shift by animateFloatAsState(if (inside) -(textWidth + pad) else pad, spring(dampingRatio = 0.9f, stiffness = Spring.StiffnessMediumLow), label = "labelShift")
        val ink by animateColorAsState(if (inside) onFill else onTrack, tween(200), label = "labelInk")
        Text(
            label, style = style, color = ink, maxLines = 1, softWrap = false,
            modifier = Modifier.align(Alignment.CenterStart).onSizeChanged { textWidth = it.width }.offset { IntOffset((fillEnd + shift).roundToInt(), 0) },
        )
    }
}

/** Een zacht licht dat over de balk loopt zolang het installeert. */
@Composable
private fun Sheen(modifier: Modifier) {
    val x by rememberInfiniteTransition(label = "sheen").animateFloat(0f, 1f, infiniteRepeatable(tween(1200, easing = LinearEasing)), label = "sheenX")
    Box(
        modifier.drawBehind {
            val band = size.width * 0.5f
            val start = x * (size.width + band) - band
            drawRect(
                Brush.horizontalGradient(listOf(Color.Transparent, Color.White.copy(alpha = 0.16f), Color.Transparent), startX = start, endX = start + band),
                topLeft = Offset(start, 0f), size = Size(band, size.height),
            )
        },
    )
}

/** De oude tekst schuift omhoog weg, de nieuwe komt van onder: een veer voor de beweging, tweens voor het vervagen. */
private fun slideUp(divisor: Int, style: UpdateCardStyle): AnimatedContentTransitionScope<Phase>.() -> ContentTransform = {
    val move: FiniteAnimationSpec<IntOffset> = spring(dampingRatio = 0.85f, stiffness = Spring.StiffnessMediumLow, visibilityThreshold = IntOffset.VisibilityThreshold)
    (slideInVertically(move) { it / divisor } + fadeIn(tween(260))) togetherWith
        (slideOutVertically(tween(260, easing = style.motion.easing)) { -it / divisor } + fadeOut(tween(160)))
}

/** Het downloaden of installeren mislukte: waarom, en één brede knop om opnieuw te proberen. */
@Composable
private fun FailedCard(reason: String, style: UpdateCardStyle, onRetry: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    val pill = RoundedCornerShape(percent = 50)
    Column(Modifier.fillMaxWidth().clip(style.shape).background(colors.surfaceContainer).padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(IconSize).clip(RoundedCornerShape(15.dp)).background(colors.errorContainer), contentAlignment = Alignment.Center) {
                Icon(painterResource(R.drawable.markupdate_ic_error), contentDescription = null, tint = colors.onErrorContainer, modifier = Modifier.size(24.dp))
            }
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.markupdate_failed), style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(reason, style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
        Box(
            Modifier.padding(top = 14.dp).fillMaxWidth().height(ButtonHeight).clip(pill).background(colors.primary).pressable(true, style, onRetry),
            contentAlignment = Alignment.Center,
        ) {
            Text(stringResource(R.string.markupdate_retry), style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold), color = colors.onPrimary)
        }
    }
}

/**
 * Een tik die terugpraat: de knop duikt onder de vinger en veert terug, met de rimpel eronder. De rimpel eerst en het duiken erna, zodat
 * de rimpel de hele knop vult terwijl de inhoud krimpt.
 */
private fun Modifier.pressable(enabled: Boolean, style: UpdateCardStyle, onClick: () -> Unit): Modifier = composed {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed && enabled) style.pressedScale else 1f, style.motion.press(), label = "pressScale")
    clickable(interactionSource = source, indication = ripple(), enabled = enabled, role = Role.Button, onClick = onClick)
        .graphicsLayer { scaleX = scale; scaleY = scale }
}
