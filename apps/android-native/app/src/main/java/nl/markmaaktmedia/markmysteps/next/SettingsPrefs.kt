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

    fun load(context: android.content.Context) {
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
    }

    private fun fold(text: String) = java.text.Normalizer.normalize(text, java.text.Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "").lowercase()

    fun byCode(code: String): Airport? = list.firstOrNull { it.iata.equals(code, ignoreCase = true) }

    fun search(query: String, limit: Int = 6): List<Airport> {
        val q = fold(query.trim())
        if (q.isEmpty()) return emptyList()
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

    fun init(context: android.content.Context) {
        prefs = context.getSharedPreferences("mms.next.ui", android.content.Context.MODE_PRIVATE)
        runCatching {
            val a = org.json.JSONArray(prefs?.getString("airports", null) ?: return@runCatching)
            if (a.length() > 0) { codes.clear(); for (i in 0 until a.length()) codes += a.getString(i) }
        }
        prefs?.getString("airportHome", null)?.split(',')?.let { p -> if (p.size == 2) home = (p[0].toDoubleOrNull() ?: home.first) to (p[1].toDoubleOrNull() ?: home.second) }
    }

    fun set(next: List<String>) {
        val cleaned = next.distinct().ifEmpty { listOf("AMS") }
        codes.clear(); codes += cleaned
        Airports.byCode(cleaned.first())?.let { home = it.lon to it.lat }
        prefs?.edit()?.putString("airports", org.json.JSONArray(cleaned).toString())?.putString("airportHome", "${home.first},${home.second}")?.apply()
    }
}

/**
 * Which four figures a trip's page shows under its cover, chosen per trip in its settings, as the web's
 * "Feitjes op de cover". Null is automatic: the page's own choice.
 */
object TripFactsPref {
    val Ids = listOf("km", "days", "stops", "photos", "travellers", "countries")
    val Names = mapOf("km" to "Afstand", "days" to "Dagen", "stops" to "Stops", "photos" to "Foto's", "travellers" to "Reisgenoten", "countries" to "Landen")
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
