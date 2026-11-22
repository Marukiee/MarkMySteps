package nl.markmaaktmedia.markmysteps.next

import org.json.JSONArray
import org.json.JSONObject

/**
 * The calls behind the settings and the trip settings, the same endpoints and bodies the web app uses
 * (apps/api/src: users, auth/2fa, immich, admin, import, tracking, trips). Every write goes through
 * [Api.send] or [Api.upload], so test mode stops it on the phone. In test mode a write answers "{}", so
 * nothing here trusts a field to be there: a missing one reads as empty.
 */
object SettingsRemote {
    /** The signed-in account with what the settings need beyond [Remote.Me]: the e-mail and the role. */
    data class Account(val id: String, val email: String, val username: String, val displayName: String, val admin: Boolean, val hasAvatar: Boolean)

    suspend fun account(): Account = JSONObject(Api.get("/api/users/me")).let {
        Account(it.optString("id"), it.optString("email"), it.optString("username"), it.optString("displayName"), it.optString("role") == "ADMIN", it.optBoolean("hasAvatar"))
    }.also { Api.remember("admin", if (it.admin) "1" else "0") }

    /** A trip's settings as the cached trip list holds them, so the page opens complete before the server answers. */
    fun cachedTrip(id: String): TripInfo? = runCatching {
        val a = JSONArray(Api.recall("trips") ?: return null)
        (0 until a.length()).map { a.getJSONObject(it) }.firstOrNull { it.optString("id") == id }?.let {
            TripInfo(
                it.optString("id"), it.optString("title"), it.optString("startDate").take(10), it.optString("endDate").take(10), it.optBoolean("autoTrack"),
                it.str("color"), it.optString("ownerId"), it.dbl("markerLng"), it.dbl("markerLat"), it.str("resolvedCoverId"),
            )
        }
    }.getOrNull()

    /** PATCH /users/me: the name always, the username when it is meant to change. */
    suspend fun saveProfile(displayName: String, username: String?): String? {
        val body = JSONObject().put("displayName", displayName.trim())
        if (username != null) body.put("username", username.trim())
        return JSONObject(Api.send("PATCH", "/api/users/me", body)).optString("username").takeIf { it.isNotBlank() }
    }

    /** Null when the server could not say (a server from before the check). */
    suspend fun usernameFree(name: String): Boolean? = runCatching {
        JSONObject(Api.get("/api/users/username-available?name=" + java.net.URLEncoder.encode(name, "UTF-8"))).getBoolean("available")
    }.getOrNull()

    suspend fun changePassword(current: String, new: String) {
        Api.send("POST", "/api/users/me/password", JSONObject().put("currentPassword", current).put("newPassword", new))
    }

    suspend fun uploadAvatar(jpeg: ByteArray) { Api.upload("/api/users/me/avatar", "file", "avatar.jpg", "image/jpeg", jpeg) }
    suspend fun removeAvatar() { Api.send("DELETE", "/api/users/me/avatar") }

    // Two-step verification.
    data class TwoFactor(val enabled: Boolean, val codesLeft: Int)
    data class Setup(val secret: String, val uri: String)

    suspend fun twoFactor(): TwoFactor = JSONObject(Api.get("/api/auth/2fa")).let { TwoFactor(it.optBoolean("enabled"), it.optInt("recoveryCodesLeft")) }
        .also { Api.remember("2fa", "${it.enabled},${it.codesLeft}") }

    fun cachedTwoFactor(): TwoFactor? = Api.recall("2fa")?.split(',')?.takeIf { it.size == 2 }?.let { TwoFactor(it[0] == "true", it[1].toIntOrNull() ?: 0) }

    /** Null when the answer holds no secret (as in test mode). */
    suspend fun twoFactorSetup(password: String): Setup? =
        JSONObject(Api.send("POST", "/api/auth/2fa/setup", JSONObject().put("password", password))).let { o ->
            val secret = o.optString("secret"); val uri = o.optString("otpauthUri")
            if (secret.isBlank() || uri.isBlank()) null else Setup(secret, uri)
        }

    suspend fun twoFactorEnable(code: String): List<String> =
        codes(JSONObject(Api.send("POST", "/api/auth/2fa/enable", JSONObject().put("code", code.filter { !it.isWhitespace() }))))

    suspend fun twoFactorDisable(password: String, code: String) {
        Api.send("POST", "/api/auth/2fa/disable", JSONObject().put("password", password).put("code", code.trim()))
    }

    suspend fun twoFactorNewCodes(password: String, code: String): List<String> =
        codes(JSONObject(Api.send("POST", "/api/auth/2fa/recovery-codes", JSONObject().put("password", password).put("code", code.trim()))))

    private fun codes(o: JSONObject): List<String> = o.optJSONArray("recoveryCodes")?.let { a -> (0 until a.length()).map { a.getString(it) } }.orEmpty()

    // Immich.
    data class Immich(val serverUrl: String, val publicUrl: String?, val keyPreview: String, val lastSync: String?, val lastError: String?)

    /** Null when not connected (the server answers 404). */
    suspend fun immich(): Immich? = try {
        val raw = Api.get("/api/immich/connection")
        Api.remember("immich", raw)
        parseImmich(JSONObject(raw))
    } catch (e: Api.Failure) {
        if (e.status == 404) { Api.remember("immich", "{}"); null } else throw e
    }

    private fun parseImmich(o: JSONObject): Immich? = o.optString("serverUrl").takeIf { it.isNotBlank() }?.let {
        Immich(it, o.str("publicUrl"), o.optString("apiKeyPreview"), o.str("lastSyncAt"), o.str("lastSyncError"))
    }

    /** The last answer, so the panel opens complete; null inside means "not connected", no cache at all means unknown. */
    fun cachedImmich(): Pair<Immich?, Boolean> = Api.recall("immich")?.let { runCatching { parseImmich(JSONObject(it)) to true }.getOrNull() } ?: (null to false)

    /** Whether the signed-in account was an admin when last asked, so the Accounts row is there at once. */
    fun cachedAdmin(): Boolean = Api.recall("admin") == "1"

    suspend fun connectImmich(serverUrl: String, apiKey: String, publicUrl: String?): Immich? {
        val body = JSONObject().put("serverUrl", serverUrl.trim()).put("apiKey", apiKey.trim())
        if (!publicUrl.isNullOrBlank()) body.put("publicUrl", publicUrl.trim())
        val o = JSONObject(Api.send("PUT", "/api/immich/connection", body))
        return o.optString("serverUrl").takeIf { it.isNotBlank() }?.let { Immich(it, o.str("publicUrl"), o.optString("apiKeyPreview"), o.str("lastSyncAt"), o.str("lastSyncError")) }
    }

    suspend fun disconnectImmich() { Api.send("DELETE", "/api/immich/connection") }

    // Accounts on this server (admins only).
    data class AdminUser(
        val id: String, val email: String, val username: String, val displayName: String, val admin: Boolean,
        val status: String, val tempPassword: Boolean, val createdAt: String, val trips: Int, val twoFactor: Boolean,
    )

    suspend fun adminUsers(): List<AdminUser> {
        val a = JSONArray(Api.get("/api/admin/users"))
        return (0 until a.length()).map { a.getJSONObject(it) }.map {
            AdminUser(
                it.optString("id"), it.optString("email"), it.optString("username"), it.optString("displayName"), it.optString("role") == "ADMIN",
                it.optString("status"), it.optBoolean("mustChangePassword"), it.optString("createdAt"), it.optInt("tripCount"), it.optBoolean("twoFactor"),
            )
        }
    }

    suspend fun createUser(email: String, username: String, displayName: String, tempPassword: String) {
        Api.send("POST", "/api/admin/users", JSONObject().put("email", email.trim()).put("username", username.trim()).put("displayName", displayName.trim()).put("tempPassword", tempPassword))
    }
    suspend fun decide(id: String, approve: Boolean) { Api.send("POST", "/api/admin/users/$id/${if (approve) "approve" else "reject"}") }
    suspend fun resetPassword(id: String, temp: String) { Api.send("POST", "/api/admin/users/$id/reset-password", JSONObject().put("tempPassword", temp)) }
    suspend fun resetTwoFactor(id: String) { Api.send("POST", "/api/admin/users/$id/reset-2fa") }
    suspend fun setRole(id: String, admin: Boolean) { Api.send("POST", "/api/admin/users/$id/role", JSONObject().put("role", if (admin) "ADMIN" else "USER")) }
    suspend fun deleteUser(id: String) { Api.send("DELETE", "/api/admin/users/$id") }

    // Data.
    data class Imported(val title: String, val start: String, val end: String, val points: Int)

    suspend fun importPolarsteps(zip: ByteArray): List<Imported> {
        val raw = Api.upload("/api/import/polarsteps", "file", "polarsteps.zip", "application/zip", zip)
        val a = runCatching { JSONArray(raw) }.getOrNull() ?: return emptyList()
        return (0 until a.length()).map { a.getJSONObject(it) }.map { Imported(it.optString("title"), it.optString("startDate"), it.optString("endDate"), it.optInt("pointsImported")) }
    }

    data class TrackImport(val found: Int, val added: Int, val outside: Int, val undated: Int)

    suspend fun importTrack(tripId: String, filename: String, data: ByteArray): TrackImport {
        val mime = if (filename.endsWith(".kml", true)) "application/vnd.google-earth.kml+xml" else "application/gpx+xml"
        val o = JSONObject(Api.upload("/api/trips/$tripId/import-track", "file", filename, mime, data))
        return TrackImport(o.optInt("found"), o.optInt("added"), o.optInt("outsideTrip"), o.optInt("undated"))
    }

    suspend fun exportTrack(tripId: String, format: String): ByteArray? = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { Api.bytes("/api/trips/$tripId/export/$format") }

    /** The raw trip list, for the pickers and the backup. */
    suspend fun tripsRaw(): JSONArray = JSONArray(Api.get("/api/trips"))

    /** Everything of one trip a backup holds, as the web's createBackup reads it. */
    suspend fun tripParts(id: String): JSONObject {
        suspend fun arr(path: String) = try { JSONArray(Api.get(path)) } catch (_: Exception) { JSONArray() }
        return JSONObject()
            .put("stops", arr("/api/trips/$id/stops")).put("media", arr("/api/trips/$id/media"))
            .put("notes", arr("/api/trips/$id/notes")).put("points", arr("/api/trips/$id/points"))
    }

    // A trip's own settings.
    data class TripInfo(
        val id: String, val title: String, val start: String, val end: String, val autoTrack: Boolean, val color: String?,
        val ownerId: String, val markerLng: Double?, val markerLat: Double?, val coverId: String?,
    )

    suspend fun trip(id: String): TripInfo = JSONObject(Api.get("/api/trips/$id")).let {
        TripInfo(
            it.optString("id"), it.optString("title"), it.optString("startDate").take(10), it.optString("endDate").take(10), it.optBoolean("autoTrack"),
            it.str("color"), it.optString("ownerId"), it.dbl("markerLng"), it.dbl("markerLat"), it.str("resolvedCoverId"),
        )
    }

    suspend fun saveTrip(id: String, title: String, start: String, end: String, autoTrack: Boolean) {
        Api.send("PATCH", "/api/trips/$id", JSONObject().put("title", title.trim()).put("startDate", start).put("endDate", end).put("autoTrack", autoTrack))
    }

    suspend fun setColor(id: String, hex: String?) { Api.send("PATCH", "/api/trips/$id", JSONObject().put("color", hex ?: JSONObject.NULL)) }

    suspend fun setMarker(id: String, lngLat: Pair<Double, Double>?) {
        Api.send("PATCH", "/api/trips/$id", JSONObject().put("markerLng", lngLat?.first ?: JSONObject.NULL).put("markerLat", lngLat?.second ?: JSONObject.NULL))
    }

    data class Sync(val users: Int, val found: Int, val added: Int)

    suspend fun sync(id: String): Sync = JSONObject(Api.send("POST", "/api/trips/$id/sync")).let { Sync(it.optInt("usersSynced"), it.optInt("assetsFound"), it.optInt("assetsAdded")) }

    /** Your own tracked points, all or one day (yyyy-MM-dd); answers how many went. */
    suspend fun wipeTracked(id: String, day: String?): Int =
        JSONObject(Api.send("DELETE", "/api/trips/$id/tracked" + (day?.let { "?day=$it" } ?: ""))).optInt("deleted")

    suspend fun wipeRouteFills(id: String): Int = JSONObject(Api.send("DELETE", "/api/trips/$id/route-fill")).optInt("deleted")

    data class TripStats(val km: Int, val days: Int, val photos: Int, val countries: Int)

    suspend fun tripStats(id: String): TripStats? = runCatching {
        JSONObject(Api.get("/api/trips/$id/stats")).let { TripStats(it.optDouble("distanceKm", 0.0).toInt(), it.optInt("days"), it.optInt("photoCount"), it.optJSONArray("countries")?.length() ?: 0) }
    }.getOrNull()

    private fun JSONObject.str(k: String): String? = optString(k).takeIf { !isNull(k) && it.isNotBlank() && it != "null" }
    private fun JSONObject.dbl(k: String): Double? = if (isNull(k) || !has(k)) null else optDouble(k).takeIf { !it.isNaN() }
}
