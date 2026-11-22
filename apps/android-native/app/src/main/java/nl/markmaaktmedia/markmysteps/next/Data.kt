package nl.markmaaktmedia.markmysteps.next

import android.graphics.Bitmap
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale

/**
 * Where the pages get their trips: the invented ones of the demo, or after
 * signing in the account's own, read from the server.
 */
object Data {
    var trips by mutableStateOf<List<Trip>>(DemoPast + DemoUpcoming)
        private set
    var me by mutableStateOf<Remote.Me?>(null)
        private set
    var live by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
    /** Bumped on every reload, so pages that read more per trip read it again. */
    var version by mutableIntStateOf(0)
        private set

    val all: List<Trip> get() = trips
    val past: List<Trip> get() = trips.filter { !it.upcoming }
    /** The trip under way, or the first one coming. */
    val next: Trip? get() = trips.filter { it.upcoming }.minByOrNull { it.startsInDays ?: 0 }
    val shared: Int get() = if (live) 0 else DemoSharedCount

    suspend fun load() {
        if (!Api.signedIn) return
        try {
            me = Remote.me()
            trips = Remote.trips()
            live = true
            error = null
            version++
        } catch (e: Api.Failure) {
            if (e.status == 401) signOut() else error = e.message
        }
    }

    fun signOut() {
        Api.signOut()
        trips = DemoPast + DemoUpcoming
        me = null
        live = false
        version++
    }
}

/** A trip's cover: its photo from the server, or the drawn landscape of the demo. */
@Composable
fun Cover(trip: Trip, modifier: Modifier, size: String = "thumbnail") {
    val id = trip.coverId
    if (id != null) RemotePhoto(id, modifier, size)
    else Scenery(trip.cover ?: Scene.Mountains, modifier)
}

/** A photo from the server, fading in once it is there, on a quiet tone until then. */
@Composable
fun RemotePhoto(id: String, modifier: Modifier, size: String = "thumbnail") {
    val bitmap by produceState<Bitmap?>(Photos.cached("$id/$size"), id, size) {
        if (value == null) value = Photos.load(id, size)
    }
    val shown by animateFloatAsState(if (bitmap != null) 1f else 0f, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "photo")
    Box(modifier.background(MaterialTheme.colorScheme.surfaceContainerHigh)) {
        bitmap?.let {
            Image(
                it.asImageBitmap(), contentDescription = null, contentScale = ContentScale.Crop,
                modifier = Modifier.matchParentSize().graphicsLayer { alpha = shown },
            )
        }
    }
}
