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
import androidx.compose.material3.ModalBottomSheet
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
    val cs = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    var title by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val range = rememberDateRangePickerState()
    fun day(ms: Long?) = ms?.let { Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate() }
    val start = day(range.selectedStartDateMillis)
    val end = day(range.selectedEndDateMillis) ?: start
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = cs.surfaceContainerLow) {
        Column(Modifier.fillMaxWidth().imePadding().padding(bottom = 20.dp)) {
            Column(Modifier.padding(horizontal = 16.dp)) {
                Text("Nieuwe reis", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 24.sp, color = cs.onSurface))
                Text("Naam", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(start = 6.dp, top = 16.dp, bottom = 6.dp))
                Row(Modifier.fillMaxWidth().height(54.dp).clip(RoundedCornerShape(18.dp)).background(cs.surfaceContainerHighest).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.weight(1f)) {
                        if (title.isEmpty()) Text("Bijvoorbeeld Japan 2027", style = TextStyle(fontFamily = Inter, fontSize = 16.sp, color = cs.onSurfaceVariant.copy(alpha = 0.7f)))
                        BasicTextField(title, { title = it.take(120) }, singleLine = true, textStyle = TextStyle(fontFamily = Inter, fontSize = 16.sp, color = cs.onSurface), cursorBrush = SolidColor(cs.primary), modifier = Modifier.fillMaxWidth())
                    }
                }
            }
            DateRangePicker(
                state = range,
                modifier = Modifier.fillMaxWidth().height(420.dp),
                title = null,
                headline = {
                    Text(
                        if (start == null) "Kies de dagen" else if (end == null || end == start) "${start.dayOfMonth} ${start.month.getDisplayName(java.time.format.TextStyle.SHORT, java.util.Locale.forLanguageTag("nl-NL"))}"
                        else "${start.dayOfMonth} t/m ${end.dayOfMonth} ${end.month.getDisplayName(java.time.format.TextStyle.SHORT, java.util.Locale.forLanguageTag("nl-NL"))} ${end.year}",
                        style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 20.sp),
                        modifier = Modifier.padding(start = 24.dp, bottom = 8.dp),
                    )
                },
                showModeToggle = false,
                colors = DatePickerDefaults.colors(containerColor = cs.surfaceContainerLow),
            )
            error?.let { Text(it, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.error), modifier = Modifier.padding(horizontal = 22.dp)) }
            Button(
                onClick = {
                    val s = start ?: return@Button
                    busy = true; error = null
                    scope.launch {
                        runCatching {
                            val body = JSONObject().put("title", title.trim()).put("startDate", s.toString()).put("endDate", (end ?: s).toString())
                            JSONObject(Api.send("POST", "/api/trips", body)).getString("id")
                        }.onSuccess { id -> Data.load(); onCreated(id) }.onFailure { error = "Aanmaken mislukt" }
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
                    else Text("Reis maken", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 16.sp))
                }
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}
