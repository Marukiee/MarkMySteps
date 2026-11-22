package nl.markmaaktmedia.markupdate

/** Een release zoals GitHub hem publiceert, teruggebracht tot wat de kaart nodig heeft. */
data class ReleaseInfo(
    val tag: String,
    val versionName: String,
    val title: String,
    /** De hele tekst van de release; [releaseHighlights] haalt er de korte regels voor de kaart uit. */
    val body: String,
    val apkUrl: String?,
    val apkSizeBytes: Long,
    val sha256Url: String?,
    val htmlUrl: String,
    val publishedAt: String,
    /**
     * De korte regels uit `changelog.json` op de tag van deze release, per taal ("en", "nl"); leeg als de app dat bestand niet heeft of
     * het niet te lezen was. [highlights] kiest daaruit en valt anders terug op [body].
     */
    val notes: Map<String, List<String>> = emptyMap(),
)

/** Waar het updaten nu is. Stuurt de kaart en de update-rij in de instellingen. */
sealed interface UpdateState {
    data object Idle : UpdateState
    data object Checking : UpdateState
    data object UpToDate : UpdateState
    data class Available(val release: ReleaseInfo) : UpdateState
    data class Downloading(val release: ReleaseInfo, val progress: Float) : UpdateState
    data class ReadyToInstall(val release: ReleaseInfo, val filePath: String) : UpdateState

    /** De download wacht op de schakelaar "onbekende apps installeren"; hij gaat door als de gebruiker terugkomt. */
    data class NeedsPermission(val release: ReleaseInfo, val filePath: String? = null) : UpdateState

    /** Aan de installer gegeven, die bezig is of zelf een vraag toont. */
    data class Installing(val release: ReleaseInfo) : UpdateState

    /**
     * De installer wacht op een tik en Android liet hem niet vragen: de app stond niet voorin. De kaart heeft dan de knop en er
     * staat een melding; komt de app naar voren, dan opent de vraag vanzelf.
     */
    data class AwaitingConfirmation(val release: ReleaseInfo) : UpdateState

    /** [release] is gezet als opnieuw proberen kan doorgaan waar het stopte, zonder GitHub opnieuw te vragen. */
    data class Failed(val reason: String, val release: ReleaseInfo? = null) : UpdateState
}

/**
 * Vergelijkt twee versienamen zoals een mens ze leest, zodat "1.10.0" boven "1.9.0" staat. Wat na de cijfers komt (een "-rc1")
 * telt als ouder dan de gewone release met dezelfde cijfers.
 */
object VersionComparator {

    fun isNewer(candidate: String, current: String): Boolean = compare(candidate, current) > 0

    fun compare(left: String, right: String): Int {
        val leftParts = numericParts(left)
        val rightParts = numericParts(right)
        val size = maxOf(leftParts.size, rightParts.size)
        for (index in 0 until size) {
            val a = leftParts.getOrElse(index) { 0 }
            val b = rightParts.getOrElse(index) { 0 }
            if (a != b) return a.compareTo(b)
        }
        val leftSuffix = suffix(left)
        val rightSuffix = suffix(right)
        return when {
            leftSuffix == rightSuffix -> 0
            leftSuffix.isEmpty() -> 1
            rightSuffix.isEmpty() -> -1
            else -> leftSuffix.compareTo(rightSuffix)
        }
    }

    fun normalise(raw: String): String = raw.trim().removePrefix("v").removePrefix("V")

    /**
     * De versie van de draaiende app. Een debug-build heet "0.1.0-debug"; zonder het achtervoegsel zou de vergelijking hem onder de
     * release van 0.1.0 zetten en zag elke debug-build een update. Daarom hier en niet in elke app.
     */
    fun normaliseCurrent(raw: String): String = normalise(raw.trim().removeSuffix("-debug"))

    private fun numericParts(raw: String): List<Int> =
        normalise(raw).substringBefore('-').split('.').map { part -> part.takeWhile(Char::isDigit).toIntOrNull() ?: 0 }

    private fun suffix(raw: String): String = normalise(raw).substringAfter('-', "").lowercase()
}
