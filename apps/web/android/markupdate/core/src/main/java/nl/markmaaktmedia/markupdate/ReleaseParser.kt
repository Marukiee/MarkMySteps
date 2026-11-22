package nl.markmaaktmedia.markupdate

import org.json.JSONObject

/**
 * Leest het antwoord van `GET /repos/{owner}/{repo}/releases/latest`. Null als er geen tag in zit.
 *
 * Het appbestand is de asset met de naam [apkAsset]; heeft de release die niet, dan de eerste die op .apk eindigt. De controlesom staat
 * in de asset `[apkAsset].sha256` (een bestand met de som en de bestandsnaam, zoals `sha256sum` het schrijft).
 */
internal fun parseRelease(json: String, apkAsset: String, releasesPage: String): ReleaseInfo? {
    val root = JSONObject(json)
    val tag = root.optString("tag_name")
    if (tag.isBlank()) return null
    val assets = root.optJSONArray("assets")
    var apk: JSONObject? = null
    var sha: String? = null
    for (i in 0 until (assets?.length() ?: 0)) {
        val asset = assets!!.getJSONObject(i)
        val name = asset.optString("name")
        if (name == apkAsset) apk = asset
        if (name == "$apkAsset.sha256") sha = asset.optString("browser_download_url")
    }
    if (apk == null) {
        for (i in 0 until (assets?.length() ?: 0)) {
            val asset = assets!!.getJSONObject(i)
            if (asset.optString("name").endsWith(".apk", ignoreCase = true)) { apk = asset; break }
        }
    }
    return ReleaseInfo(
        tag = tag,
        versionName = VersionComparator.normalise(tag),
        title = root.optString("name").ifBlank { tag },
        body = root.optString("body"),
        apkUrl = apk?.optString("browser_download_url"),
        apkSizeBytes = apk?.optLong("size") ?: 0L,
        sha256Url = sha,
        htmlUrl = root.optString("html_url").ifBlank { releasesPage },
        publishedAt = root.optString("published_at"),
    )
}
