package nl.markmaaktmedia.markmysteps.next

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume
import androidx.compose.ui.res.stringResource

/*
 * Asking for your location, the one way the whole app does it: a short word in Dutch on why first, then
 * Android's own question, and a clear way on when the answer was no. Used by route tracking (Instellingen,
 * the trip's settings, the question on an ongoing trip) and by the trip map's "where am I" button.
 */

/** What a location request can do: [run] asks only when needed, then calls back with yes. */
class LocationRequest internal constructor() {
    internal var pending: (() -> Unit)? = null
    internal var explain by mutableStateOf(false)
    internal var granted: (android.content.Context) -> Boolean = { Tracker.hasPermission(it) }

    fun run(context: android.content.Context, onGranted: () -> Unit) {
        if (granted(context)) { onGranted(); return }
        pending = onGranted
        explain = true
    }
}

/**
 * A remembered request with its explanation dialog. [notifications] also asks to show notifications (for
 * tracking's own notification). [onRefused] hears a Dutch line on what to do now; when Android will not ask
 * again ([permanent]) the line points to the phone's settings.
 */
@Composable
fun rememberLocationRequest(
    title: String, text: String, notifications: Boolean = false,
    onRefused: (message: String, permanent: Boolean) -> Unit,
): LocationRequest {
    val context = LocalContext.current
    val request = remember { LocationRequest() }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { got ->
        val yes = got[android.Manifest.permission.ACCESS_FINE_LOCATION] == true || got[android.Manifest.permission.ACCESS_COARSE_LOCATION] == true
        val then = request.pending
        request.pending = null
        if (yes) then?.invoke() else {
            val activity = context as? android.app.Activity
            // Android asks only twice; after that only the phone's settings can say yes.
            val permanent = activity != null && !activity.shouldShowRequestPermissionRationale(android.Manifest.permission.ACCESS_FINE_LOCATION)
            onRefused(
                if (permanent) Lang.text(R.string.locacc_off)
                else Lang.text(R.string.locacc_denied),
                permanent,
            )
        }
    }
    if (request.explain) Confirm(
        title, text, stringResource(R.string.locacc_continue), danger = false,
        onConfirm = {
            val wanted = listOf(android.Manifest.permission.ACCESS_FINE_LOCATION, android.Manifest.permission.ACCESS_COARSE_LOCATION) +
                if (notifications && android.os.Build.VERSION.SDK_INT >= 33) listOf(android.Manifest.permission.POST_NOTIFICATIONS) else emptyList()
            ask.launch(wanted.toTypedArray())
        },
        onDismiss = { request.explain = false },
    )
    return request
}

/** Opens this app's page in the phone's settings, where location can be switched on again. */
fun openAppSettings(context: android.content.Context) {
    runCatching {
        context.startActivity(
            android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.fromParts("package", context.packageName, null))
                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }
}

/**
 * Where the phone is now, once, for the blue dot on the map: the last known spot straight away when it is
 * fresh, else one new position (at most ten seconds). Never recorded or sent anywhere; that is tracking's job.
 */
suspend fun currentLocation(context: android.content.Context): LonLat? {
    if (!Tracker.hasPermission(context)) return null
    val lm = context.getSystemService(android.location.LocationManager::class.java) ?: return null
    val providers = listOf(android.location.LocationManager.FUSED_PROVIDER, android.location.LocationManager.GPS_PROVIDER, android.location.LocationManager.NETWORK_PROVIDER)
        .filter { runCatching { lm.isProviderEnabled(it) }.getOrDefault(false) }
    try {
        val recent = providers.mapNotNull { lm.getLastKnownLocation(it) }.maxByOrNull { it.time }
        if (recent != null && System.currentTimeMillis() - recent.time < 2 * 60_000) return recent.longitude to recent.latitude
        val provider = providers.firstOrNull() ?: return recent?.let { it.longitude to it.latitude }
        val fresh = withTimeoutOrNull(10_000) {
            suspendCancellableCoroutine<android.location.Location?> { cont ->
                val signal = android.os.CancellationSignal()
                cont.invokeOnCancellation { signal.cancel() }
                lm.getCurrentLocation(provider, signal, context.mainExecutor) { loc -> if (cont.isActive) cont.resume(loc) }
            }
        }
        return (fresh ?: recent)?.let { it.longitude to it.latitude }
    } catch (_: SecurityException) {
        return null
    }
}
