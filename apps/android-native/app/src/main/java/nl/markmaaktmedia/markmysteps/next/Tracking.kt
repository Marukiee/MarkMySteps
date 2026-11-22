package nl.markmaaktmedia.markmysteps.next

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.IBinder
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/*
 * Route tracking and the notifications check, the two things the web app does on the phone in the
 * background. Tracking: a foreground service (with its notification, so Android lets it run with the
 * screen off) asks for one position every few minutes, keeps the ones that moved, and sends them to
 * the trip in batches; without network they wait on the phone. Notifications: every quarter of an
 * hour Android runs a job that asks the server what is new and shows it, as the web's app does on
 * phones without a push service.
 */

/** Where tracking stands, for the settings and the homepage globe. Kept on the phone across restarts. */
object Tracker {
    private const val PREFS = "mms.next.track"
    var tripId by mutableStateOf<String?>(null); private set
    var tripTitle by mutableStateOf<String?>(null); private set
    /** The last position: longitude, latitude and when (ms). */
    var lastFix by mutableStateOf<Triple<Double, Double, Long>?>(null); private set
    var buffered by mutableIntStateOf(0); private set
    var lastError by mutableStateOf<String?>(null); private set
    private var prefs: android.content.SharedPreferences? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun init(context: Context) {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs = p
        tripId = p.getString("trip", null)
        tripTitle = p.getString("title", null)
        buffered = runCatching { JSONArray(p.getString("buffer", "[]")).length() }.getOrDefault(0)
        p.getString("last", null)?.split(',')?.takeIf { it.size == 3 }?.let { lastFix = Triple(it[0].toDouble(), it[1].toDouble(), it[2].toLong()) }
    }

    fun hasPermission(context: Context) =
        context.checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED ||
            context.checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED

    fun start(context: Context, id: String, title: String) {
        tripId = id; tripTitle = title; lastError = null
        prefs?.edit()?.putString("trip", id)?.putString("title", title)?.putString("bufferTrip", id)?.apply()
        context.startForegroundService(Intent(context, TrackingService::class.java))
    }

    fun stop(context: Context) {
        tripId = null; tripTitle = null
        prefs?.edit()?.remove("trip")?.remove("title")?.apply()
        context.stopService(Intent(context, TrackingService::class.java))
        flush()
    }

    /** A new interval reaches a running service straight away. */
    fun restartIfRunning(context: Context) { if (tripId != null) context.startForegroundService(Intent(context, TrackingService::class.java)) }

    /**
     * A trip with "Automatisch tracken" that is under way starts by itself when the app opens, as on the
     * web, but only when location access was given before: the app never asks for it unprompted.
     */
    fun autoStart(context: Context) {
        if (tripId != null || !Api.signedIn || !hasPermission(context)) return
        val raw = Api.recall("trips") ?: return
        val today = java.time.LocalDate.now()
        val trip = runCatching { JSONArray(raw) }.getOrNull()?.let { a -> (0 until a.length()).map { a.getJSONObject(it) } }?.firstOrNull { o ->
            o.optBoolean("autoTrack") && runCatching {
                !java.time.LocalDate.parse(o.getString("startDate").take(10)).isAfter(today) && !java.time.LocalDate.parse(o.getString("endDate").take(10)).isBefore(today)
            }.getOrDefault(false)
        } ?: return
        start(context, trip.getString("id"), trip.optString("title"))
    }

    /** A new position: kept when it moved more than 40 m from the last one, then sent along. */
    internal fun record(loc: Location) {
        val now = System.currentTimeMillis()
        val prev = lastFix
        lastFix = Triple(loc.longitude, loc.latitude, now)
        prefs?.edit()?.putString("last", "${loc.longitude},${loc.latitude},$now")?.apply()
        if (prev != null) {
            val d = FloatArray(1)
            Location.distanceBetween(prev.second, prev.first, loc.latitude, loc.longitude, d)
            // Standing still: one point, not a cloud of them (as the web merges a stay into one).
            if (d[0] < 40f && buffered > 0) return
        }
        val buffer = runCatching { JSONArray(prefs?.getString("buffer", "[]")) }.getOrDefault(JSONArray())
        buffer.put(JSONObject().put("clientId", java.util.UUID.randomUUID().toString()).put("recordedAt", java.time.Instant.ofEpochMilli(loc.time.takeIf { it > 0 } ?: now).toString())
            .put("latitude", loc.latitude).put("longitude", loc.longitude))
        prefs?.edit()?.putString("buffer", buffer.toString())?.apply()
        buffered = buffer.length()
        flush()
    }

    /** Sends what waits, 400 at a time; whatever does not get through waits for the next position. */
    fun flush() {
        // The trip the waiting points belong to, also after tracking stopped.
        val id = prefs?.getString("bufferTrip", null) ?: tripId ?: return
        scope.launch {
            val buffer = runCatching { JSONArray(prefs?.getString("buffer", "[]")) }.getOrDefault(JSONArray())
            if (buffer.length() == 0) return@launch
            val batch = JSONArray(); for (i in 0 until minOf(400, buffer.length())) batch.put(buffer.get(i))
            runCatching { Api.send("POST", "/api/trips/$id/points/batch", JSONObject().put("points", batch)) }
                .onSuccess {
                    val rest = JSONArray(); for (i in batch.length() until buffer.length()) rest.put(buffer.get(i))
                    prefs?.edit()?.putString("buffer", rest.toString())?.apply()
                    buffered = rest.length(); lastError = null
                }
                .onFailure { lastError = "Wacht op netwerk" }
        }
    }

    internal fun fail(message: String) { lastError = message }
}

/** Keeps tracking going with the screen off: a foreground service with its own quiet notification. */
class TrackingService : Service(), LocationListener {
    private var manager: LocationManager? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Api.init(applicationContext); UiPrefs.init(applicationContext); Tracker.init(applicationContext)
        if (Tracker.tripId == null || !Tracker.hasPermission(this)) { stopSelf(); return START_NOT_STICKY }
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("tracking", "Route-tracking", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(this, "tracking")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("Route wordt bijgehouden")
            .setContentText(Tracker.tripTitle ?: "MarkMySteps")
            .setContentIntent(open).setOngoing(true).build()
        startForeground(7, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        val m = getSystemService(LocationManager::class.java)
        manager = m
        m.removeUpdates(this)
        val every = UiPrefs.trackMinutes * 60_000L
        try {
            // GPS when it is on, else the network's position; Android wakes the GPS only once per interval.
            listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).filter { m.isProviderEnabled(it) }.forEach { p ->
                m.requestLocationUpdates(p, every, 0f, this, mainLooper)
            }
            if (!m.isProviderEnabled(LocationManager.GPS_PROVIDER) && !m.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) Tracker.fail("Locatie staat uit op je telefoon")
        } catch (e: SecurityException) {
            Tracker.fail("Geen toegang tot je locatie"); stopSelf()
        }
        return START_STICKY
    }

    override fun onLocationChanged(location: Location) { Tracker.record(location) }

    override fun onDestroy() {
        manager?.removeUpdates(this)
        super.onDestroy()
    }
}

/** Every quarter of an hour: asks the server what is new and shows it as a notification. */
class NotifyJob : JobService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onStartJob(params: JobParameters): Boolean {
        Api.init(applicationContext)
        if (!Api.signedIn) return false
        scope.launch {
            runCatching { check(applicationContext) }
            jobFinished(params, false)
        }
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean = true

    private suspend fun check(context: Context) {
        val prefs = context.getSharedPreferences("mms.next.notify", Context.MODE_PRIVATE)
        val seen = prefs.getStringSet("seen", emptySet())!!.toMutableSet()
        val fresh = Remote.notices().filter { !it.read && it.id !in seen }
        if (fresh.isEmpty()) return
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("notices", "Meldingen", NotificationManager.IMPORTANCE_DEFAULT))
        val open = PendingIntent.getActivity(context, 1, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
        fresh.take(5).forEach { n ->
            val who = n.actor ?: "Iemand"; val trip = n.trip ?: "een reis"
            val text = when (n.kind) {
                "TRIP_ADDED" -> "$who voegde je toe aan $trip"
                "ACCESS_REQUESTED" -> "$who wil meekijken met $trip"
                "ACCESS_APPROVED" -> "Je mag meekijken met $trip"
                "ACCESS_DENIED" -> "Je verzoek voor $trip is afgewezen"
                "SECURITY_LOGIN_ATTEMPTS" -> "Er werd een paar keer geprobeerd in te loggen op je account"
                else -> null
            } ?: return@forEach
            nm.notify(n.id.hashCode(), Notification.Builder(context, "notices").setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("MarkMySteps").setContentText(text).setStyle(Notification.BigTextStyle().bigText(text))
                .setContentIntent(open).setAutoCancel(true).build())
        }
        seen += fresh.map { it.id }
        prefs.edit().putStringSet("seen", seen.toList().takeLast(300).toSet()).apply()
    }

    companion object {
        private const val ID = 41
        fun schedule(context: Context) {
            val info = JobInfo.Builder(ID, ComponentName(context, NotifyJob::class.java))
                .setPeriodic(15 * 60_000L).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true).build()
            context.getSystemService(JobScheduler::class.java).schedule(info)
        }
        fun cancel(context: Context) { context.getSystemService(JobScheduler::class.java).cancel(ID) }
    }
}
