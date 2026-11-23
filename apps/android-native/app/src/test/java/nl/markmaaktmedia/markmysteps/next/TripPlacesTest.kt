package nl.markmaaktmedia.markmysteps.next

import androidx.compose.ui.graphics.Color
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The places row: each place wears a photo taken there, chosen by location; a chosen cover always wins. */
class TripPlacesTest {
    private val es = "🇪🇸"
    private val day = LocalDate.of(2026, 8, 25)
    private val granada = 37.1773 to -3.5986
    private val monachil = 37.1333 to -3.5375 // about 7 km from Granada's centre

    private fun photo(id: String, at: Pair<Double, Double>?, d: LocalDate = day) =
        Media(id = id, takenAt = d, video = false, ratio = 1f, lat = at?.first, lon = at?.second)

    private fun trip(cover: String? = null, dayTripCover: String? = null) = Trip(
        id = "t", title = "Afrikatrip", month = "", year = "", dates = "", days = 19, km = null, color = Color.Red, route = emptyList(),
        stops = listOf(
            Stop(
                name = "Granada", flag = es, at = granada.second to granada.first, nights = 2, dates = "", start = day, id = "g", cover = cover,
                dayTrips = listOf(DayTrip("m", "Monachil", es, monachil.second to monachil.first, day, cover = dayTripCover)),
            ),
        ),
    )

    private fun tiles(t: Trip, media: List<Media>) = TripPlaces.stops(t, media) { t.stops.first() }

    @Test
    fun twoPlacesCloseTogetherEachWearTheirOwnPhoto() {
        // The first photo of the day was taken in Monachil, within 8 km of Granada too: it used to be on both tiles.
        val media = listOf(photo("monachil-road", 37.1340 to -3.5380), photo("granada-centre", 37.1765 to -3.5990), photo("monachil-2", 37.1320 to -3.5360))
        val t = tiles(trip(), media).associateBy { it.name }
        assertEquals("granada-centre", t.getValue("Granada").photos.first().id)
        assertEquals("monachil-road", t.getValue("Monachil").photos.first().id)
        assertNotEquals(t.getValue("Granada").photos.first().id, t.getValue("Monachil").photos.first().id)
        assertTrue(t.getValue("Granada").photos.none { it.id.startsWith("monachil") })
    }

    @Test
    fun theOneClosestToTheHeartWins() {
        val media = listOf(photo("edge", 37.20 to -3.63), photo("heart", 37.1772 to -3.5985))
        assertEquals("heart", tiles(trip(), media).first { it.name == "Granada" }.photos.first().id)
    }

    @Test
    fun aChosenCoverAlwaysWins() {
        val media = listOf(photo("heart", 37.1772 to -3.5985), photo("picked", 37.19 to -3.61), photo("m", 37.1333 to -3.5375))
        val t = tiles(trip(cover = "picked", dayTripCover = "heart"), media).associateBy { it.name }
        assertEquals("picked", t.getValue("Granada").photos.first().id)
        assertEquals("heart", t.getValue("Monachil").photos.first().id)
    }

    @Test
    fun aCoverThatIsGoneFallsBackToTheAutomaticOne() {
        val media = listOf(photo("heart", 37.1772 to -3.5985))
        assertEquals("heart", tiles(trip(cover = "deleted"), media).first { it.name == "Granada" }.photos.first().id)
    }

    @Test
    fun aDayTripWithoutAPhotoTakenThereHasNoTile() {
        val media = listOf(photo("heart", 37.1772 to -3.5985))
        assertTrue(tiles(trip(), media).none { it.name == "Monachil" })
    }

    @Test
    fun photosWithoutALocationStillGoByTheDay() {
        val media = listOf(photo("nowhere", null))
        assertEquals("nowhere", tiles(trip(), media).first { it.name == "Granada" }.photos.first().id)
    }
}
