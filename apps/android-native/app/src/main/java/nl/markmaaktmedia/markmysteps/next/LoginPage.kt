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
fun LoginPage(dark: Boolean, onDone: () -> Unit, onDemo: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    var server by rememberSaveable { mutableStateOf(Api.base) }
    var name by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var mfaToken by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val heroH = (LocalConfiguration.current.screenHeightDp * 0.36f).dp

    fun submit() {
        if (busy) return
        error = null
        busy = true
        scope.launch {
            try {
                val token = mfaToken
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
                    401 -> if (mfaToken == null) "Naam of wachtwoord klopt niet" else "Die code klopt niet"
                    429 -> "Even te vaak geprobeerd, wacht een minuut"
                    else -> e.message
                }
            } finally {
                busy = false
            }
        }
    }

    // imePadding shrinks the page above the keyboard, so the focused field is scrolled into view.
    Column(Modifier.fillMaxSize().background(cs.background).imePadding().verticalScroll(rememberScrollState())) {
        Box(Modifier.fillMaxWidth().height(heroH)) {
            Globe(
                trips = DemoPast + DemoUpcoming,
                style = GlobeStyle(
                    sphere = if (dark) Color(0xFF101418) else Color(0xFFEADFCE),
                    land = if (dark) Color(0xFF29313A) else Color(0xFFD8C9AD),
                    dark = dark,
                ),
                modifier = Modifier.fillMaxSize(),
            )
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.55f to Color.Transparent, 1f to cs.background)))
        }
        Column(Modifier.padding(horizontal = 20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                // The brand mark as everywhere: the compass on its own, in the accent colour.
                LineIcon(Glyphs.logo, cs.primary, size = 40.dp, stroke = 2.1f)
                Text(
                    "MarkMySteps",
                    style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 30.sp, letterSpacing = (-0.02).em, color = cs.onBackground),
                    modifier = Modifier.padding(start = 14.dp),
                )
            }
            Text(
                "Log in op je eigen server om je reizen te zien.",
                style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 15.sp, color = cs.onSurfaceVariant),
                modifier = Modifier.padding(top = 10.dp, bottom = 20.dp),
            )

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
                            Field("Server", server, { server = it }, "jouw-server.nl", KeyboardType.Uri)
                            Field("Gebruikersnaam of e-mail", name, { name = it }, "", KeyboardType.Email, autofill = androidx.compose.ui.autofill.ContentType.Username)
                            Field("Wachtwoord", password, { password = it }, "", KeyboardType.Password, secret = true, done = ::submit, autofill = androidx.compose.ui.autofill.ContentType.Password)
                        } else {
                            Text(
                                "Vul de code uit je authenticator-app in.",
                                style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 14.sp, color = cs.onSurfaceVariant),
                            )
                            // Focus at once, and sign in by itself on the sixth digit, as on the web.
                            Field("Code", code, { v ->
                                code = v.filter(Char::isLetterOrDigit).take(12)
                                if (code.length == 6 && code.all(Char::isDigit)) submit()
                            }, "123456", KeyboardType.Number, done = ::submit, autofill = androidx.compose.ui.autofill.ContentType.SmsOtpCode, focusNow = true)
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
                    enabled = !busy && (if (mfaToken == null) server.isNotBlank() && name.isNotBlank() && password.isNotEmpty() else code.length >= 6),
                    shapes = ButtonDefaults.shapes(),
                    contentPadding = PaddingValues(vertical = 16.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (busy) LoadingIndicator(Modifier.size(24.dp), color = cs.onPrimary)
                    else Text(if (mfaToken == null) "Inloggen" else "Bevestigen", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 16.sp))
                }
            }
            TextButton(onClick = onDemo, modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 10.dp)) {
                Text("Bekijk met voorbeelden", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp))
            }
            Text(
                "Deze testapp leest alleen. Hij verandert niets aan je reizen.",
                style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 12.5.sp, color = cs.onSurfaceVariant),
                modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 4.dp, bottom = 24.dp),
            )
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
