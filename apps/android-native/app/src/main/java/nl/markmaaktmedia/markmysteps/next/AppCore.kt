package nl.markmaaktmedia.markmysteps.next

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/**
 * The app-wide switches of Weergave and Gegevens that the web keeps in its own storage: the navigation bar,
 * the size of the photo cache, how many photos a timeline row holds after a pinch, and whether the hidden
 * developer page is unlocked.
 */
object AppPrefs {
    private var prefs: android.content.SharedPreferences? = null

    /** The bar stays on the trip page too ("Altijd"), instead of sliding away there ("Automatisch"). */
    var navBarAlways by mutableStateOf(false); private set
    /** Megabytes the photos on disk may take; 0 is no limit. 250 as on the web. */
    var photoCacheMb by mutableIntStateOf(250); private set
    /** Photos per row in a timeline, as the last pinch left it. */
    var timelinePerRow by mutableIntStateOf(2); private set
    /** Five taps on the version in Over opened the developer page. */
    var developer by mutableStateOf(false); private set

    fun init(context: Context) {
        val p = context.getSharedPreferences("mms.next.ui", Context.MODE_PRIVATE)
        prefs = p
        navBarAlways = p.getBoolean("navBarAlways", false)
        photoCacheMb = p.getInt("photoCacheMb", 250)
        timelinePerRow = p.getInt("timelinePerRow", 2)
        developer = p.getBoolean("developer", false)
    }

    fun changeNavBarAlways(v: Boolean) { navBarAlways = v; prefs?.edit()?.putBoolean("navBarAlways", v)?.apply() }
    fun changePhotoCacheMb(v: Int) {
        photoCacheMb = v.coerceAtLeast(0)
        prefs?.edit()?.putInt("photoCacheMb", photoCacheMb)?.apply()
        PhotoDisk.trimSoon()
    }
    fun changeTimelinePerRow(v: Int) { timelinePerRow = v; prefs?.edit()?.putInt("timelinePerRow", v)?.apply() }
    fun changeDeveloper(v: Boolean) { developer = v; prefs?.edit()?.putBoolean("developer", v)?.apply() }
}

/**
 * Whether something full screen is open over the app (the photo viewer, the big map, the photo book, the
 * summary). With the navigation bar on "Altijd" it still never lies over those.
 */
object Chrome {
    var immersive by mutableIntStateOf(0); private set

    @Composable
    fun Immersive(on: Boolean = true) {
        DisposableEffect(on) {
            if (on) immersive++
            onDispose { if (on) immersive-- }
        }
    }
}

/** A screen of a new user opened from the developer page as a preview: it changes and sends nothing. */
object ScreenPreview {
    var open by mutableStateOf<String?>(null)
}

/**
 * Photos kept on disk, as the web keeps them in its cache storage: thumbnails, previews and faces you looked at
 * stay on the phone across restarts, so they show at once and without a connection. Originals never: they are
 * big and only the viewer asks for them. When the folder grows past the limit in Gegevens, the photos looked at
 * longest ago go first.
 */
object PhotoDisk {
    private var dir: File? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile private var trimQueued = false

    fun init(context: Context) {
        dir = File(context.noBackupFilesDir, "photos").apply { mkdirs() }
    }

    fun wanted(key: String): Boolean = !key.endsWith("/original") && !key.startsWith("device:")

    private fun file(key: String): File? = dir?.let { File(it, sha1(key)) }

    private fun sha1(s: String): String = MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

    fun get(key: String): ByteArray? {
        if (!wanted(key)) return null
        val f = file(key) ?: return null
        if (!f.exists()) return null
        return runCatching { f.readBytes().also { f.setLastModified(System.currentTimeMillis()) } }.getOrNull()
    }

    fun put(key: String, data: ByteArray) {
        if (!wanted(key) || AppPrefs.photoCacheMb == -1) return
        val f = file(key) ?: return
        runCatching {
            val tmp = File(f.parentFile, f.name + ".tmp")
            tmp.writeBytes(data)
            tmp.renameTo(f)
        }
        trimSoon()
    }

    fun remove(key: String) { file(key)?.delete() }

    fun usedBytes(): Long = dir?.listFiles()?.sumOf { it.length() } ?: 0L

    fun clear() { dir?.listFiles()?.forEach { it.delete() } }

    /** Brings the folder under the limit, a moment after the last photo came in. */
    fun trimSoon() {
        if (trimQueued) return
        trimQueued = true
        scope.launch {
            kotlinx.coroutines.delay(1500)
            trimQueued = false
            trim()
        }
    }

    private fun trim() {
        val limit = AppPrefs.photoCacheMb.toLong() * 1024 * 1024
        if (limit <= 0) return
        val files = dir?.listFiles()?.sortedBy { it.lastModified() } ?: return
        var total = files.sumOf { it.length() }
        for (f in files) {
            if (total <= limit) break
            total -= f.length()
            f.delete()
        }
    }
}

/**
 * Changes made without a connection, kept until there is one, as the web's pendingWrites.ts: the planner's
 * edits (stops added, moved, deleted, nights and transport changed) are queued when the server cannot be
 * reached and replayed in the order they were made, oldest first, once it can again. A rejected change
 * (4xx) is dropped so it cannot block everything behind it; a network failure, a rate limit or a server
 * error stops the run and keeps the rest. Kept on the phone, so it survives a restart.
 *
 * Dry run: writes never leave the phone and are never queued, and the queue is never replayed, so a test
 * can neither send nor lose a real queued change.
 */
object Offline {
    private const val KEY = "queue"
    private var prefs: android.content.SharedPreferences? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lock = Mutex()

    /** Changes waiting for a connection. */
    var count by mutableIntStateOf(0); private set
    /** Whether the server answered the last time it was asked. */
    var reachable by mutableStateOf(true); private set

    /** The paths the web queues: the planner's writes on a trip's stops. */
    private val queueable = Regex("^/api/trips/[^/]+/stops(/.*)?$")
    fun queues(method: String, path: String) = method != "GET" && queueable.matches(path.substringBefore('?'))

    fun init(context: Context) {
        prefs = context.getSharedPreferences("mms.next.pending", Context.MODE_PRIVATE)
        count = read().length()
        val cm = context.getSystemService(ConnectivityManager::class.java)
        runCatching {
            cm?.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) { scope.launch { kotlinx.coroutines.delay(800); probe(); flush() } }
                override fun onLost(network: Network) { if (cm.activeNetwork == null) reachable = false }
            })
        }
        if (cm?.activeNetwork == null) reachable = false
    }

    private fun read(): JSONArray = runCatching { JSONArray(prefs?.getString(KEY, "[]") ?: "[]") }.getOrDefault(JSONArray())

    private fun write(a: JSONArray) {
        prefs?.edit()?.putString(KEY, a.toString())?.apply()
        count = a.length()
    }

    /** Called by Api for every answer or failure, so the banner knows. */
    fun heard(ok: Boolean) {
        if (reachable != ok) reachable = ok
        if (ok && count > 0) scope.launch { flush() }
    }

    fun enqueue(method: String, path: String, body: String?) {
        synchronized(this) {
            val a = read()
            a.put(JSONObject().put("id", java.util.UUID.randomUUID().toString()).put("method", method).put("path", path)
                .put("body", body ?: JSONObject.NULL).put("at", System.currentTimeMillis()))
            write(a)
        }
    }

    /** For the developer page: throw the queue away. */
    fun clear() = synchronized(this) { write(JSONArray()) }

    /** Asks the server something tiny when it was unreachable, so the banner goes as soon as it answers. */
    suspend fun probe() {
        if (reachable || !Api.signedIn) return
        runCatching { Api.get("/api/notifications/count") }
    }

    suspend fun flush() {
        if (Api.dryRun || !Api.signedIn || count == 0) return
        if (!lock.tryLock()) return
        try {
            while (true) {
                val next = synchronized(this) { read().optJSONObject(0) } ?: break
                val body = next.opt("body").takeIf { it is String } as String?
                val outcome = runCatching { Api.replay(next.getString("method"), next.getString("path"), body) }
                val status = (outcome.exceptionOrNull() as? Api.Failure)?.status
                if (outcome.isFailure && (status == null || status == 0 || status == 408 || status == 429 || status >= 500)) break
                synchronized(this) {
                    val a = read()
                    val rest = JSONArray()
                    for (i in 0 until a.length()) a.optJSONObject(i)?.takeIf { it.optString("id") != next.optString("id") }?.let { rest.put(it) }
                    write(rest)
                }
            }
        } finally {
            lock.unlock()
        }
        if (count == 0) runCatching { Data.load() }
    }
}

/**
 * The last things that went wrong between the app and the server, for the developer page: when, the method,
 * the path without its query, the status and the server's message. Never a token, a password or a body.
 */
object ApiLog {
    private val lines = ArrayDeque<String>()

    fun add(method: String, path: String, status: Int, message: String?) {
        val at = java.time.LocalTime.now().withNano(0)
        val line = "$at $method ${path.substringBefore('?')} ${if (status == 0) "no connection" else status.toString()}${message?.let { ": " + it.take(160) } ?: ""}"
        synchronized(lines) {
            lines.addLast(line)
            while (lines.size > 40) lines.removeFirst()
        }
    }

    fun text(): String = synchronized(lines) { lines.reversed().joinToString("\n") }
}
