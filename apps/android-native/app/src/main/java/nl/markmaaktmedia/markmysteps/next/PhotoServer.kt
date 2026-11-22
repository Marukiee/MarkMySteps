package nl.markmaaktmedia.markmysteps.next

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant

/*
 * The book's view of a trip on the server: every photo and video with the
 * moment it was taken (not just the day: bursts and the day it belongs to
 * depend on it), where, whose, and its shape. Only GET requests; nothing is
 * written to the server. What each photo looks like is kept on the phone, so
 * opening the book a second time reads only photos that are new.
 */

suspend fun serverMedia(trip: Trip): List<TripPhoto> {
    val list = JSONArray(Api.get("/api/trips/${trip.remoteId}/media"))
    return (0 until list.length()).mapNotNull { i ->
        val o = list.getJSONObject(i)
        val at = runCatching { Instant.parse(o.getString("takenAt")) }.getOrNull() ?: return@mapNotNull null
        val w = o.optInt("width", 0)
        val h = o.optInt("height", 0)
        val lat = o.optDouble("latitude")
        val lon = o.optDouble("longitude")
        TripPhoto(
            id = o.getString("id"),
            userId = o.optString("userId"),
            takenAt = at,
            aspect = if (w > 0 && h > 0) w.toFloat() / h else null,
            video = o.optString("assetType") == "VIDEO",
            at = if (lat.isNaN() || lon.isNaN()) null else lon to lat,
        )
    }.sortedBy { it.takenAt }
}

/** Looks and shapes per photo id, in the app's own files, one file per trip. */
object LookStore {
    private fun file(context: Context, trip: String) = File(context.filesDir, "looks/$trip.json")

    suspend fun load(context: Context, trip: String): Map<String, Pair<Look, Float>> = withContext(Dispatchers.IO) {
        val f = file(context, trip)
        if (!f.exists()) return@withContext emptyMap()
        runCatching {
            val o = JSONObject(f.readText())
            o.keys().asSequence().associateWith { id ->
                val a = o.getJSONArray(id)
                Look(a.getDouble(0).toFloat(), a.getDouble(1).toFloat(), a.getDouble(2).toFloat(), a.getString(3).toULong(16).toLong(), a.getInt(4)) to a.getDouble(5).toFloat()
            }
        }.getOrDefault(emptyMap())
    }

    suspend fun save(context: Context, trip: String, looks: Map<String, Look>, aspects: Map<String, Float>) = withContext(Dispatchers.IO) {
        val o = JSONObject()
        for ((id, l) in looks) {
            val aspect = aspects[id] ?: continue
            o.put(id, JSONArray().put(l.sharp.toDouble()).put(l.exposure.toDouble()).put(l.colour.toDouble()).put(l.hash.toULong().toString(16)).put(l.average).put(aspect.toDouble()))
        }
        val f = file(context, trip)
        f.parentFile?.mkdirs()
        f.writeText(o.toString())
    }
}
