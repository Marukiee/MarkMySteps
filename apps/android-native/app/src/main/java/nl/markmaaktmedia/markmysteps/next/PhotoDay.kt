package nl.markmaaktmedia.markmysteps.next

import java.time.LocalDate

/*
 * The day a photo was taken, where it was taken, as the server, the web
 * (lib/photoDay.ts) and the iPhone decide it. takenAt is the moment in UTC,
 * and its date is the wrong day for a good part of the world: 05:30 in
 * Bangkok is 22:30 UTC the day before. The server also sends takenAtLocal,
 * the clock where the photo was taken written as if it were UTC (Immich's
 * localDateTime), so its date is the day you would call it there. A photo
 * synced before the server kept it has none until its next sync; its UTC date
 * stands in, as it always did.
 */
object PhotoDay {
    /** The day of a photo from the server's two fields; [takenAtLocal] null or blank when not known. */
    fun of(takenAt: String, takenAtLocal: String?): LocalDate = local(takenAtLocal) ?: LocalDate.parse(takenAt.take(10))

    /** The date of takenAtLocal, or null when the server does not know it (or sent something else). */
    fun local(takenAtLocal: String?): LocalDate? =
        takenAtLocal?.takeIf { it.length >= 10 && it != "null" }?.let { runCatching { LocalDate.parse(it.take(10)) }.getOrNull() }
}
