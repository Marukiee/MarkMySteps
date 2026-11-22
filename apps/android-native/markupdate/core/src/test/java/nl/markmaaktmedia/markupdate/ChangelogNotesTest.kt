package nl.markmaaktmedia.markupdate

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ChangelogNotesTest {
    private val json = """
        [
          {
            "version": "0.1.30", "date": "2026-11-21",
            "en": {"title": "New update card", "new": ["A new version shows as a card", "It installs itself"], "better": ["Smoother"], "fixed": ["No crash"]},
            "nl": {"title": "Nieuwe updatekaart", "new": ["Een nieuwe versie staat als kaart"], "fixed": ["Geen crash"]}
          },
          {
            "version": "0.1.29",
            "en": {"title": "Cards stay open", "better": ["An opened card stays"], "fixed": ["Typing no longer closes it"]}
          }
        ]
    """.trimIndent()

    @Test fun `new comes first, then better, then fixed, two lines at most`() {
        val notes = parseChangelogNotes(json, "0.1.30")
        assertEquals(listOf("A new version shows as a card", "It installs itself"), notes["en"])
        assertEquals(listOf("Een nieuwe versie staat als kaart", "Geen crash"), notes["nl"])
    }

    @Test fun `a version without a language has no lines for it`() {
        val notes = parseChangelogNotes(json, "0.1.29")
        assertEquals(listOf("An opened card stays", "Typing no longer closes it"), notes["en"])
        assertTrue("nl" !in notes)
    }

    @Test fun `unknown version, broken json and an empty file give nothing`() {
        assertTrue(parseChangelogNotes(json, "9.9.9").isEmpty())
        assertTrue(parseChangelogNotes("not json", "0.1.30").isEmpty())
        assertTrue(parseChangelogNotes("", "0.1.30").isEmpty())
        assertTrue(parseChangelogNotes("{}", "0.1.30").isEmpty())
    }

    @Test fun `max limits the lines`() {
        assertEquals(listOf("A new version shows as a card"), parseChangelogNotes(json, "0.1.30", max = 1)["en"])
    }

    private fun release(notes: Map<String, List<String>>, body: String = "## What's new (English)\n\n- From body\n- Second body") = ReleaseInfo(
        tag = "v0.1.30", versionName = "0.1.30", title = "t", body = body, apkUrl = null, apkSizeBytes = 0, sha256Url = null, htmlUrl = "", publishedAt = "", notes = notes,
    )

    @Test fun `highlights use the changelog in the language of the phone`() {
        val r = release(mapOf("en" to listOf("EN one"), "nl" to listOf("NL een")))
        assertEquals(listOf("NL een"), r.highlights(dutch = true))
        assertEquals(listOf("EN one"), r.highlights(dutch = false))
    }

    @Test fun `a dutch phone gets the english changelog when the file has no dutch`() {
        assertEquals(listOf("EN one"), release(mapOf("en" to listOf("EN one"))).highlights(dutch = true))
    }

    @Test fun `without a changelog the release text is used`() {
        assertEquals(listOf("From body", "Second body"), release(emptyMap()).highlights(dutch = false))
        assertEquals(listOf("From body", "Second body"), release(mapOf("nl" to emptyList())).highlights(dutch = false))
    }
}
