package nl.markmaaktmedia.markupdate

import org.json.JSONArray

/**
 * Wat `changelog.json` zegt dat nieuw is in [version], per taal ("en", "nl"): eerst wat nieuw is (`new`), dan wat beter werd (`better`), dan
 * wat gerepareerd is (`fixed`), hooguit [max] regels. Leeg als het bestand de versie niet kent of niet te lezen is.
 *
 * Het bestand is een lijst met nieuwste versie bovenaan:
 * `[{"version": "0.1.30", "en": {"new": ["..."], "better": [...], "fixed": [...]}, "nl": {...}}, ...]`
 */
internal fun parseChangelogNotes(json: String, version: String, max: Int = 2): Map<String, List<String>> = runCatching {
    val array = JSONArray(json)
    val entry = (0 until array.length()).map { array.getJSONObject(it) }.firstOrNull { it.optString("version") == version }
        ?: return@runCatching emptyMap<String, List<String>>()
    listOf("en", "nl").mapNotNull { language ->
        val text = entry.optJSONObject(language) ?: return@mapNotNull null
        val lines = listOf("new", "better", "fixed").flatMap { key ->
            text.optJSONArray(key)?.let { list -> (0 until list.length()).map { list.getString(it).trim() } }.orEmpty()
        }.filter { it.isNotEmpty() }
        (language to lines.take(max)).takeIf { lines.isNotEmpty() }
    }.toMap()
}.getOrDefault(emptyMap())
