package nl.markmaaktmedia.markmysteps.next

import androidx.compose.ui.graphics.Color
import java.time.LocalDate

/** A stop or route point: longitude, latitude. */
typealias LonLat = Pair<Double, Double>

data class Person(val initial: String, val color: Color, val userId: String? = null, val hasAvatar: Boolean = false, val name: String = initial)

/** A place on the plan, with how long the trip stayed there. */
data class Stop(
    val name: String,
    val flag: String,
    val at: LonLat,
    val nights: Int,
    val dates: String,
    /** How the trip got here from the stop before. */
    val mode: Mode = Mode.Car,
    /** The first day there, for a stop read from a server. */
    val start: LocalDate? = null,
    /** Its id on the server, so changes in the planner can be saved. */
    val id: String? = null,
    /** For a flight to here: the flight number and the airports (IATA codes), as filled in on the planner. */
    val flightNumber: String? = null,
    val fromAirport: String? = null,
    val toAirport: String? = null,
    /** Excursions from here and back the same day; never a leg of the route and never a night. */
    val dayTrips: List<DayTrip> = emptyList(),
    /** The airports a flight to here changed planes at, in order. */
    val viaAirports: List<String> = emptyList(),
    /** The straight line from the stop before to here is hidden on the map (the stop itself stays). */
    val hideLeg: Boolean = false,
)

/** A day trip from a stop (Saltsjöbaden to Stockholm and back): where, and on which day. */
data class DayTrip(val id: String, val name: String, val flag: String, val at: LonLat?, val day: LocalDate?)

/** How a leg is travelled, in the order the mode menu lists them. */
enum class Mode(val label: String) { Car("Auto"), Train("Trein"), Bus("Bus"), Boat("Boot"), Flight("Vlucht") }

/** The way there or back: by air between two airports, or over land. */
data class Leg(
    val mode: Mode, val from: String, val to: String, val km: Int,
    /** Read from a server: the leg's own stop, and its flight as filled in (null when not known). */
    val id: String? = null,
    val flightNumber: String? = null,
    val fromAirport: String? = null,
    val toAirport: String? = null,
    /** A flight's stopovers; over land, the place you leave from or come back to, and where it is. */
    val viaAirports: List<String> = emptyList(),
    val placeName: String? = null,
    val place: LonLat? = null,
)

/** Stand-in for a cover photo in this test: a drawn landscape, see Scenery.kt. */
enum class Scene { Desert, SunsetSea, Snow, Coast, Highlands, Fjord, Mountains }

/**
 * One trip, in the shape the API hands the app (title, dates, route, flights,
 * stops), so the screens are written against real data from the start.
 */
data class Trip(
    val id: String,
    val title: String,
    val month: String,
    val year: String,
    val dates: String,
    val days: Int,
    val km: Int?,
    val color: Color,
    /** The recorded route: what the globe draws as a line. */
    val route: List<LonLat>,
    val flights: List<Pair<LonLat, LonLat>> = emptyList(),
    val stops: List<Stop> = emptyList(),
    val upcoming: Boolean = false,
    val startsInDays: Int? = null,
    val people: List<Person> = emptyList(),
    val extraPeople: Int = 0,
    val cover: Scene? = null,
    val photos: Int = 0,
    val outbound: Leg? = null,
    val back: Leg? = null,
    /** Set for a trip read from a server: its id there, its cover photo and its first day. */
    val remoteId: String? = null,
    val coverId: String? = null,
    val start: LocalDate? = null,
    /** Someone else's trip you were added to: it goes under Gedeeld, not under your own. */
    val shared: Boolean = false,
    /** The recorded route as the pieces it really is, each drawn on its own. */
    val segments: List<List<LonLat>> = emptyList(),
    /** Every flight with its stopovers, airport to airport. */
    val flightLegs: List<List<LonLat>> = emptyList(),
    val ownerId: String? = null,
    val members: List<Member> = emptyList(),
    /** Under way: which day of the trip today is (1 is the first). */
    val ongoingDay: Int? = null,
    /** The planned stops as points only, from the trip list (the full stops come when the trip opens). */
    val stopPoints: List<LonLat> = emptyList(),
    /** A spot picked by hand in the trip's settings for its one dot on the globe (markerLng, markerLat). */
    val marker: LonLat? = null,
)

/** Someone on a trip: organiser, companion (counts it in their figures) or guest (only looks). */
data class Member(
    val userId: String, val name: String, val username: String, val hasAvatar: Boolean,
    val role: String, val canTrack: Boolean, val from: String?, val to: String?,
)

/** The home airport (the first of Instellingen › Voorkeuren): a flight from here gets no dot of its own on the globe. */
val HomeAirport: LonLat get() = AirportPref.home

private val sanne = Person("S", Color(0xFFD9A441))
private val joris = Person("J", Color(0xFF5B8DEF))
private val mark = Person("M", Color(0xFFE8613C))

/** Invented trips, the same kind as the demo account on the test server. */
val DemoUpcoming = Trip(
    id = "georgia",
    title = "Georgië 2026",
    month = "december", year = "2026", dates = "4 t/m 12 dec 2026", days = 8, km = null,
    color = Color(0xFF7DA7D9),
    route = listOf(44.79 to 41.72, 44.0 to 42.3, 42.7 to 42.25, 41.64 to 41.65),
    flights = listOf(HomeAirport to (44.95 to 41.67)),
    stops = listOf(
        Stop("Tbilisi", "🇬🇪", 44.79 to 41.72, 3, "4 t/m 7 dec"),
        Stop("Kazbegi", "🇬🇪", 44.64 to 42.66, 2, "7 t/m 9 dec"),
        Stop("Koetaisi", "🇬🇪", 42.7 to 42.25, 1, "9 t/m 10 dec", Mode.Bus),
        Stop("Batoemi", "🇬🇪", 41.64 to 41.65, 2, "10 t/m 12 dec", Mode.Train),
    ),
    outbound = Leg(Mode.Flight, "AMS", "TBS", 3020),
    back = Leg(Mode.Flight, "BUS", "AMS", 2890),
    upcoming = true,
    startsInDays = 34,
    people = listOf(mark, sanne),
    extraPeople = 2,
)

val DemoPast = listOf(
    Trip(
        "iceland", "IJsland rondom", "augustus", "2026", "7 t/m 26 aug 2026", 19, 6616, Color(0xFF2BB6A8),
        route = listOf(-21.94 to 64.15, -19.0 to 63.42, -15.2 to 64.25, -14.4 to 65.26, -18.1 to 65.68, -21.94 to 64.15),
        flights = listOf(HomeAirport to (-22.6 to 63.98), (-22.6 to 63.98) to HomeAirport),
        stops = listOf(
            Stop("Reykjavík", "🇮🇸", -21.94 to 64.15, 2, "7 t/m 9 aug"),
            Stop("Vík", "🇮🇸", -19.0 to 63.42, 2, "9 t/m 11 aug"),
            Stop("Höfn", "🇮🇸", -15.2 to 64.25, 3, "11 t/m 14 aug"),
            Stop("Egilsstaðir", "🇮🇸", -14.4 to 65.26, 2, "14 t/m 16 aug"),
            Stop("Akureyri", "🇮🇸", -18.1 to 65.68, 4, "16 t/m 20 aug"),
            Stop("Snæfellsnes", "🇮🇸", -23.6 to 64.85, 3, "20 t/m 23 aug"),
            Stop("Reykjavík", "🇮🇸", -21.94 to 64.15, 3, "23 t/m 26 aug"),
        ),
        people = listOf(mark, sanne, joris), extraPeople = 5,
        cover = Scene.Highlands, photos = 412,
        outbound = Leg(Mode.Flight, "AMS", "KEF", 2010), back = Leg(Mode.Flight, "KEF", "AMS", 2010),
    ),
    Trip(
        "sweden", "Zomer in Zweden", "juli", "2026", "4 t/m 22 jul 2026", 18, 2347, Color(0xFFD08A2A),
        route = listOf(HomeAirport, 8.6 to 53.1, 10.0 to 55.4, 12.6 to 55.7, 13.0 to 55.6, 15.6 to 56.2, 18.07 to 59.33, 17.1 to 61.3, 14.6 to 63.2),
        stops = listOf(
            Stop("Kopenhagen", "🇩🇰", 12.57 to 55.68, 2, "5 t/m 7 jul"),
            Stop("Kalmar", "🇸🇪", 16.36 to 56.66, 3, "7 t/m 10 jul"),
            Stop("Stockholm", "🇸🇪", 18.07 to 59.33, 4, "10 t/m 14 jul", Mode.Train),
            Stop("Östersund", "🇸🇪", 14.64 to 63.18, 7, "14 t/m 21 jul"),
        ),
        people = listOf(mark, joris), extraPeople = 2,
        cover = Scene.SunsetSea, photos = 288,
        outbound = Leg(Mode.Car, "Thuis", "Kopenhagen", 780), back = Leg(Mode.Car, "Östersund", "Thuis", 1650),
    ),
    Trip(
        "sicily", "Sicilië rond", "mei", "2026", "2 t/m 11 mei 2026", 9, 1243, Color(0xFFE8613C),
        route = listOf(13.36 to 38.12, 12.5 to 37.8, 13.6 to 37.3, 14.7 to 36.9, 15.09 to 37.5, 15.29 to 37.85),
        flights = listOf(HomeAirport to (13.09 to 38.18), (15.07 to 37.47) to HomeAirport),
        stops = listOf(
            Stop("Palermo", "🇮🇹", 13.36 to 38.12, 3, "2 t/m 5 mei"),
            Stop("Agrigento", "🇮🇹", 13.58 to 37.31, 2, "5 t/m 7 mei"),
            Stop("Noto", "🇮🇹", 15.07 to 36.89, 2, "7 t/m 9 mei"),
            Stop("Taormina", "🇮🇹", 15.29 to 37.85, 2, "9 t/m 11 mei"),
        ),
        cover = Scene.Coast, photos = 196,
        outbound = Leg(Mode.Flight, "AMS", "PMO", 1930), back = Leg(Mode.Flight, "CTA", "AMS", 2040),
    ),
    Trip(
        "lisbon", "Lissabon, lang weekend", "maart", "2026", "13 t/m 16 mrt 2026", 4, 312, Color(0xFFE34B8A),
        route = listOf(-9.14 to 38.72, -9.39 to 38.8, -9.42 to 38.69, -9.14 to 38.72),
        flights = listOf(HomeAirport to (-9.13 to 38.77), (-9.13 to 38.77) to HomeAirport),
        stops = listOf(Stop("Lissabon", "🇵🇹", -9.14 to 38.72, 3, "13 t/m 16 mrt")),
        cover = Scene.Coast, photos = 74,
    ),
    Trip(
        "marrakech", "Marrakech", "februari", "2026", "14 t/m 22 feb 2026", 8, 980, Color(0xFFC9772E),
        route = listOf(-7.99 to 31.63, -7.6 to 31.0, -6.9 to 30.92, -9.77 to 31.51, -7.99 to 31.63),
        flights = listOf(HomeAirport to (-8.03 to 31.61), (-8.03 to 31.61) to HomeAirport),
        stops = listOf(
            Stop("Marrakech", "🇲🇦", -7.99 to 31.63, 3, "14 t/m 17 feb"),
            Stop("Aït Benhaddou", "🇲🇦", -7.13 to 31.05, 1, "17 t/m 18 feb"),
            Stop("Essaouira", "🇲🇦", -9.77 to 31.51, 3, "18 t/m 21 feb"),
        ),
        cover = Scene.Desert, photos = 155,
    ),
    Trip(
        "norway", "Noorwegen tot de Lofoten", "juli", "2025", "5 t/m 17 jul 2025", 12, 2140, Color(0xFF7A5BD6),
        route = listOf(5.32 to 60.39, 6.1 to 61.2, 7.7 to 62.6, 10.4 to 63.43, 14.4 to 67.28, 13.9 to 68.2),
        flights = listOf(HomeAirport to (5.22 to 60.29), (14.37 to 67.27) to HomeAirport),
        stops = listOf(
            Stop("Bergen", "🇳🇴", 5.32 to 60.39, 2, "5 t/m 7 jul"),
            Stop("Geiranger", "🇳🇴", 7.2 to 62.1, 2, "7 t/m 9 jul", Mode.Boat),
            Stop("Trondheim", "🇳🇴", 10.4 to 63.43, 2, "9 t/m 11 jul"),
            Stop("Lofoten", "🇳🇴", 13.9 to 68.2, 6, "11 t/m 17 jul", Mode.Train),
        ),
        cover = Scene.Fjord, photos = 341,
        outbound = Leg(Mode.Flight, "AMS", "BGO", 960), back = Leg(Mode.Flight, "BOO", "AMS", 1690),
    ),
)

val DemoSharedCount = 2
