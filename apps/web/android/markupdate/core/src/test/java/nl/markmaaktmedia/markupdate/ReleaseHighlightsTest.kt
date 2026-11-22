package nl.markmaaktmedia.markupdate

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReleaseHighlightsTest {
    private val both = """
        ## What's new (English)

        First release.

        - **Gallery** of your photos
        - Smaller files in `Pictures/Keeper`
        - A third point

        ## Wat is nieuw (Nederlands)

        Eerste versie.

        - **Galerij** van je foto's
        - Kleinere bestanden
    """.trimIndent()

    @Test fun takesTheFirstTwoPointsInEnglishWithoutMarkdown() {
        assertEquals(listOf("Gallery of your photos", "Smaller files in Pictures/Keeper"), releaseHighlights(both, dutch = false))
    }

    @Test fun takesTheDutchPartWhenTheAppIsDutch() {
        assertEquals(listOf("Galerij van je foto's", "Kleinere bestanden"), releaseHighlights(both, dutch = true))
    }

    @Test fun fallsBackToEnglishWhenThereIsNoDutchPart() {
        val english = both.substringBefore("## Wat is nieuw")
        assertEquals(listOf("Gallery of your photos", "Smaller files in Pictures/Keeper"), releaseHighlights(english, dutch = true))
    }

    @Test fun plainCommitLinesWithoutSectionsAreTheLines() {
        assertEquals(listOf("Eerste", "Tweede"), releaseHighlights("- Eerste\n- Tweede\n- Derde", dutch = false))
    }

    @Test fun withoutPointsTheFirstPlainLinesCount() {
        assertEquals(listOf("Een regel.", "Nog een."), releaseHighlights("Een regel.\n\nNog een.\n\nEn nog een.", dutch = false))
    }

    @Test fun theFileTableAndWhatIsBelowTheRuleAreLeftOut() {
        val body = "## Which file do I need?\n\n| File | For |\n| a | b |\n\n## What's new (English)\n\n- One\n\n---\n\n- Below the rule"
        assertEquals(listOf("One"), releaseHighlights(body, dutch = false))
    }

    @Test fun linksShowTheirText() {
        assertEquals(listOf("See the notes"), releaseHighlights("- See [the notes](https://example.com/x)", dutch = false))
    }

    @Test fun anEmptyBodyHasNoLines() {
        assertTrue(releaseHighlights("", dutch = false).isEmpty())
    }

    @Test fun maxLimitsTheNumberOfLines() {
        assertEquals(1, releaseHighlights(both, dutch = false, max = 1).size)
    }
}
