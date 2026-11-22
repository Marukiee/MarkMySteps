package nl.markmaaktmedia.markmysteps.next

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.offline.OfflineManager
import org.maplibre.android.offline.OfflineRegion
import org.maplibre.android.offline.OfflineRegionError
import org.maplibre.android.offline.OfflineRegionStatus
import org.maplibre.android.offline.OfflineTilePyramidRegionDefinition
import kotlin.coroutines.resume
import kotlin.math.PI
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.tan

/*
 * A trip's part of the map kept on the phone, as the web's "Kaart offline bewaren": the box around where the
 * trip went (its route and stops, with a little air), in the style the maps show now, down to the deepest zoom
 * that stays within a sensible number of tiles. MapLibre keeps it in its own offline database, and the maps
 * use it by themselves when there is no connection. One region per trip, found again by its metadata.
 */
object OfflineMaps {
    /** At most this many tiles per trip (MapLibre's own cap is 6000), and never deeper than 13, as the web. */
    private const val TILE_CAP = 6000L
    private const val MAX_ZOOM = 13

    data class Saved(val region: OfflineRegion, val bytes: Long, val style: String)

    private fun metaOf(r: OfflineRegion): JSONObject? = runCatching { JSONObject(String(r.metadata)) }.getOrNull()

    private suspend fun regions(context: android.content.Context): List<OfflineRegion> = suspendCancellableCoroutine { cont ->
        OfflineManager.getInstance(context).listOfflineRegions(object : OfflineManager.ListOfflineRegionsCallback {
            override fun onList(offlineRegions: Array<OfflineRegion>?) { if (cont.isActive) cont.resume(offlineRegions?.toList().orEmpty()) }
            override fun onError(error: String) { if (cont.isActive) cont.resume(emptyList()) }
        })
    }

    suspend fun find(context: android.content.Context, tripId: String): Saved? =
        regions(context).firstNotNullOfOrNull { r -> metaOf(r)?.takeIf { it.optString("trip") == tripId && it.optBoolean("done") }?.let { Saved(r, it.optLong("bytes"), it.optString("style")) } }

    suspend fun delete(context: android.content.Context, tripId: String) {
        for (r in regions(context)) if (metaOf(r)?.optString("trip") == tripId) suspendCancellableCoroutine { cont ->
            r.setDownloadState(OfflineRegion.STATE_INACTIVE)
            r.delete(object : OfflineRegion.OfflineRegionDeleteCallback {
                override fun onDelete() { if (cont.isActive) cont.resume(Unit) }
                override fun onError(error: String) { if (cont.isActive) cont.resume(Unit) }
            })
        }
    }

    /** The box around everything the trip knows about, with a quarter of a degree of air; null when it knows nothing. */
    fun boundsOf(trip: Trip, routes: List<MapRemote.RouteLine>?): LatLngBounds? {
        val pts = trip.stops.map { it.at } + trip.stops.flatMap { s -> s.dayTrips.mapNotNull { it.at } } + routes.orEmpty().flatMap { it.points } + trip.route
        if (pts.isEmpty()) return null
        val pad = 0.25
        val west = (pts.minOf { it.first } - pad).coerceAtLeast(-180.0); val east = (pts.maxOf { it.first } + pad).coerceAtMost(180.0)
        val south = (pts.minOf { it.second } - pad).coerceAtLeast(-85.0); val north = (pts.maxOf { it.second } + pad).coerceAtMost(85.0)
        return LatLngBounds.from(north, east, south, west)
    }

    private fun lngTile(lng: Double, z: Int) = floor((lng + 180) / 360 * (1 shl z)).toLong()
    private fun latTile(lat: Double, z: Int): Long {
        val r = Math.toRadians(lat)
        return floor((1 - ln(tan(r) + 1 / kotlin.math.cos(r)) / PI) / 2 * (1 shl z)).toLong()
    }
    private fun tiles(b: LatLngBounds, z: Int) = (lngTile(b.longitudeEast, z) - lngTile(b.longitudeWest, z) + 1) * (latTile(b.latitudeSouth, z) - latTile(b.latitudeNorth, z) + 1)

    /** The deepest zoom whose tiles, all levels together, stay under the cap. */
    fun zoomThatFits(b: LatLngBounds): Int {
        var total = 0L
        for (z in 0..MAX_ZOOM) {
            total += tiles(b, z)
            if (total > TILE_CAP) return (z - 1).coerceAtLeast(4)
        }
        return MAX_ZOOM
    }

    /** All tiles of all levels up to [zoom], for the count on screen. */
    fun tileCount(b: LatLngBounds, zoom: Int) = (0..zoom).sumOf { tiles(b, it) }

    /**
     * Downloads the region; [onProgress] hears done and total resources as they come, [onDone] the saved region or
     * an error in Dutch. A region of this trip that was there already goes first.
     */
    suspend fun download(context: android.content.Context, tripId: String, style: String, bounds: LatLngBounds, onProgress: (Long, Long) -> Unit): Result<Saved> {
        delete(context, tripId)
        val manager = OfflineManager.getInstance(context)
        manager.setOfflineMapboxTileCountLimit(TILE_CAP * 2)
        val zoom = zoomThatFits(bounds)
        val definition = OfflineTilePyramidRegionDefinition(style, bounds, 0.0, zoom.toDouble(), context.resources.displayMetrics.density)
        val meta = JSONObject().put("trip", tripId).put("style", style).put("done", false)
        val region = suspendCancellableCoroutine<OfflineRegion?> { cont ->
            manager.createOfflineRegion(definition, meta.toString().toByteArray(), object : OfflineManager.CreateOfflineRegionCallback {
                override fun onCreate(offlineRegion: OfflineRegion) { if (cont.isActive) cont.resume(offlineRegion) }
                override fun onError(error: String) { if (cont.isActive) cont.resume(null) }
            })
        } ?: return Result.failure(Exception("Downloaden mislukt"))
        val result = suspendCancellableCoroutine<Result<Long>> { cont ->
            cont.invokeOnCancellation { region.setDownloadState(OfflineRegion.STATE_INACTIVE) }
            region.setObserver(object : OfflineRegion.OfflineRegionObserver {
                override fun onStatusChanged(status: OfflineRegionStatus) {
                    onProgress(status.completedResourceCount, status.requiredResourceCount)
                    if (status.isComplete && cont.isActive) {
                        region.setDownloadState(OfflineRegion.STATE_INACTIVE)
                        cont.resume(Result.success(status.completedResourceSize))
                    }
                }
                override fun onError(error: OfflineRegionError) {
                    // A tile that failed is tried again by MapLibre itself; only a lost connection is worth saying.
                    if (error.reason == OfflineRegionError.REASON_CONNECTION && cont.isActive) { region.setDownloadState(OfflineRegion.STATE_INACTIVE); cont.resume(Result.failure(Exception("Downloaden mislukt: geen verbinding"))) }
                }
                override fun mapboxTileCountLimitExceeded(limit: Long) {
                    if (cont.isActive) { region.setDownloadState(OfflineRegion.STATE_INACTIVE); cont.resume(Result.failure(Exception("Dit gebied is te groot om offline te bewaren"))) }
                }
            })
            region.setDownloadState(OfflineRegion.STATE_ACTIVE)
        }
        return result.fold({ bytes ->
            val done = meta.put("done", true).put("bytes", bytes)
            suspendCancellableCoroutine<Unit> { cont ->
                region.updateMetadata(done.toString().toByteArray(), object : OfflineRegion.OfflineRegionUpdateMetadataCallback {
                    override fun onUpdate(metadata: ByteArray) { if (cont.isActive) cont.resume(Unit) }
                    override fun onError(error: String) { if (cont.isActive) cont.resume(Unit) }
                })
            }
            Result.success(Saved(region, bytes, style))
        }, { e -> delete(context, tripId); Result.failure(e) })
    }
}

private fun megabytes(bytes: Long) = "%.1f MB".format(java.util.Locale.forLanguageTag("nl-NL"), bytes / 1024.0 / 1024.0)

/** The trip settings' panel: what is kept, download with its progress, and wipe. */
@Composable
fun OfflineMapPanel(trip: Trip, tripId: String) {
    val cs = MaterialTheme.colorScheme
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val dark = cs.background.luminance() < 0.5f
    var saved by remember { mutableStateOf<OfflineMaps.Saved?>(null) }
    var checked by remember { mutableStateOf(false) }
    var progress by remember { mutableStateOf<Pair<Long, Long>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var routes by remember { mutableStateOf<List<MapRemote.RouteLine>?>(null) }
    LaunchedEffect(tripId) {
        saved = runCatching { OfflineMaps.find(context, tripId) }.getOrNull(); checked = true
        routes = runCatching { MapRemote.routes(tripId, null) }.getOrNull()
    }
    val bounds = OfflineMaps.boundsOf(trip, routes)
    Header("Kaart offline bewaren")
    Panel(animate = true) {
        androidx.compose.animation.Crossfade(Triple(saved != null, bounds != null, checked), animationSpec = MaterialTheme.motionScheme.defaultEffectsSpec(), label = "offlineHint") { (has, can, _) ->
            Hint(when {
                has -> "${megabytes(saved?.bytes ?: 0)} bewaard. De kaart van deze reis werkt nu zonder internet."
                can -> "Bewaart de kaart van het gebied waar je geweest bent, zodat hij het ook zonder internet doet."
                else -> "Zodra deze reis een route of stops met een locatie heeft, kan het gebied bewaard worden."
            })
        }
        AnimatedVisibility(progress != null, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                val (done, total) = progress ?: (0L to 0L)
                SmoothProgress(if (total > 0) done.toFloat() / total else 0f, Modifier.fillMaxWidth())
                Text(if (total > 0) "$done / $total" else "Voorbereiden…", style = ValueStyle.copy(fontSize = 12.5.sp, color = cs.onSurfaceVariant))
            }
        }
        AnimatedVisibility(progress == null, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (saved != null) QuietDangerButton("Wissen", {
                    scope.launch { runCatching { OfflineMaps.delete(context, tripId) }; saved = null }
                }, Modifier.weight(1f), icon = Glyphs.trash)
                SoftButton(if (saved != null) "Opnieuw ophalen" else "Downloaden", {
                    val b = bounds ?: return@SoftButton
                    val style = mapStyleUrl(dark)
                    if (style == null) { error = "Satellietkaart kan niet offline bewaard worden. Kies een andere kaartstijl."; return@SoftButton }
                    error = null; progress = 0L to 0L
                    scope.launch {
                        OfflineMaps.download(context, tripId, style, b) { d, t -> progress = d to t }
                            .onSuccess { saved = it }.onFailure { error = it.message ?: "Downloaden mislukt" }
                        progress = null
                    }
                }, Modifier.weight(1f), icon = Glyphs.download, enabled = bounds != null)
            }
        }
        Note(error, true)
    }
}

