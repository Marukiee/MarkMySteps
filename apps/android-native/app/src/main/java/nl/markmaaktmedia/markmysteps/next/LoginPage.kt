package nl.markmaaktmedia.markmysteps.next

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.animation.core.animateFloat
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.layout.statusBars
import androidx.compose.runtime.getValue
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.toShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

/*
 * Signing in: the globe turning above, the app's name, and one card with the
 * server, the name and the password. An account with an authenticator app
 * gets a second step for its code. "Bekijk met voorbeelden" opens the app on
 * the invented trips instead.
 */

@Composable
fun LoginPage(dark: Boolean, onDone: () -> Unit, onDemo: () -> Unit, mfaPreview: Boolean = false, onRegister: () -> Unit = {}, onLocal: () -> Unit = {}) {
    val cs = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    var server by rememberSaveable { mutableStateOf(Api.base) }
    var name by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    // A test can open the second step straight away (adb extra mfaPreview) to look at it; that step then never sends anything.
    var mfaToken by remember { mutableStateOf(if (mfaPreview) PreviewToken else null) }
    // No phone at hand: one of the recovery codes instead of the app's code, as on the web.
    var recovery by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun submit() {
        if (busy) return
        error = null
        busy = true
        scope.launch {
            try {
                val token = mfaToken
                if (token == PreviewToken) { error = Lang.text(R.string.login_preview_note); return@launch }
                if (token == null) {
                    when (val answer = Api.login(server, name, password)) {
                        is Api.Login.NeedsCode -> mfaToken = answer.mfaToken
                        Api.Login.Done -> { password = ""; onDone() }
                    }
                } else {
                    Api.loginCode(token, code)
                    password = ""; code = ""
                    onDone()
                }
            } catch (e: Api.Failure) {
                error = when (e.status) {
                    401 -> if (mfaToken == null) Lang.text(R.string.login_wrong) else Lang.text(R.string.login_code_wrong)
                    429 -> Lang.text(R.string.login_too_often)
                    else -> e.message
                }
            } finally {
                busy = false
            }
        }
    }

    // The server is set once and rarely changed: shown as one line you can tap to change, a field only then.
    var editServer by rememberSaveable { mutableStateOf(server.isBlank()) }
    // imePadding shrinks the page above the keyboard, so the focused field is scrolled into view.
    Column(Modifier.fillMaxSize().background(cs.background).imePadding().verticalScroll(rememberScrollState())) {
        Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
        // No globe: the brand on its own, the compass in a slowly turning expressive shape, the name and one line.
        Column(Modifier.fillMaxWidth().padding(top = 44.dp, bottom = 28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            val spin = androidx.compose.animation.core.rememberInfiniteTransition(label = "medal")
            val turn by spin.animateFloat(0f, 360f, androidx.compose.animation.core.infiniteRepeatable(androidx.compose.animation.core.tween(40_000, easing = androidx.compose.animation.core.LinearEasing)), label = "turn")
            Box(Modifier.size(120.dp), contentAlignment = Alignment.Center) {
                Box(Modifier.matchParentSize().graphicsLayer { rotationZ = turn }.clip(MaterialShapes.Cookie9Sided.toShape()).background(cs.primaryContainer))
                LineIcon(Glyphs.logo, cs.onPrimaryContainer, size = 58.dp, stroke = 2f)
            }
            Text(
                "MarkMySteps",
                style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 34.sp, letterSpacing = (-0.02).em, color = cs.onBackground),
                modifier = Modifier.padding(top = 22.dp),
            )
            Text(
                androidx.compose.ui.res.stringResource(R.string.login_tagline),
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 15.sp, lineHeight = 21.sp, color = cs.onSurfaceVariant),
                modifier = Modifier.padding(top = 6.dp, start = 32.dp, end = 32.dp),
            )
        }
        Column(Modifier.padding(horizontal = 20.dp)) {
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(30.dp)).background(cs.surfaceContainerLow).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                AnimatedContent(
                    mfaToken != null,
                    transitionSpec = {
                        (slideInHorizontally { it / 4 } + fadeIn()) togetherWith (slideOutHorizontally { -it / 4 } + fadeOut())
                    },
                    label = "step",
                ) { second ->
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        if (!second) {
                            AnimatedContent(editServer, transitionSpec = { fadeIn() togetherWith fadeOut() using androidx.compose.animation.SizeTransform(clip = false) }, label = "server") { editing ->
                                if (editing) Field(androidx.compose.ui.res.stringResource(R.string.auth_server), server, { server = it }, androidx.compose.ui.res.stringResource(R.string.auth_server_hint), KeyboardType.Uri)
                                else Row(
                                    Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(cs.surfaceContainerHigh).clickable { editServer = true }.padding(start = 14.dp, end = 14.dp, top = 10.dp, bottom = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    LineIcon(Glyphs.cloud, cs.primary, size = 20.dp, stroke = 2f)
                                    Column(Modifier.weight(1f).padding(start = 12.dp)) {
                                        Text(androidx.compose.ui.res.stringResource(R.string.auth_server), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 12.5.sp, color = cs.onSurfaceVariant))
                                        Text(server.removePrefix("https://").removePrefix("http://"), maxLines = 1, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 15.sp, color = cs.onSurface))
                                    }
                                    LineIcon(Glyphs.pencil, cs.onSurfaceVariant, size = 18.dp, stroke = 2f)
                                }
                            }
                            Field(androidx.compose.ui.res.stringResource(R.string.login_identifier), name, { name = it }, "", KeyboardType.Email, autofill = androidx.compose.ui.autofill.ContentType.Username)
                            Field(androidx.compose.ui.res.stringResource(R.string.auth_password), password, { password = it }, "", KeyboardType.Password, secret = true, done = ::submit, autofill = androidx.compose.ui.autofill.ContentType.Password)
                        } else {
                            // The app's code or a recovery code: each its own words and field, sliding into place.
                            AnimatedContent(recovery, transitionSpec = { (fadeIn() + slideInHorizontally { it / 6 }) togetherWith fadeOut() }, label = "codeKind") { useRecovery ->
                                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                    Text(
                                        if (useRecovery) androidx.compose.ui.res.stringResource(R.string.login_recovery_hint)
                                        else androidx.compose.ui.res.stringResource(R.string.login_app_hint),
                                        style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 14.sp, lineHeight = 20.sp, color = cs.onSurfaceVariant),
                                    )
                                    if (useRecovery) Field(androidx.compose.ui.res.stringResource(R.string.login_recovery_label), code, { v ->
                                        // As typed (the server drops spaces and dashes and ignores case); changing it here fights the keyboard. Never sent by itself.
                                        code = v.take(24)
                                    }, "XXXX-XXXX-XXXX-XXXX", KeyboardType.Ascii, done = ::submit, focusNow = true)
                                    // Focus at once, and sign in by itself on the sixth digit, as on the web.
                                    else Field(androidx.compose.ui.res.stringResource(R.string.login_code_label), code, { v ->
                                        code = v.filter(Char::isLetterOrDigit).take(12)
                                        if (code.length == 6 && code.all(Char::isDigit)) submit()
                                    }, "123456", KeyboardType.Number, done = ::submit, autofill = androidx.compose.ui.autofill.ContentType.SmsOtpCode, focusNow = true)
                                }
                            }
                        }
                    }
                }
                AnimatedVisibility(error != null, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
                    Text(
                        error ?: "",
                        style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.error),
                        modifier = Modifier.padding(start = 4.dp),
                    )
                }
                Button(
                    onClick = ::submit,
                    enabled = !busy && (if (mfaToken == null) server.isNotBlank() && name.isNotBlank() && password.isNotEmpty() else code.count(Char::isLetterOrDigit) >= 6),
                    shapes = ButtonDefaults.shapes(),
                    contentPadding = PaddingValues(vertical = 16.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (busy) LoadingIndicator(Modifier.size(24.dp), color = cs.onPrimary)
                    else Text(if (mfaToken == null) androidx.compose.ui.res.stringResource(R.string.login_sign_in) else androidx.compose.ui.res.stringResource(R.string.login_confirm), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 16.sp))
                }
            }
            // On the second step: switch between the app's code and a recovery code.
            AnimatedVisibility(mfaToken != null, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut(), modifier = Modifier.align(Alignment.CenterHorizontally)) {
                val haptics = rememberHaptics()
                TextButton(onClick = { haptics(Haptic.Tick); recovery = !recovery; code = ""; error = null }, modifier = Modifier.padding(top = 10.dp)) {
                    Text(
                        androidx.compose.ui.res.stringResource(if (recovery) R.string.auth_use_app_code else R.string.auth_use_recovery),
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp),
                    )
                }
            }
            // The other ways in, as on the web: ask for an account, or keep everything on this phone (Auth.kt). Two
            // tonal pills joined as one group, under the card.
            AnimatedVisibility(mfaToken == null, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
                Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                    listOf(androidx.compose.ui.res.stringResource(R.string.auth_create_account) to onRegister, androidx.compose.ui.res.stringResource(R.string.auth_no_server) to onLocal).forEachIndexed { i, (label, go) ->
                        val shape = if (i == 0) RoundedCornerShape(topStart = 26.dp, bottomStart = 26.dp, topEnd = 8.dp, bottomEnd = 8.dp) else RoundedCornerShape(topStart = 8.dp, bottomStart = 8.dp, topEnd = 26.dp, bottomEnd = 26.dp)
                        Box(Modifier.weight(1f).height(52.dp).clip(shape).background(cs.secondaryContainer).clickable(onClick = go), contentAlignment = Alignment.Center) {
                            Text(label, maxLines = 1, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = cs.onSecondaryContainer))
                        }
                    }
                }
            }
            if (mfaToken == null) TextButton(onClick = onDemo, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                Text(androidx.compose.ui.res.stringResource(R.string.login_demo), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp))
            }
            Spacer(Modifier.height(24.dp))
            Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
        }
    }
}

@Composable
private fun Field(
    label: String, value: String, onChange: (String) -> Unit, hint: String, type: KeyboardType,
    secret: Boolean = false, done: (() -> Unit)? = null,
    autofill: androidx.compose.ui.autofill.ContentType? = null, focusNow: Boolean = false,
) {
    val focus = remember { androidx.compose.ui.focus.FocusRequester() }
    if (focusNow) androidx.compose.runtime.LaunchedEffect(Unit) { kotlinx.coroutines.delay(250); focus.requestFocus() }
    val cs = MaterialTheme.colorScheme
    var show by remember { mutableStateOf(false) }
    Column {
        Text(label, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(start = 6.dp, bottom = 6.dp))
        Row(
            Modifier.fillMaxWidth().height(54.dp).clip(RoundedCornerShape(18.dp)).background(cs.surfaceContainerHighest).padding(start = 16.dp, end = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.weight(1f)) {
                if (value.isEmpty() && hint.isNotEmpty()) Text(hint, style = TextStyle(fontFamily = Inter, fontSize = 16.sp, color = cs.onSurfaceVariant.copy(alpha = 0.7f)))
                BasicTextField(
                    value, onChange, singleLine = true,
                    textStyle = TextStyle(fontFamily = Inter, fontSize = 16.sp, color = cs.onSurface),
                    cursorBrush = SolidColor(cs.primary),
                    visualTransformation = if (secret && !show) PasswordVisualTransformation() else VisualTransformation.None,
                    keyboardOptions = KeyboardOptions(keyboardType = type, imeAction = if (done != null) ImeAction.Done else ImeAction.Next, autoCorrectEnabled = false),
                    keyboardActions = KeyboardActions(onDone = { done?.invoke() }),
                    // Tells password managers what this field is, so they offer to fill it.
                    modifier = Modifier.fillMaxWidth().focusRequester(focus)
                        .then(if (autofill != null) Modifier.semantics { contentType = autofill } else Modifier),
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
    }
}

/** The second step opened by a test to look at it: nothing is ever sent with it. */
private const val PreviewToken = "preview"
