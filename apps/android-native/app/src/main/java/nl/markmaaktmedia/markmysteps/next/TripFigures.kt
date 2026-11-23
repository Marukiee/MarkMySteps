package nl.markmaaktmedia.markmysteps.next

/*
 * How a trip's figures are counted, by the same rules as the server and the
 * web, so a trip says the same number on every screen. Pure functions only
 * (no Android, no strings), so the JVM tests can pin them down.
 */
object TripFigures {
    /** The country you live in: not a country visited (the server's HOME_COUNTRY). */
    private const val HOME_COUNTRY = "nl"

    /** The order "auto" picks figures in, as the web's FACT_ORDER. */
    val FactOrder = listOf("km", "days", "stops", "photos", "travellers", "countries")

    /** At most this many figures stand under the cover. */
    const val MaxFacts = 4

    /** "🇲🇦" to "ma"; a two-letter code stays as it is; anything else (the 📍 of a stop without a country) is null. */
    fun codeOfFlag(flag: String?): String? {
        if (flag == null) return null
        if (flag.length == 2 && flag.all { it.isLetter() }) return flag.lowercase()
        val cps = flag.codePoints().toArray().filter { it in 0x1F1E6..0x1F1FF }
        if (cps.size != 2) return null
        return cps.joinToString("") { ('a' + (it - 0x1F1E6)).toString() }
    }

    /**
     * How many countries a trip went to, as the server's trip stats count them: every country code of its stops,
     * day trips included, once each; a stop without a country and the home country do not count.
     */
    fun countryCountOfCodes(codes: List<String?>): Int =
        codes.mapNotNull { it?.lowercase()?.takeIf { c -> c.length == 2 && c != HOME_COUNTRY } }.distinct().size

    /** [countryCountOfCodes] for the stops of a trip and their day trips, read from their flags. */
    fun countryCount(stops: List<Stop>): Int =
        countryCountOfCodes(stops.flatMap { s -> listOf(codeOfFlag(s.flag)) + s.dayTrips.map { codeOfFlag(it.flag) } })

    /**
     * How many countries a trip's book or summary names: every known country of its stops, the home country too
     * (the web's summary counts it the same way); a stop without a country does not count.
     */
    fun namedCountries(stops: List<Stop>): Int = stops.mapNotNull { codeOfFlag(it.flag) }.distinct().size

    /**
     * How many places a plan covers, for the stops figure, as the server's countStopPlaces: every route stop,
     * even a city slept in twice, and a day trip once per place (~100 m), however often it is made. The way
     * there and back is not in [stops] (it is the trip's outbound and back leg).
     */
    fun stopPlaceCount(stops: List<Stop>): Int {
        val seen = HashSet<String>()
        var count = 0
        for (s in stops) {
            seen += spot(s.at)
            count++
        }
        for (d in stops.flatMap { it.dayTrips }) {
            val at = d.at ?: continue
            if (seen.add(spot(at))) count++
        }
        return count
    }

    private fun spot(at: LonLat) = "%.3f,%.3f".format(java.util.Locale.ROOT, at.second, at.first)

    /**
     * The figures to show, as the web's resolveFacts: the trip's own choice first, in its own order, then the
     * fixed order; only figures that have something to say ([available] holds just those), at most [max].
     */
    fun <T> pickFacts(available: Map<String, T>, chosen: List<String>?, max: Int = MaxFacts): List<T> =
        (chosen.orEmpty() + FactOrder).distinct().mapNotNull { available[it] }.take(max)
}
