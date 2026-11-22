package nl.markmaaktmedia.markupdate

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ReleaseParserTest {
    private val page = "https://github.com/o/r/releases"

    private fun json(assets: String, tag: String = "v0.2.0", extra: String = "") =
        """{"tag_name":"$tag","name":"","body":"- Something new","html_url":"https://github.com/o/r/releases/tag/$tag","published_at":"2026-11-21T10:00:00Z"$extra,"assets":[$assets]}"""

    private fun asset(name: String, url: String = "https://example.com/$name", size: Long = 1000) =
        """{"name":"$name","browser_download_url":"$url","size":$size}"""

    @Test fun picksTheNamedApkAndItsChecksum() {
        val release = parseRelease(json(asset("Keeper-v0.2.0.apk") + "," + asset("Keeper.apk", size = 22_000_000) + "," + asset("Keeper.apk.sha256")), "Keeper.apk", page)!!
        assertEquals("https://example.com/Keeper.apk", release.apkUrl)
        assertEquals(22_000_000L, release.apkSizeBytes)
        assertEquals("https://example.com/Keeper.apk.sha256", release.sha256Url)
        assertEquals("0.2.0", release.versionName)
        assertEquals("v0.2.0", release.title)
        assertEquals("- Something new", release.body)
    }

    @Test fun fallsBackToAnyApkWhenTheNamedOneIsMissing() {
        val release = parseRelease(json(asset("other-name.APK")), "Keeper.apk", page)!!
        assertEquals("https://example.com/other-name.APK", release.apkUrl)
        assertNull(release.sha256Url)
    }

    @Test fun aReleaseWithoutApkStillParsesButHasNoUrl() {
        val release = parseRelease(json(asset("notes.txt")), "Keeper.apk", page)!!
        assertNull(release.apkUrl)
        assertEquals(0L, release.apkSizeBytes)
    }

    @Test fun noTagMeansNoRelease() {
        assertNull(parseRelease(json("", tag = ""), "Keeper.apk", page))
    }

    @Test fun theReleasesPageIsUsedWhenThereIsNoHtmlUrl() {
        val release = parseRelease("""{"tag_name":"1.0.0","assets":[]}""", "Keeper.apk", page)!!
        assertEquals(page, release.htmlUrl)
    }
}
