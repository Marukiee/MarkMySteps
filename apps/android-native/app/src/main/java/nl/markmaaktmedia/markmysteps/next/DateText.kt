package nl.markmaaktmedia.markmysteps.next

import java.time.DayOfWeek
import java.time.format.TextStyle
import java.util.Locale

/**
 * Short day and month names for what the screen shows, in the chosen language. Dutch keeps the exact short
 * forms the app always used ("mrt", "di"); English takes the usual ones ("Mar", "Tue").
 */
object DateText {
    private val dutchMonths = listOf("jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec")
    private val dutchDays = listOf("ma", "di", "wo", "do", "vr", "za", "zo")

    /** The short month name for a month number from 1 to 12. */
    fun month(m: Int): String = if (Lang.dutch) dutchMonths[m - 1] else java.time.Month.of(m).getDisplayName(TextStyle.SHORT, Locale.ENGLISH)

    private val dutchLong = listOf("januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december")

    /** A trip keeps its month as the Dutch long name ("juni"); this is that month in the chosen language. */
    fun longMonth(dutchName: String): String {
        val i = dutchLong.indexOf(dutchName)
        return if (i < 0 || Lang.dutch) dutchName else java.time.Month.of(i + 1).getDisplayName(TextStyle.FULL, Locale.ENGLISH)
    }

    /** The same, short: "jun", "Jun". */
    fun shortMonthOf(dutchName: String): String {
        val i = dutchLong.indexOf(dutchName)
        return if (i < 0) dutchName.take(3) else month(i + 1)
    }

    /** The short weekday name. */
    fun weekday(d: DayOfWeek): String = if (Lang.dutch) dutchDays[d.value - 1] else d.getDisplayName(TextStyle.SHORT, Locale.ENGLISH)

    /** The joiner of a range: "12 t/m 14 aug", "12 to 14 Aug". */
    val through: String get() = Lang.text(R.string.date_through)
}
