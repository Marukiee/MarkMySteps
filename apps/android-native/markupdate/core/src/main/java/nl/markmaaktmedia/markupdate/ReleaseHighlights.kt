package nl.markmaaktmedia.markupdate

/**
 * De regels voor de kaart van [this] release: die uit `changelog.json` in de taal van de telefoon (Nederlands of Engels; heeft het bestand
 * die taal niet, dan de Engelse), en lukt dat niet, dan de punten uit de releasetekst ([releaseHighlights]).
 */
fun ReleaseInfo.highlights(dutch: Boolean, max: Int = 2): List<String> {
    val fromChangelog = (notes[if (dutch) "nl" else "en"]?.takeIf { it.isNotEmpty() } ?: notes["en"]).orEmpty()
    return fromChangelog.take(max).ifEmpty { releaseHighlights(body, dutch, max) }
}

/**
 * De korte regels voor op de updatekaart: de eerste punten van wat er nieuw is, in de taal van de app als de release die heeft.
 *
 * De tekst van een release heeft een deel per taal ("## What's new (English)" en "## Wat is nieuw (Nederlands)"), een tabel met bestanden
 * ("## Which file ...") en onderaan een streep. Alleen het deel in de taal van de app telt; heeft de release dat niet, dan het Engelse, en
 * een tekst zonder delen (alleen commitregels, bijvoorbeeld) telt als één Engels deel. Zijn er punten ("- ..."), dan zijn dat de regels;
 * anders de eerste gewone regels. Hooguit [max], zonder Markdown.
 */
fun releaseHighlights(body: String, dutch: Boolean, max: Int = 2): List<String> {
    class Section(val dutch: Boolean) { val lines = mutableListOf<String>() }

    val sections = mutableListOf<Section>()
    // Tekst voor de eerste kop hoort bij een deel zonder taal; het telt als Engels.
    var current: Section? = Section(false).also { sections += it }
    for (raw in body.lines()) {
        val line = raw.trim()
        if (line == "---") break
        if (line.startsWith("## ")) {
            val skip = line.startsWith("## Which file") || line.startsWith("## Welk bestand")
            current = if (skip) null else Section(line.endsWith("(Nederlands)")).also { sections += it }
            continue
        }
        current?.lines?.add(line)
    }
    val section = sections.firstOrNull { it.dutch == dutch && it.lines.any(String::isNotEmpty) }
        ?: sections.firstOrNull { !it.dutch && it.lines.any(String::isNotEmpty) }
        ?: return emptyList()

    fun plain(line: String): String = line
        .replace(Regex("\\[([^\\]]*)]\\([^)]*\\)"), "$1")
        .replace("**", "").replace("`", "")
        .trim()

    val bullets = section.lines.filter { it.startsWith("- ") || it.startsWith("* ") }.map { plain(it.drop(2)) }
    val texts = section.lines.filter { it.isNotEmpty() && !it.startsWith("|") && !it.startsWith(">") }.map(::plain)
    return bullets.ifEmpty { texts }.filter { it.isNotEmpty() }.take(max)
}
