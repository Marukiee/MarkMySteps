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
    /** How sure the last position was, in metres. */
    var lastAccuracy by mutableStateOf<Float?>(null); private set
    /** The last thing tracking said about itself, such as that it stopped by itself after the trip. */
    var lastStatus by mutableStateOf<String?>(null); private set
    /** Every check, newest first, as the web's location log: where, how far it moved, how sure it was. */
    var log by mutableStateOf<List<FixLog>>(emptyList()); private set
    private var prefs: android.content.SharedPreferences? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun init(context: Context) {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs = p
        tripId = p.getString("trip", null)
        tripTitle = p.getString("title", null)
        buffered = runCatching { JSONArray(p.getString("buffer", "[]")).length() }.getOrDefault(0)
        p.getString("last", null)?.split(',')?.takeIf { it.size == 3 }?.let { lastFix = Triple(it[0].toDouble(), it[1].toDouble(), it[2].toLong()) }
        lastAccuracy = p.getFloat("lastAcc", -1f).takeIf { it >= 0f }
        lastStatus = p.getString("status", null)
        log = runCatching { JSONArray(p.getString("log", "[]")).let { a -> (0 until a.length()).map { FixLog.from(a.getJSONObject(it)) } } }.getOrDefault(emptyList())
    }

    /** One check of the location log. [movedM] is null for the first one after starting. */
    data class FixLog(val at: Long, val lng: Double, val lat: Double, val movedM: Int?, val accuracyM: Int?, val stayCount: Int = 0) {
        fun json(): JSONObject = JSONObject().put("at", at).put("lng", lng).put("lat", lat).put("moved", movedM ?: JSONObject.NULL).put("acc", accuracyM ?: JSONObject.NULL).put("stay", stayCount)
        companion object {
            fun from(o: JSONObject) = FixLog(o.getLong("at"), o.getDouble("lng"), o.getDouble("lat"), if (o.isNull("moved")) null else o.optInt("moved"), if (o.isNull("acc")) null else o.optInt("acc"), o.optInt("stay"))
        }
    }

    private fun pushLog(entry: FixLog, mergeStay: Boolean) {
        val now = log.toMutableList()
        if (mergeStay && now.isNotEmpty()) {
            val top = now[0]
            now[0] = top.copy(at = entry.at, accuracyM = entry.accuracyM, stayCount = top.stayCount + 1)
        } else now.add(0, entry)
        log = now.take(60)
        prefs?.edit()?.putString("log", JSONArray(log.map { it.json() }).toString())?.apply()
    }

    fun hasPermission(context: Context) =
        context.checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED ||
            context.checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED

    /**
     * Starts recording for a trip. [lastDay] is the trip's last day; without it the trip list on the phone is
     * asked, so tracking always knows when to stop by itself, also with no signal.
     */
    fun start(context: Context, id: String, title: String, lastDay: java.time.LocalDate? = null) {
        tripId = id; tripTitle = title; lastError = null; lastStatus = null
        val end = lastDay ?: lastDayOf(id)
        // The last day is a day you are still on: a trip that ends today is under way until tonight.
        val until = end?.plusDays(1)?.atStartOfDay(java.time.ZoneId.systemDefault())?.toInstant()?.toEpochMilli()
        prefs?.edit()?.putString("trip", id)?.putString("title", title)?.putString("bufferTrip", id)?.remove("status")
            ?.apply { if (until != null) putLong("until", until) else remove("until") }?.apply()
        context.startForegroundService(Intent(context, TrackingService::class.java))
        stopIfOver(context)
    }

    /** The last day of a trip from the trip list kept on the phone. */
    private fun lastDayOf(id: String): java.time.LocalDate? = runCatching {
        val a = JSONArray(Api.recall("trips") ?: return null)
        (0 until a.length()).map { a.getJSONObject(it) }.firstOrNull { it.optString("id") == id }?.getString("endDate")?.take(10)?.let { java.time.LocalDate.parse(it) }
    }.getOrNull()

    /**
     * Switches tracking off once its trip is over, as the web does: a tracker left running records the drive
     * home and every commute after it. Checked at start, on every position and whenever the app opens; says so
     * with a notification, since the app is rarely on screen when a trip ends.
     */
    fun stopIfOver(context: Context): Boolean {
        if (tripId == null) return false
        var until = prefs?.getLong("until", 0L) ?: 0L
        if (until <= 0L) {
            // Started before the end date was known: learn it now from the trip list.
            val end = lastDayOf(tripId!!) ?: return false
            until = end.plusDays(1).atStartOfDay(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli()
            prefs?.edit()?.putLong("until", until)?.apply()
        }
        if (System.currentTimeMillis() <= until) return false
        stop(context)
        val message = "Tracking is automatisch gestopt."
        lastStatus = message
        prefs?.edit()?.putString("status", message)?.apply()
        runCatching {
            val nm = context.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel("tracking-done", "Tracking gestopt", NotificationManager.IMPORTANCE_DEFAULT))
            val open = PendingIntent.getActivity(context, 2, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
            nm.notify(8, Notification.Builder(context, "tracking-done").setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setContentTitle("Tracking gestopt").setContentText(message).setContentIntent(open).setAutoCancel(true).build())
        }
        return true
    }

    fun stop(context: Context) {
        tripId = null; tripTitle = null
        prefs?.edit()?.remove("trip")?.remove("title")?.remove("until")?.apply()
        context.stopService(Intent(context, TrackingService::class.java))
        flush()
    }

    /** Signing out: stop without sending the waiting points, and forget them and the log (they belong to that account). */
    fun wipe(context: Context) {
        tripId = null; tripTitle = null
        context.stopService(Intent(context, TrackingService::class.java))
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().apply {
            listOf("trip", "title", "until", "buffer", "bufferTrip", "log", "last", "lastAcc", "status").forEach { remove(it) }
        }.apply()
        buffered = 0
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
        lastAccuracy = if (loc.hasAccuracy()) loc.accuracy else null
        prefs?.edit()?.putString("last", "${loc.longitude},${loc.latitude},$now")?.putFloat("lastAcc", lastAccuracy ?: -1f)?.apply()
        val acc = if (loc.hasAccuracy()) loc.accuracy.toInt() else null
        if (prev != null) {
            val d = FloatArray(1)
            Location.distanceBetween(prev.second, prev.first, loc.latitude, loc.longitude, d)
            // Standing still: one point, not a cloud of them (as the web merges a stay into one).
            pushLog(FixLog(now, loc.longitude, loc.latitude, d[0].toInt(), acc), mergeStay = d[0] < 40f)
            if (d[0] < 40f && buffered > 0) return
        } else pushLog(FixLog(now, loc.longitude, loc.latitude, null, acc), mergeStay = false)
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
        if (Tracker.stopIfOver(applicationContext)) { stopSelf(); return START_NOT_STICKY }
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

    override fun onLocationChanged(location: Location) {
        // The trip is over: no more points for it, and the service goes.
        if (Tracker.stopIfOver(applicationContext)) return
        Tracker.record(location)
    }

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
