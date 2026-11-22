package nl.markmaaktmedia.markmysteps.next

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DateRangePicker
import androidx.compose.material3.DatePickerDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDateRangePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneOffset

/*
 * A new trip, as on the web: a name and the days it runs, picked in Material's
 * date range picker. The trip is made on the server and opens straight away.
 */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewTripSheet(onDismiss: () -> Unit, onCreated: (String) -> Unit) {
    // The calendar in Dutch, with Monday first, as everywhere else in the app.
    androidx.compose.runtime.CompositionLocalProvider(androidx.compose.ui.platform.LocalProvidableLocaleList provides androidx.compose.ui.text.intl.LocaleList("nl-NL")) { NewTripSheetBody(onDismiss, onCreated) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NewTripSheetBody(onDismiss: () -> Unit, onCreated: (String) -> Unit) {
    val cs = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    var title by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    HapticOn(error, Haptic.Reject)
    val haptics = rememberHaptics()
    var start by remember { mutableStateOf<java.time.LocalDate?>(null) }
    var end by remember { mutableStateOf<java.time.LocalDate?>(null) }
    AppSheet(onDismiss = onDismiss) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(bottom = 12.dp)) {
            Column(Modifier.padding(horizontal = 16.dp)) {
                Text(stringResource(R.string.newtrip_title), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 24.sp, color = cs.onSurface))
                Text(stringResource(R.string.newtrip_name), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 16.dp, bottom = 6.dp))
                Row(Modifier.fillMaxWidth().height(54.dp).clip(RoundedCornerShape(18.dp)).background(cs.surfaceContainerHighest).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.weight(1f)) {
                        if (title.isEmpty()) Text(stringResource(R.string.newtrip_name_hint), style = TextStyle(fontFamily = Inter, fontSize = 16.sp, color = cs.onSurfaceVariant.copy(alpha = 0.7f)))
                        BasicTextField(title, { title = it.take(120) }, singleLine = true, textStyle = TextStyle(fontFamily = Inter, fontSize = 16.sp, color = cs.onSurface), cursorBrush = SolidColor(cs.primary), modifier = Modifier.fillMaxWidth())
                    }
                }
                // The label on the line of "Naam", the chosen days under it in a soft cross-fade.
                Text(stringResource(R.string.newtrip_when), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 18.dp, bottom = 4.dp))
                val nl = java.util.Locale.forLanguageTag("nl-NL")
                fun mon(d: java.time.LocalDate) = d.month.getDisplayName(java.time.format.TextStyle.SHORT, nl).trimEnd('.')
                val s0 = start; val e0 = end
                val label = when {
                    s0 == null -> stringResource(R.string.newtrip_days_pick)
                    e0 == null || e0 == s0 -> "${s0.dayOfMonth} ${mon(s0)} ${s0.year}"
                    else -> "${s0.dayOfMonth}${if (s0.month != e0.month || s0.year != e0.year) " " + mon(s0) else ""}${if (s0.year != e0.year) " " + s0.year else ""} t/m ${e0.dayOfMonth} ${mon(e0)} ${e0.year}"
                }
                val fade = MaterialTheme.motionScheme.fastEffectsSpec<Float>()
                androidx.compose.animation.AnimatedContent(label, transitionSpec = { androidx.compose.animation.fadeIn(fade) togetherWith androidx.compose.animation.fadeOut(fade) }, label = "range") { t ->
                    Text(t, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 21.sp, color = if (s0 == null) cs.onSurfaceVariant else cs.onSurface))
                }
                RangeCalendar(start, end, onChange = { a, b -> start = a; end = b }, modifier = Modifier.padding(top = 16.dp))
            }
            error?.let { Text(it, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.error), modifier = Modifier.padding(horizontal = 22.dp)) }
            Button(
                onClick = {
                    val s = start ?: return@Button
                    busy = true; error = null
                    scope.launch {
                        runCatching {
                            val body = JSONObject().put("title", title.trim()).put("startDate", s.toString()).put("endDate", (end ?: s).toString())
                            JSONObject(Api.send("POST", "/api/trips", body)).getString("id")
                        }.onSuccess { id -> haptics(Haptic.Confirm); Data.load(); onCreated(id) }.onFailure { error = Lang.text(R.string.newtrip_create_failed) }
                        busy = false
                    }
                },
                enabled = !busy && title.isNotBlank() && start != null,
                shapes = ButtonDefaults.shapes(),
                contentPadding = PaddingValues(vertical = 16.dp),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            ) {
                // The spinner takes the label's place in a fixed box, so the button never changes size.
                Box(Modifier.height(22.dp), contentAlignment = Alignment.Center) {
                    if (busy) LoadingIndicator(Modifier.size(22.dp), color = cs.onPrimary)
                    else Text(stringResource(R.string.newtrip_create), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 16.sp))
                }
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}
