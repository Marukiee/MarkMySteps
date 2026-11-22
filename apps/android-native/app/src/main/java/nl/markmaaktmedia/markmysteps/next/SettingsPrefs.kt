package nl.markmaaktmedia.markmysteps.next

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/** One airport of the web's bundled list (OurAirports, made by apps/web/scripts/build-airports.mjs). */
data class Airport(val iata: String, val name: String, val city: String, val country: String, val lat: Double, val lon: Double, val size: Char)

/**
 * Every airport with scheduled flights and an IATA code, read once from the asset the web's list was copied
 * into, and the web's search: by code, city, name or another name it goes by, accents folded away.
 */
object Airports {
    private var list: List<Airport> = emptyList()
    private var city: List<String> = emptyList()
    private var name: List<String> = emptyList()
    private var all: List<String> = emptyList()
    /** Set once the list is read, so names on screen fill in when it arrives. */
    var ready by mutableStateOf(false)
        private set

    @Synchronized fun load(context: android.content.Context) {
        if (list.isNotEmpty()) return
        val lines = runCatching { context.assets.open("airports.txt").bufferedReader().readLines() }.getOrDefault(emptyList())
        val parsed = lines.mapNotNull { line ->
            val p = line.split('|')
            if (p.size < 7) null else Airport(p[0], p[1], p[2], p[3], p[4].toDoubleOrNull() ?: 0.0, p[5].toDoubleOrNull() ?: 0.0, p[6].firstOrNull() ?: 'S') to (p.getOrNull(7) ?: "")
        }
        list = parsed.map { it.first }
        city = list.map { fold(it.city) }
        name = list.map { fold(it.name) }
        all = parsed.map { (a, words) -> fold("${a.iata} ${a.city} ${a.name} $words") }
        android.os.Handler(android.os.Looper.getMainLooper()).post { ready = true; AirportPref.refresh() }
    }

    /** On the main thread: reads the list if it is not there yet and marks it ready at once. */
    @Synchronized fun loadNow(context: android.content.Context) { load(context); ready = true; AirportPref.refresh() }

    private fun fold(text: String) = java.text.Normalizer.normalize(text, java.text.Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "").lowercase()

    fun byCode(code: String): Airport? = if (!ready) null else list.firstOrNull { it.iata.equals(code, ignoreCase = true) }

    fun search(query: String, limit: Int = 6): List<Airport> {
        val q = fold(query.trim())
        if (q.isEmpty() || !ready) return emptyList()
        return list.indices.mapNotNull { i ->
            val a = list[i]
            val score = when {
                a.iata.lowercase() == q -> 100
                city[i] == q -> 80
                city[i].startsWith(q) -> 60
                name[i].startsWith(q) -> 50
                all[i].contains(" $q") -> 40
                all[i].contains(q) -> 20
                else -> 0
            }
            if (score == 0) null else i to score + when (a.size) { 'L' -> 6; 'M' -> 3; else -> 0 }
        }.sortedWith(compareByDescending<Pair<Int, Int>> { it.second }.thenBy { it.first }).take(limit).map { list[it.first] }
    }
}

/**
 * Your home airports, as on the web (Schiphol and Eindhoven until you say otherwise). The first is the
 * main one: the globe treats it as home, so it gets no destination dot of its own. Kept on the phone.
 */
object AirportPref {
    private var prefs: android.content.SharedPreferences? = null
    val codes = mutableStateListOf("AMS", "EIN")
    /** Where the first one lies, kept with it so the globe needs no airport list at start. */
    var home by mutableStateOf<LonLat>(4.76 to 52.31)
        private set

    /**
     * Where every one of them lies, as on the web: each airport you fly out of is home, not a destination, so a
     * flight from Eindhoven gets no trip dot (nor the trip's name) there either. Kept so the globe needs no
     * airport list at start.
     */
    val homes = mutableStateListOf<LonLat>(4.76 to 52.31, 5.37 to 51.45)

    /** Is this point one of your home airports? */
    fun isHome(p: LonLat, within: Double = 0.4): Boolean = homes.any { angle(it, p) < within }

    /** Fills [homes] from the airport list once it is read, for codes chosen before it was kept. */
    fun refresh() {
        val found = codes.mapNotNull { c -> Airports.byCode(c)?.let { it.lon to it.lat } }
        if (found.isEmpty() || found == homes.toList()) return
        homes.clear(); homes += found
        prefs?.edit()?.putString("airportHomes", found.joinToString(";") { "${it.first},${it.second}" })?.apply()
    }

    /** The city of each, kept with it, so the chips show it at once without the airport list. */
    val cities = androidx.compose.runtime.mutableStateMapOf("AMS" to "Amsterdam", "EIN" to "Eindhoven")

    fun init(context: android.content.Context) {
        prefs = context.getSharedPreferences("mms.next.ui", android.content.Context.MODE_PRIVATE)
        runCatching { org.json.JSONObject(prefs?.getString("airportCities", "{}") ?: "{}").let { o -> o.keys().forEach { k -> cities[k] = o.getString(k) } } }
        runCatching {
            val a = org.json.JSONArray(prefs?.getString("airports", null) ?: return@runCatching)
            if (a.length() > 0) { codes.clear(); for (i in 0 until a.length()) codes += a.getString(i) }
        }
        prefs?.getString("airportHomes", null)?.split(';')?.mapNotNull { q -> q.split(',').takeIf { it.size == 2 }?.let { (a, b) -> a.toDoubleOrNull()?.let { x -> b.toDoubleOrNull()?.let { y -> x to y } } } }
            ?.takeIf { it.isNotEmpty() }?.let { homes.clear(); homes += it }
        prefs?.getString("airportHome", null)?.split(',')?.let { p -> if (p.size == 2) home = (p[0].toDoubleOrNull() ?: home.first) to (p[1].toDoubleOrNull() ?: home.second) }
    }

    fun set(next: List<String>) {
        val cleaned = next.distinct().ifEmpty { listOf("AMS") }
        codes.clear(); codes += cleaned
        Airports.byCode(cleaned.first())?.let { home = it.lon to it.lat }
        cleaned.forEach { c -> Airports.byCode(c)?.let { cities[c] = it.city } }
        refresh()
        prefs?.edit()?.putString("airports", org.json.JSONArray(cleaned).toString())?.putString("airportHome", "${home.first},${home.second}")
            ?.putString("airportCities", org.json.JSONObject(cities.toMap()).toString())?.apply()
    }
}

/**
 * Which four figures a trip's page shows under its cover, chosen per trip in its settings, as the web's
 * "Feitjes op de cover". Null is automatic: the page's own choice.
 */
object TripFactsPref {
    val Ids = listOf("km", "days", "stops", "photos", "travellers", "countries")
    val Names get() = mapOf("km" to Lang.text(R.string.fact_distance), "days" to Lang.text(R.string.fact_days), "stops" to Lang.text(R.string.fact_stops), "photos" to Lang.text(R.string.fact_photos), "travellers" to Lang.text(R.string.fact_travellers), "countries" to Lang.text(R.string.fact_countries))
    const val MAX = 4
    private var prefs: android.content.SharedPreferences? = null
    val chosen = androidx.compose.runtime.mutableStateMapOf<String, List<String>>()

    fun init(context: android.content.Context) {
        prefs = context.getSharedPreferences("mms.next.ui", android.content.Context.MODE_PRIVATE)
        runCatching {
            val o = org.json.JSONObject(prefs?.getString("tripFacts", "{}") ?: "{}")
            o.keys().forEach { k -> val a = o.getJSONArray(k); chosen[k] = (0 until a.length()).map { a.getString(it) } }
        }
    }

    fun set(tripId: String, ids: List<String>?) {
        if (ids.isNullOrEmpty()) chosen.remove(tripId) else chosen[tripId] = ids
        prefs?.edit()?.putString("tripFacts", org.json.JSONObject(chosen.mapValues { org.json.JSONArray(it.value) }).toString())?.apply()
    }
}

/**
 * The small switches of Instellingen, kept on the phone as the web keeps them in its own storage:
 * stops on the globe always or only when a trip is highlighted, companions' photos in your figures,
 * your own position on the homepage globe, Android's accent colour, the tracking interval and
 * the notifications check.
 */
object UiPrefs {
    private var prefs: android.content.SharedPreferences? = null
    /** Every trip shows its stops on the homepage globe, not only the one on show. */
    var globeStopsAlways by mutableStateOf(false); private set
    /** Your figures count only the photos you added yourself. */
    var ownPhotosOnly by mutableStateOf(false); private set
    /** While tracking, your position is a dot on the homepage globe too. */
    var selfOnHome by mutableStateOf(false); private set
    /** The accent colour Android takes from your wallpaper. */
    var wallpaperAccent by mutableStateOf(false); private set
    /** Minutes between two positions while tracking. */
    var trackMinutes by androidx.compose.runtime.mutableIntStateOf(5); private set
    /** The app looks for new notifications every quarter of an hour, also when closed. */
    var notify by mutableStateOf(false); private set

    fun init(context: android.content.Context) {
        val p = context.getSharedPreferences("mms.next.ui", android.content.Context.MODE_PRIVATE)
        prefs = p
        globeStopsAlways = p.getBoolean("globeStopsAlways", false)
        ownPhotosOnly = p.getBoolean("ownPhotosOnly", false)
        selfOnHome = p.getBoolean("selfOnHome", false)
        wallpaperAccent = p.getBoolean("wallpaperAccent", false)
        trackMinutes = p.getInt("trackMinutes", 5)
        notify = p.getBoolean("notify", false)
    }

    private fun put(k: String, v: Boolean) { prefs?.edit()?.putBoolean(k, v)?.apply() }
    fun changeGlobeStopsAlways(v: Boolean) { globeStopsAlways = v; put("globeStopsAlways", v) }
    fun changeOwnPhotosOnly(v: Boolean) { ownPhotosOnly = v; put("ownPhotosOnly", v) }
    fun changeSelfOnHome(v: Boolean) { selfOnHome = v; put("selfOnHome", v) }
    fun changeWallpaperAccent(v: Boolean) { wallpaperAccent = v; put("wallpaperAccent", v) }
    fun changeNotify(v: Boolean) { notify = v; put("notify", v) }
    fun changeTrackMinutes(v: Int) { trackMinutes = v.coerceIn(1, 240); prefs?.edit()?.putInt("trackMinutes", trackMinutes)?.apply() }
}

/** The colour scheme with Android's wallpaper accent in place of the app's own, when that is switched on. */
@androidx.compose.runtime.Composable
fun withWallpaperAccent(base: androidx.compose.material3.ColorScheme, dark: Boolean): androidx.compose.material3.ColorScheme {
    if (!UiPrefs.wallpaperAccent) return base
    val context = androidx.compose.ui.platform.LocalContext.current
    val d = if (dark) androidx.compose.material3.dynamicDarkColorScheme(context) else androidx.compose.material3.dynamicLightColorScheme(context)
    // Only the accent and what sits on it; the paper, ink and surfaces stay the app's own.
    return base.copy(
        primary = d.primary, onPrimary = d.onPrimary, primaryContainer = d.primaryContainer, onPrimaryContainer = d.onPrimaryContainer,
        secondaryContainer = d.secondaryContainer, onSecondaryContainer = d.onSecondaryContainer,
        tertiaryContainer = d.tertiaryContainer, onTertiaryContainer = d.onTertiaryContainer,
    )
}
