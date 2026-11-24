package nl.markmaaktmedia.markmysteps.next

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant
import java.time.LocalDate

class PhotoDayTest {
    @Test
    fun aBangkokMorningLandsOnTheBangkokDay() {
        // 05:30 in Bangkok is 22:30 UTC the day before.
        assertEquals(LocalDate.of(2026, 4, 2), PhotoDay.of("2026-04-01T22:30:00.000Z", "2026-04-02T05:30:00.000Z"))
    }

    @Test
    fun aNewYorkEveningLandsOnTheNewYorkDay() {
        assertEquals(LocalDate.of(2026, 7, 4), PhotoDay.of("2026-07-05T00:00:00.000Z", "2026-07-04T20:00:00.000Z"))
    }

    @Test
    fun withoutALocalTimeTheUtcDateStandsIn() {
        assertEquals(LocalDate.of(2026, 4, 1), PhotoDay.of("2026-04-01T22:30:00.000Z", null))
        assertEquals(LocalDate.of(2026, 4, 1), PhotoDay.of("2026-04-01T22:30:00.000Z", ""))
        // org.json gives "null" for a JSON null read as a string.
        assertEquals(LocalDate.of(2026, 4, 1), PhotoDay.of("2026-04-01T22:30:00.000Z", "null"))
        assertNull(PhotoDay.local("not a date"))
    }

    @Test
    fun theBookUsesTheServersDayWhenItHasOne() {
        val photo = TripPhoto(
            id = "p", takenAt = Instant.parse("2026-04-01T22:30:00Z"), aspect = 1f,
            localDay = LocalDate.of(2026, 4, 2),
        )
        assertEquals(LocalDate.of(2026, 4, 2), photo.day(emptyList()))
    }

    @Test
    fun withoutTheServersDayTheBookWorksItOutAsBefore() {
        val at = Instant.parse("2026-04-01T22:30:00Z")
        val photo = TripPhoto(id = "p", takenAt = at, aspect = 1f)
        assertEquals(at.atZone(java.time.ZoneId.systemDefault()).toLocalDate(), photo.day(emptyList()))
    }

    @Test
    fun photosOfOneDayStandInTheOrderTheyWereTaken() {
        fun media(id: String, at: String, local: String?) =
            Media(id = id, takenAt = PhotoDay.of(at, local), video = false, ratio = 1f, at = Instant.parse(at).toEpochMilli())
        // Bangkok, all on 2 April there: the 05:30 shot (still 1 April in UTC) comes first.
        val list = listOf(
            media("noon", "2026-04-02T05:00:00Z", "2026-04-02T12:00:00Z"),
            media("dawn", "2026-04-01T22:30:00Z", "2026-04-02T05:30:00Z"),
        )
        assertEquals(listOf("dawn", "noon"), list.inTakenOrder().map { it.id })
        assertEquals(setOf(LocalDate.of(2026, 4, 2)), list.map { it.takenAt }.toSet())
    }
}
