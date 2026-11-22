package nl.markmaaktmedia.markmysteps.next

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.layout.height
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.toShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ClipOp
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/*
 * Instellingen › Account, as the web's Profiel tab: the profile photo (choose, crop, look at, remove),
 * name and username, the password and two-step verification. Also opened straight from the face at the
 * top right of the homepage. Passwords and codes live only in plain `remember` (never in saved state),
 * are masked with an eye to show them, and are wiped after sending and when the page closes.
 */

private val Username = Regex("^[a-z0-9._-]{3,30}$")

@Composable
fun AccountPage(onBack: () -> Unit, onSignIn: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    val live = Data.live
    var account by remember { mutableStateOf<SettingsRemote.Account?>(null) }
    LaunchedEffect(live, Data.version) { if (live) runCatching { SettingsRemote.account() }.onSuccess { account = it } }
    var confirmSignOut by remember { mutableStateOf(false) }

    SettingsScaffold(stringResource(R.string.account_title), onBack) {
        PhotoPanel(account)
        NamePanel(account, onSaved = { scope.launch { Data.load() } })
        PasswordPanel(account, onSignIn)
        TwoFactorPanel()
        Spacer(Modifier.size(24.dp))
        Group(null, listOf(
            Item(if (live) Glyphs.signOut else Glyphs.arrowRight, if (live) stringResource(R.string.account_sign_out) else stringResource(R.string.account_sign_in), if (live) stringResource(R.string.account_sign_out_hint) else stringResource(R.string.account_sign_in_hint), plain = true, danger = live,
                action = { if (live) confirmSignOut = true else onSignIn() }),
        ))
    }
    if (confirmSignOut) Confirm(
        stringResource(R.string.account_sign_out_title), stringResource(R.string.account_sign_out_text), stringResource(R.string.account_sign_out),
        onConfirm = onSignIn, onDismiss = { confirmSignOut = false },
    )
}

/** The profile photo: what travel companions see of you on maps and in timelines. */
@Composable
private fun PhotoPanel(account: SettingsRemote.Account?) {
    val cs = MaterialTheme.colorScheme
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var menu by remember { mutableStateOf(false) }
    var crop by remember { mutableStateOf<Bitmap?>(null) }
    var view by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var busy by remember { mutableStateOf(false) }
    val me = Data.me
    val hasAvatar = me?.hasAvatar == true
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch {
            crop = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { decodeScaled(context, uri) }
            if (crop == null) note = Lang.text(R.string.account_photo_unreadable) to true
        }
    }
    Header(stringResource(R.string.account_photo), top = true)
    Panel {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box {
                Box(Modifier.size(76.dp).dip { if (Data.live) menu = true }) {
                    Avatar(me?.id, me?.name ?: "Mark", hasAvatar, cs.primary, Modifier.fillMaxSize(), MaterialShapes.Cookie12Sided.toShape())
                    Box(
                        Modifier.align(Alignment.BottomEnd).size(28.dp).clip(CircleShape).background(cs.primaryContainer),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (busy) androidx.compose.material3.LoadingIndicator(Modifier.size(18.dp), color = cs.onPrimaryContainer)
                        else LineIcon(Glyphs.camera, cs.onPrimaryContainer, size = 15.dp, stroke = 2f)
                    }
                }
                AppMenu(menu, { menu = false }, listOf(
                    listOfNotNull(
                        if (hasAvatar) MenuEntry(stringResource(R.string.account_photo_view), Glyphs.photo) { view = true } else null,
                        MenuEntry(if (hasAvatar) stringResource(R.string.account_photo_choose_other) else stringResource(R.string.account_photo_choose), Glyphs.camera) { pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                        if (hasAvatar) MenuEntry(stringResource(R.string.account_photo_crop), Glyphs.pencil) {
                            scope.launch { crop = me?.id?.let { Photos.cached("avatar/$it") ?: Photos.avatar(it) } }
                        } else null,
                    ),
                    if (hasAvatar) listOf(MenuEntry(stringResource(R.string.account_photo_remove), Glyphs.trash, danger = true) {
                        scope.launch {
                            busy = true
                            note = runCatching { SettingsRemote.removeAvatar() }.fold({
                                me?.id?.let { Photos.forget("avatar/$it") }; Data.load(); Lang.text(R.string.account_photo_removed) to false
                            }, { (it.message ?: Lang.text(R.string.account_photo_remove_failed)) to true })
                            busy = false
                        }
                    }) else emptyList(),
                ))
            }
            Column(Modifier.weight(1f).padding(start = 16.dp)) {
                Text(me?.name ?: "Mark", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 20.sp, color = cs.onSurface))
                Text(if (Data.live) "@${me?.username ?: ""}" else stringResource(R.string.account_examples_signed_out), style = ValueStyle.copy(color = cs.onSurfaceVariant))
            }
        }
        Hint(stringResource(R.string.account_photo_hint))
        Note(note?.first, note?.second == true)
    }
    crop?.let { source ->
        CropDialog(source, onCancel = { crop = null }, onDone = { jpeg ->
            crop = null
            scope.launch {
                busy = true
                note = runCatching { SettingsRemote.uploadAvatar(jpeg) }.fold({
                    me?.id?.let { Photos.forget("avatar/$it") }; Data.load(); Lang.text(R.string.account_photo_saved) to false
                }, { (it.message ?: Lang.text(R.string.account_photo_upload_failed)) to true })
                busy = false
            }
        })
    }
    if (view && me != null) Dialog(onDismissRequest = { view = false }) {
        val bitmap by produceState(Photos.cached("avatar/${me.id}")) { if (value == null) value = Photos.avatar(me.id) }
        Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(32.dp)).background(cs.surfaceContainerHigh).dip { view = false }) {
            bitmap?.let { Image(it.asImageBitmap(), stringResource(R.string.account_photo), contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
        }
    }
}

/** A picked photo, read at most about 2000 pixels on its longest side. */
private fun decodeScaled(context: android.content.Context, uri: android.net.Uri): Bitmap? = runCatching {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 2000) sample *= 2
    context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
}.getOrNull()

/** Move and pinch the photo inside the circle; what is inside becomes the profile photo (512 by 512). */
@Composable
private fun CropDialog(source: Bitmap, onCancel: () -> Unit, onDone: (ByteArray) -> Unit) {
    val cs = MaterialTheme.colorScheme
    var box by remember { mutableFloatStateOf(1f) }
    var zoom by remember { mutableFloatStateOf(1f) }
    var pan by remember { mutableStateOf(Offset.Zero) }
    Dialog(onDismissRequest = onCancel, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier.padding(16.dp).fillMaxWidth().clip(RoundedCornerShape(32.dp)).background(cs.surfaceContainerLow).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(stringResource(R.string.account_photo_crop), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 20.sp, color = cs.onSurface))
            val base = maxOf(box / source.width, box / source.height)
            fun clamp(p: Offset, z: Float): Offset {
                val w = source.width * base * z; val h = source.height * base * z
                val mx = (w - box) / 2f; val my = (h - box) / 2f
                return Offset(p.x.coerceIn(-mx, mx), p.y.coerceIn(-my, my))
            }
            Box(
                Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(24.dp)).background(Color.Black)
                    .onSizeChanged { box = it.width.toFloat() }
                    .pointerInput(source) {
                        detectTransformGestures { _, move, scale, _ ->
                            zoom = (zoom * scale).coerceIn(1f, 6f)
                            pan = clamp(pan + move, zoom)
                        }
                    },
            ) {
                Image(
                    source.asImageBitmap(), null, contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize().graphicsLayer { scaleX = zoom; scaleY = zoom; translationX = pan.x; translationY = pan.y },
                )
                // Darkened outside the circle, so you see what stays.
                Canvas(Modifier.fillMaxSize()) {
                    val circle = Path().apply { addOval(androidx.compose.ui.geometry.Rect(Offset.Zero, size)) }
                    clipPath(circle, ClipOp.Difference) { drawRect(Color.Black.copy(alpha = 0.55f)) }
                    drawCircle(Color.White.copy(alpha = 0.8f), radius = size.minDimension / 2f, style = androidx.compose.ui.graphics.drawscope.Stroke(2.dp.toPx()))
                }
            }
            Hint(stringResource(R.string.account_crop_hint))
            ButtonRow {
                SoftButton(stringResource(R.string.account_cancel), onCancel, Modifier.weight(1f))
                MainButton(stringResource(R.string.account_crop_save), {
                    // The square on screen, back in the photo's own pixels.
                    val k = base * zoom
                    val side = box / k
                    val cx = source.width / 2f - pan.x / k; val cy = source.height / 2f - pan.y / k
                    val left = (cx - side / 2f).toInt().coerceIn(0, source.width - 1)
                    val top = (cy - side / 2f).toInt().coerceIn(0, source.height - 1)
                    val s = side.toInt().coerceAtMost(minOf(source.width - left, source.height - top)).coerceAtLeast(1)
                    val square = Bitmap.createBitmap(source, left, top, s, s)
                    val out = Bitmap.createScaledBitmap(square, 512, 512, true)
                    val bytes = java.io.ByteArrayOutputStream().also { out.compress(Bitmap.CompressFormat.JPEG, 88, it) }.toByteArray()
                    onDone(bytes)
                }, Modifier.weight(1f), enabled = box > 1f)
            }
        }
    }
}

/** Name and username; the username is checked with the server while you type. */
@Composable
private fun NamePanel(account: SettingsRemote.Account?, onSaved: () -> Unit) {
    val scope = rememberCoroutineScope()
    var name by remember(account?.displayName) { mutableStateOf(account?.displayName ?: Data.me?.name ?: "") }
    var username by remember(account?.username) { mutableStateOf(account?.username ?: Data.me?.username ?: "") }
    val current = account?.username ?: Data.me?.username ?: ""
    // same, invalid, checking, free, taken, unknown: as the web's useUsernameCheck.
    var check by remember { mutableStateOf("same") }
    LaunchedEffect(username, current) {
        val wanted = username.trim()
        check = when {
            wanted.isEmpty() || wanted == current -> "same"
            !Username.matches(wanted) -> "invalid"
            else -> "checking"
        }
        if (check != "checking") return@LaunchedEffect
        delay(350)
        check = when (SettingsRemote.usernameFree(wanted)) { true -> "free"; false -> "taken"; null -> "unknown" }
    }
    var note by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var busy by remember { mutableStateOf(false) }
    Header(stringResource(R.string.account_name_title))
    Panel {
        FormField(stringResource(R.string.account_name), name, { name = it; note = null }, capitalize = true, autofill = androidx.compose.ui.autofill.ContentType.PersonFullName)
        FormField(
            stringResource(R.string.account_username), username, { username = it.lowercase().filter { c -> !c.isWhitespace() }.take(30); note = null },
            prefix = "@", type = KeyboardType.Ascii,
            support = when (check) {
                "invalid" -> stringResource(R.string.account_username_invalid)
                "checking" -> stringResource(R.string.account_username_checking)
                "free" -> stringResource(R.string.account_username_free)
                "taken" -> stringResource(R.string.account_username_taken)
                else -> stringResource(R.string.account_username_hint)
            },
            supportError = check == "invalid" || check == "taken",
        )
        MainButton(stringResource(R.string.account_save_profile), {
            busy = true; note = null
            scope.launch {
                val before = current
                note = runCatching { SettingsRemote.saveProfile(name, username) }.fold({ saved ->
                    onSaved()
                    if (saved != null && saved != before) Lang.text(R.string.account_username_saved, saved) to false else Lang.text(R.string.account_profile_saved) to false
                }, { (it.message ?: Lang.text(R.string.account_save_failed)) to true })
                busy = false
            }
        }, Modifier.fillMaxWidth(), busy = busy, enabled = Data.live && name.isNotBlank() && check != "invalid" && check != "taken")
        Note(note?.first, note?.second == true)
    }
}

/** Current, new and the new once more; at least ten characters, as the server wants. */
@Composable
private fun PasswordPanel(account: SettingsRemote.Account?, onSignIn: () -> Unit) {
    val scope = rememberCoroutineScope()
    var current by remember { mutableStateOf("") }
    var new by remember { mutableStateOf("") }
    var again by remember { mutableStateOf("") }
    var note by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var busy by remember { mutableStateOf(false) }
    DisposableEffect(Unit) { onDispose { current = ""; new = ""; again = "" } }
    val strength = passwordStrength(new, listOfNotNull(account?.username, account?.displayName, account?.email?.substringBefore('@')))
    val mismatch = again.isNotEmpty() && again != new
    Header(stringResource(R.string.account_password))
    Panel {
        Hint(stringResource(R.string.account_password_hint))
        FormField(stringResource(R.string.account_password_current), current, { current = it; note = null }, secret = true, autofill = androidx.compose.ui.autofill.ContentType.Password)
        FormField(stringResource(R.string.account_password_new), new, { new = it; note = null }, secret = true, autofill = androidx.compose.ui.autofill.ContentType.NewPassword,
            support = strength.first, supportError = strength.second)
        FormField(stringResource(R.string.account_password_again), again, { again = it; note = null }, secret = true, autofill = androidx.compose.ui.autofill.ContentType.NewPassword,
            support = if (mismatch) stringResource(R.string.account_password_mismatch) else null, supportError = mismatch)
        MainButton(stringResource(R.string.account_password_change), {
            busy = true; note = null
            val c = current; val n = new
            current = ""; new = ""; again = ""
            scope.launch {
                note = runCatching { SettingsRemote.changePassword(c, n) }.fold({
                    // The server ends the other sessions; as on the web you sign in again with the new one.
                    // Never in test mode: that "success" is only a blocked write.
                    if (!Api.dryRun) scope.launch { delay(2500); onSignIn() }
                    Lang.text(R.string.account_password_changed) to false
                }, { (it.message ?: Lang.text(R.string.account_password_change_failed)) to true })
                busy = false
            }
        }, Modifier.fillMaxWidth(), busy = busy, enabled = Data.live && current.isNotEmpty() && new.length >= 10 && new == again)
        Note(note?.first, note?.second == true)
    }
}

/** A short verdict on a new password, after the web's PasswordStrength: the text and whether it is a warning. */
private fun passwordStrength(p: String, personal: List<String>): Pair<String?, Boolean> {
    if (p.isEmpty()) return null to false
    if (p.length < 10) return Lang.text(R.string.account_strength_short) to true
    val lower = p.lowercase()
    if (personal.any { it.length >= 3 && lower.contains(it.lowercase()) }) return Lang.text(R.string.account_strength_personal) to true
    if (p.toSet().size < 5) return Lang.text(R.string.account_strength_distinct) to true
    val kinds = listOf(p.any { it.isLowerCase() }, p.any { it.isUpperCase() }, p.any { it.isDigit() }, p.any { !it.isLetterOrDigit() }).count { it }
    return when {
        p.length >= 16 && kinds >= 2 -> Lang.text(R.string.account_strength_very_strong) to false
        p.length >= 12 && kinds >= 2 -> Lang.text(R.string.account_strength_strong) to false
        kinds >= 3 -> Lang.text(R.string.account_strength_strong) to false
        else -> Lang.text(R.string.account_strength_fair) to false
    }
}

/** Copies a secret with the "sensitive" mark, so Android does not show it in the clipboard preview. */
fun copySecret(context: android.content.Context, label: String, text: String) {
    val clip = android.content.ClipData.newPlainText(label, text)
    if (android.os.Build.VERSION.SDK_INT >= 33) {
        clip.description.extras = android.os.PersistableBundle().apply { putBoolean(android.content.ClipDescription.EXTRA_IS_SENSITIVE, true) }
    }
    (context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager).setPrimaryClip(clip)
}

/**
 * Keeps what is on screen out of screenshots, screen recordings, casting and the recent-apps picture while [on]:
 * for a 2FA key, recovery codes and passwords. Works in the window it is drawn in, the page or a sheet.
 */
@androidx.compose.runtime.Composable
fun SecureWhile(on: Boolean) {
    val view = androidx.compose.ui.platform.LocalView.current
    androidx.compose.runtime.DisposableEffect(on, view) {
        var c = view.context
        while (c !is android.app.Activity && c is android.content.ContextWrapper) c = c.baseContext
        val window = (view.parent as? androidx.compose.ui.window.DialogWindowProvider)?.window ?: (c as? android.app.Activity)?.window
        val flag = android.view.WindowManager.LayoutParams.FLAG_SECURE
        if (on) window?.addFlags(flag)
        onDispose { if (on) window?.clearFlags(flag) }
    }
}

/** Two-step verification, the web's steps: password, scan, codes, and turning it off or new codes. */
@Composable
private fun TwoFactorPanel() {
    val cs = MaterialTheme.colorScheme
    val context = LocalContext.current
    val haptics = rememberHaptics()
    val scope = rememberCoroutineScope()
    // The last known state first (only on/off and how many codes are left), so the panel opens complete.
    var status by remember { mutableStateOf(SettingsRemote.cachedTwoFactor()) }
    var loaded by remember { mutableStateOf(!Data.live || status != null) }
    suspend fun reload() { runCatching { SettingsRemote.twoFactor() }.onSuccess { status = it }; loaded = true }
    LaunchedEffect(Data.live) { if (Data.live) reload() }
    // idle, password, scan, codes, disable, renew
    var step by remember { mutableStateOf("idle") }
    var setup by remember { mutableStateOf<SettingsRemote.Setup?>(null) }
    var codes by remember { mutableStateOf<List<String>>(emptyList()) }
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var copied by remember { mutableStateOf(false) }
    DisposableEffect(Unit) { onDispose { password = ""; code = ""; setup = null; codes = emptyList() } }
    fun go(next: String) { step = next; password = ""; code = ""; error = null; copied = false; if (next != "scan") setup = null; if (next != "codes") codes = emptyList() }
    fun run(action: suspend () -> Unit) {
        busy = true; error = null; message = null
        scope.launch {
            try { action() } catch (e: Exception) { error = e.message?.takeIf { it.isNotBlank() } ?: Lang.text(R.string.account_2fa_failed) }
            busy = false
        }
    }

    Header(stringResource(R.string.account_2fa))
    Panel(animate = true) {
        val motion = MaterialTheme.motionScheme
        AnimatedContent(step, transitionSpec = { fadeIn(motion.defaultEffectsSpec()) togetherWith fadeOut(motion.fastEffectsSpec()) }, label = "2fa") { s ->
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                when (s) {
                    "idle" -> {
                        val st = status
                        if (!loaded) Placeholder(Modifier.fillMaxWidth().height(64.dp).clip(RoundedCornerShape(16.dp)))
                        else {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                if (st != null) {
                                    Row(
                                        Modifier.clip(CircleShape).background(if (st.enabled) cs.primaryContainer else cs.surfaceContainerHigh).padding(horizontal = 12.dp, vertical = 6.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        LineIcon(if (st.enabled) Glyphs.check else Glyphs.lock, if (st.enabled) cs.onPrimaryContainer else cs.onSurfaceVariant, size = 14.dp, stroke = 2.4f)
                                        Spacer(Modifier.size(6.dp))
                                        Text(if (st.enabled) stringResource(R.string.account_2fa_on) else stringResource(R.string.account_2fa_off), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = if (st.enabled) cs.onPrimaryContainer else cs.onSurfaceVariant))
                                    }
                                    if (st.enabled) Text(
                                        when (st.codesLeft) { 0 -> stringResource(R.string.account_2fa_no_codes); else -> pluralStringResource(R.plurals.account_2fa_codes_left, st.codesLeft, st.codesLeft) },
                                        style = ValueStyle.copy(color = if (st.codesLeft <= 3) cs.error else cs.onSurfaceVariant), modifier = Modifier.padding(start = 12.dp),
                                    )
                                }
                            }
                            Hint(
                                if (st?.enabled == true) stringResource(R.string.account_2fa_on_hint)
                                else stringResource(R.string.account_2fa_off_hint),
                            )
                            if (st?.enabled == true) ButtonRow {
                                SoftButton(stringResource(R.string.account_2fa_new_codes), { go("renew") }, Modifier.weight(1f))
                                QuietDangerButton(stringResource(R.string.account_2fa_disable), { go("disable") }, Modifier.weight(1f))
                            } else MainButton(stringResource(R.string.account_2fa_enable), { go("password") }, Modifier.fillMaxWidth(), icon = Glyphs.shield, enabled = Data.live && st != null)
                        }
                    }
                    "password" -> {
                        Hint(stringResource(R.string.account_2fa_password_first))
                        FormField(stringResource(R.string.account_password), password, { password = it }, secret = true, autofill = androidx.compose.ui.autofill.ContentType.Password)
                        Note(error, true)
                        ButtonRow {
                            SoftButton(stringResource(R.string.account_cancel), { go("idle") }, Modifier.weight(1f))
                            MainButton(stringResource(R.string.account_continue), {
                                val p = password; password = ""
                                run {
                                    val got = SettingsRemote.twoFactorSetup(p) ?: throw Exception(Lang.text(R.string.account_2fa_no_key))
                                    go("scan"); setup = got
                                }
                            }, Modifier.weight(1f), busy = busy, enabled = password.isNotEmpty())
                        }
                    }
                    "scan" -> setup?.let { su ->
                        SecureWhile(true)
                        PathHint("", listOf(stringResource(R.string.account_2fa_scan_app), stringResource(R.string.account_2fa_scan_add), stringResource(R.string.account_2fa_scan_qr)), stringResource(R.string.account_2fa_scan_suffix))
                        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { QrCode(su.uri, Modifier.size(200.dp)) }
                        Hint(stringResource(R.string.account_2fa_copy_hint))
                        Row(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(cs.surfaceContainerHigh)
                                .dip { copySecret(context, Lang.text(R.string.account_2fa_key_label), su.secret); haptics(Haptic.Confirm); copied = true }.padding(horizontal = 14.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(su.secret.chunked(4).joinToString(" "), style = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 14.sp, color = cs.onSurface), modifier = Modifier.weight(1f))
                            LineIcon(if (copied) Glyphs.check else listOf(P("M9 9h11v11H9Z"), P("M5 15H4V4h11v1")), cs.primary, size = 18.dp, stroke = 2f)
                        }
                        FormField(stringResource(R.string.account_2fa_code), code, { code = it.filter { c -> c.isDigit() || c == ' ' }.take(7) }, hint = "123 456", type = KeyboardType.NumberPassword, autofill = androidx.compose.ui.autofill.ContentType.SmsOtpCode)
                        Note(error, true)
                        ButtonRow {
                            SoftButton(stringResource(R.string.account_cancel), { go("idle") }, Modifier.weight(1f))
                            MainButton(stringResource(R.string.account_2fa_enable), {
                                val c = code; code = ""
                                run { val got = SettingsRemote.twoFactorEnable(c); reload(); go("codes"); codes = got }
                            }, Modifier.weight(1f), busy = busy, enabled = code.count { it.isDigit() } == 6)
                        }
                    }
                    "codes" -> {
                        SecureWhile(true)
                        Text(
                            pathText("", listOf(stringResource(R.string.account_2fa_save_codes)), stringResource(R.string.account_2fa_save_codes_text), cs.onSurface),
                            style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.5.sp, lineHeight = 19.sp, color = cs.onSurfaceVariant),
                        )
                        if (codes.isEmpty()) Hint(stringResource(R.string.account_2fa_no_codes_back))
                        codes.chunked(2).forEach { pair ->
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                pair.forEach { c ->
                                    Text(c, style = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 15.sp, color = cs.onSurface),
                                        modifier = Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(cs.surfaceContainerHigh).padding(10.dp))
                                }
                                if (pair.size == 1) Spacer(Modifier.weight(1f))
                            }
                        }
                        ButtonRow {
                            SoftButton(if (copied) stringResource(R.string.account_2fa_copied) else stringResource(R.string.account_2fa_copy), { copySecret(context, Lang.text(R.string.account_2fa_codes_label), codes.joinToString("\n")); haptics(Haptic.Confirm); copied = true }, Modifier.weight(1f), icon = if (copied) Glyphs.check else null, enabled = codes.isNotEmpty())
                            MainButton(stringResource(R.string.account_2fa_saved_them), { go("idle") }, Modifier.weight(1f))
                        }
                    }
                    else -> {
                        Hint(if (s == "disable") stringResource(R.string.account_2fa_disable_hint) else stringResource(R.string.account_2fa_renew_hint))
                        FormField(stringResource(R.string.account_password), password, { password = it }, secret = true, autofill = androidx.compose.ui.autofill.ContentType.Password)
                        FormField(stringResource(R.string.account_2fa_code_or_recovery), code, { code = it.take(24) }, secret = true, type = KeyboardType.Password, autofill = androidx.compose.ui.autofill.ContentType.SmsOtpCode)
                        Note(error, true)
                        ButtonRow {
                            SoftButton(stringResource(R.string.account_cancel), { go("idle") }, Modifier.weight(1f))
                            MainButton(if (s == "disable") stringResource(R.string.account_2fa_disable) else stringResource(R.string.account_2fa_new_codes), {
                                val p = password; val c = code; password = ""; code = ""
                                run {
                                    if (s == "disable") { SettingsRemote.twoFactorDisable(p, c); reload(); go("idle"); message = Lang.text(R.string.account_2fa_is_off) }
                                    else { val got = SettingsRemote.twoFactorNewCodes(p, c); reload(); go("codes"); codes = got }
                                }
                            }, Modifier.weight(1f), busy = busy, danger = s == "disable", enabled = password.isNotEmpty() && code.trim().length >= 6)
                        }
                    }
                }
            }
        }
        Note(message)
    }
}

/** A QR code, always black on white with a quiet zone, whatever the theme: scanners need the contrast. */
@Composable
fun QrCode(value: String, modifier: Modifier) {
    val matrix = remember(value) {
        runCatching {
            com.google.zxing.qrcode.QRCodeWriter().encode(value, com.google.zxing.BarcodeFormat.QR_CODE, 0, 0, mapOf(com.google.zxing.EncodeHintType.MARGIN to 4, com.google.zxing.EncodeHintType.ERROR_CORRECTION to com.google.zxing.qrcode.decoder.ErrorCorrectionLevel.M))
        }.getOrNull()
    }
    Canvas(modifier.clip(RoundedCornerShape(12.dp)).background(Color.White)) {
        val m = matrix ?: return@Canvas
        val cell = size.minDimension / m.width
        for (y in 0 until m.height) for (x in 0 until m.width) {
            if (m.get(x, y)) drawRect(Color.Black, Offset(x * cell, y * cell), androidx.compose.ui.geometry.Size(cell + 0.5f, cell + 0.5f))
        }
    }
}
