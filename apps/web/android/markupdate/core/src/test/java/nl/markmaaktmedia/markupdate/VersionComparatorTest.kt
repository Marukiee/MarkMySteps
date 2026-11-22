package nl.markmaaktmedia.markupdate

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VersionComparatorTest {
    @Test fun numbersAreComparedAsNumbersNotAsText() {
        assertTrue(VersionComparator.isNewer("1.10.0", "1.9.0"))
        assertFalse(VersionComparator.isNewer("1.9.0", "1.10.0"))
    }

    @Test fun aMissingPartCountsAsZero() {
        assertEquals(0, VersionComparator.compare("1.2", "1.2.0"))
        assertTrue(VersionComparator.isNewer("1.2.1", "1.2"))
    }

    @Test fun aPreReleaseIsOlderThanThePlainRelease() {
        assertTrue(VersionComparator.isNewer("1.0.0", "1.0.0-rc1"))
        assertFalse(VersionComparator.isNewer("1.0.0-rc1", "1.0.0"))
    }

    @Test fun aLeadingVIsIgnored() {
        assertEquals("0.1.1", VersionComparator.normalise("v0.1.1"))
        assertEquals(0, VersionComparator.compare("v2.0.0", "2.0.0"))
    }

    @Test fun aDebugBuildIsTheSameVersionAsItsRelease() {
        // Zonder dit zou 0.1.0-debug onder de release 0.1.0 staan en zag elke debug-build een update.
        assertEquals("0.1.0", VersionComparator.normaliseCurrent("0.1.0-debug"))
        assertFalse(VersionComparator.isNewer("0.1.0", VersionComparator.normaliseCurrent("0.1.0-debug")))
        assertTrue(VersionComparator.isNewer("0.1.1", VersionComparator.normaliseCurrent("0.1.0-debug")))
    }

    @Test fun otherSuffixesOfTheRunningAppStay() {
        assertEquals("1.0.0-rc1", VersionComparator.normaliseCurrent("1.0.0-rc1"))
    }
}
