package nl.markmaaktmedia.markmysteps.next

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TripFiguresTest {
    private val es = "🇪🇸"
    private val ma = "🇲🇦"
    private val nl = "🇳🇱"
    private val none = "📍"

    private fun stop(name: String, flag: String, lat: Double, lon: Double, dayTrips: List<DayTrip> = emptyList()) =
        Stop(name = name, flag = flag, at = lon to lat, nights = 2, dates = "", dayTrips = dayTrips)

    private fun dayTrip(name: String, flag: String, lat: Double?, lon: Double?) =
        DayTrip(name, name, flag, if (lat == null || lon == null) null else lon to lat, null)

    @Test
    fun flagsReadAsCodes() {
        assertEquals("ma", TripFigures.codeOfFlag(ma))
        assertEquals("es", TripFigures.codeOfFlag("ES"))
        assertNull(TripFigures.codeOfFlag(none))
        assertNull(TripFigures.codeOfFlag(null))
        assertEquals("ma", flagCode(ma))
    }

    @Test
    fun aStopWithoutACountryIsNotASecondCountry() {
        assertEquals(1, TripFigures.countryCount(listOf(stop("Granada", es, 37.18, -3.6), stop("Somewhere", none, 37.0, -3.0))))
    }

    @Test
    fun homeDoesNotCountAsACountryVisited() {
        assertEquals(1, TripFigures.countryCount(listOf(stop("Utrecht", nl, 52.09, 5.12), stop("Granada", es, 37.18, -3.6))))
        assertEquals(0, TripFigures.countryCount(listOf(stop("Texel", nl, 53.05, 4.8))))
    }

    @Test
    fun aDayTripAbroadCountsItsCountry() {
        val tarifa = stop("Tarifa", es, 36.01, -5.6, listOf(dayTrip("Tanger", ma, 35.76, -5.83)))
        assertEquals(2, TripFigures.countryCount(listOf(tarifa)))
    }

    @Test
    fun countriesCountOncePerCode() {
        assertEquals(2, TripFigures.countryCountOfCodes(listOf("ES", "es", "MA", null, "", "NL", "nl")))
    }

    @Test
    fun booksNameEveryKnownCountryHomeIncluded() {
        assertEquals(2, TripFigures.namedCountries(listOf(stop("Utrecht", nl, 52.09, 5.12), stop("Granada", es, 37.18, -3.6), stop("?", none, 0.0, 0.0))))
    }

    @Test
    fun everyRouteStopCountsEvenACitySleptInTwice() {
        val granada = stop("Granada", es, 37.18, -3.6)
        assertEquals(3, TripFigures.stopPlaceCount(listOf(granada, stop("Sevilla", es, 37.39, -5.98), granada)))
    }

    @Test
    fun aDayTripCountsOncePerPlace() {
        val stockholm = { dayTrip("Stockholm", "🇸🇪", 59.329, 18.068) }
        val base = stop("Saltsjöbaden", "🇸🇪", 59.28, 18.31, listOf(stockholm(), stockholm(), stockholm()))
        assertEquals(2, TripFigures.stopPlaceCount(listOf(base)))
    }

    @Test
    fun nearbyPlacesStayTwoPlaces() {
        // Granada and Monachil are 8 km apart: two places, not one.
        val granada = stop("Granada", es, 37.18, -3.6, listOf(dayTrip("Monachil", es, 37.133, -3.537)))
        assertEquals(2, TripFigures.stopPlaceCount(listOf(granada)))
    }

    @Test
    fun aDayTripToARouteStopIsNotAnExtraPlace() {
        val sevilla = stop("Sevilla", es, 37.39, -5.98)
        val granada = stop("Granada", es, 37.18, -3.6, listOf(dayTrip("Sevilla", es, 37.39, -5.98)))
        assertEquals(2, TripFigures.stopPlaceCount(listOf(granada, sevilla)))
    }

    @Test
    fun aDayTripWithoutAPositionIsNotCounted() {
        assertEquals(1, TripFigures.stopPlaceCount(listOf(stop("Granada", es, 37.18, -3.6, listOf(dayTrip("?", es, null, null))))))
    }

    @Test
    fun factsFollowTheFixedOrderSkippingTheEmptyOnes() {
        val available = mapOf("days" to 12, "photos" to 380, "countries" to 1, "km" to 1240)
        assertEquals(listOf(1240, 12, 380, 1), TripFigures.pickFacts(available, null))
    }

    @Test
    fun theTripsOwnChoiceComesFirstThenIsToppedUp() {
        val available = mapOf("km" to 1, "days" to 2, "stops" to 3, "photos" to 4, "travellers" to 5, "countries" to 6)
        assertEquals(listOf(6, 5, 1, 2), TripFigures.pickFacts(available, listOf("countries", "travellers")))
        // A choice with nothing to say makes room for the next in the fixed order.
        assertEquals(listOf(4, 2, 3, 5), TripFigures.pickFacts(available - "km", listOf("km", "photos")))
        assertEquals(listOf(6, 1, 2), TripFigures.pickFacts(available, listOf("countries"), max = 3))
    }
}
