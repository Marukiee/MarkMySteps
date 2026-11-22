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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.animation.core.animateFloat
import androidx.compose.ui.layout.onFirstVisible
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale

/**
 * Where the pages get their trips: the invented ones of the demo, or after
 * signing in the account's own, read from the server.
 */
object Data {
    // Signed in, the app opens on the trips as last read (never on the invented ones);
    // the very first time there is nothing yet and the pages show their loading shapes.
    var trips by mutableStateOf<List<Trip>>(if (Api.signedIn) Remote.cachedTrips().orEmpty() else DemoPast + DemoUpcoming)
        private set
    var me by mutableStateOf<Remote.Me?>(if (Api.signedIn) Remote.cachedMe() else null)
        private set
    var live by mutableStateOf(Api.signedIn)
        private set
    /** Signed in but nothing read yet: the pages show placeholders of the right size. */
    val loading: Boolean get() = live && trips.isEmpty() && error == null && !readOnce
    private var readOnce by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    /** Bumped on every reload, so pages that read more per trip read it again. */
    var version by mutableIntStateOf(0)
        private set

    val all: List<Trip> get() = trips
    /** A trip opened from a card's menu with its people sheet straight away. */
    var peopleFor by mutableStateOf<String?>(null)
    val past: List<Trip> get() = trips.filter { !it.upcoming && !it.shared }
    /** Other people's trips you were added to. */
    val sharedTrips: List<Trip> get() = trips.filter { it.shared }
    /** Your own trips under way or still to come, the soonest first. */
    val upcoming: List<Trip> get() = trips.filter { it.upcoming && !it.shared }.sortedBy { it.startsInDays ?: 0 }
    val next: Trip? get() = upcoming.firstOrNull()
    val shared: Int get() = if (live) sharedTrips.size else DemoSharedCount

    suspend fun load() {
        if (!Api.signedIn) return
        try {
            me = Remote.me()
            trips = Remote.trips()  // reads `me` from the cache to tell own trips from shared ones
            live = true
            error = null
            readOnce = true
            version++
        } catch (e: Api.Failure) {
            if (e.status == 401) signOut() else error = e.message
        }
    }

    /** Just signed in: drop the invented trips at once and wait for the real ones. */
    fun begin() {
        trips = emptyList()
        me = null
        live = true
        error = null
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
    when {
        id != null -> RemotePhoto(id, modifier, size)
        // A real trip without a photo: its own colour with the compass, as on the web, never a made-up landscape.
        trip.remoteId != null -> androidx.compose.foundation.layout.BoxWithConstraints(modifier.background(androidx.compose.ui.graphics.Brush.linearGradient(listOf(trip.color, androidx.compose.ui.graphics.Color(0xFF1B2440).copy(alpha = 0.5f).compositeOver(trip.color)))), contentAlignment = androidx.compose.ui.Alignment.Center) {
            // The compass grows with the card: small on a thumbnail, large on the big card.
            val side = minOf(maxWidth, maxHeight) * 0.42f
            LineIcon(Glyphs.compass, androidx.compose.ui.graphics.Color.White.copy(alpha = 0.8f), size = side, stroke = 1.6f)
        }
        else -> Scenery(trip.cover ?: Scene.Mountains, modifier)
    }
}

/** A photo from the server, fading in once it is there, on a quiet tone until then. */
@Composable
fun RemotePhoto(id: String, modifier: Modifier, size: String = "thumbnail") {
    // Only fetched once it comes on screen, so a day with three hundred photos does not ask for all of them at once.
    var seen by androidx.compose.runtime.remember(id) { mutableStateOf(Photos.cached("$id/$size") != null) }
    val bitmap by produceState<Bitmap?>(Photos.cached("$id/$size"), id, size, seen) {
        if (value == null && seen) value = Photos.load(id, size)
    }
    val shown by animateFloatAsState(if (bitmap != null) 1f else 0f, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "photo")
    // While it loads the frame breathes softly (as on the web), then the photo fades in over it.
    val breathe = if (bitmap == null) androidx.compose.animation.core.rememberInfiniteTransition(label = "breathe").animateFloat(
        0.55f, 1f, androidx.compose.animation.core.infiniteRepeatable(androidx.compose.animation.core.tween<Float>(1100), androidx.compose.animation.core.RepeatMode.Reverse), label = "a",
    ) else null
    val tone = MaterialTheme.colorScheme.surfaceContainerHigh
    Box(modifier.drawBehind { drawRect(tone, alpha = breathe?.value ?: 1f) }.onFirstVisible { seen = true }) {
        bitmap?.let {
            Image(
                it.asImageBitmap(), contentDescription = null, contentScale = ContentScale.Crop,
                modifier = Modifier.matchParentSize().graphicsLayer { alpha = shown },
            )
        }
    }
}

/**
 * The colour a cover photo leans to, for a background that belongs to it: the
 * muted swatch first (calm behind text), else the dominant one. Null until
 * the photo is there; the demo's drawn covers use the trip's own colour.
 */
@Composable
fun coverTone(trip: Trip): androidx.compose.ui.graphics.Color? {
    val id = trip.coverId ?: return trip.color
    val tone by produceState<androidx.compose.ui.graphics.Color?>(null, id) {
        val bitmap = Photos.load(id, "thumbnail") ?: return@produceState
        value = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) {
            val p = androidx.palette.graphics.Palette.from(bitmap).maximumColorCount(12).generate()
            (p.vibrantSwatch ?: p.mutedSwatch ?: p.dominantSwatch)?.rgb?.let { androidx.compose.ui.graphics.Color(it) }
        }
    }
    return tone
}

/** A person's face: their photo from the server when they have one, else their initial on a colour. */
@Composable
fun Avatar(userId: String?, name: String, hasAvatar: Boolean, color: androidx.compose.ui.graphics.Color, modifier: Modifier, shape: androidx.compose.ui.graphics.Shape = androidx.compose.foundation.shape.CircleShape) {
    val bitmap by produceState<Bitmap?>(userId?.let { Photos.cached("avatar/$it") }, userId, hasAvatar) {
        if (value == null && userId != null && hasAvatar) value = Photos.avatar(userId)
    }
    Box(modifier.clip(shape).background(color), contentAlignment = androidx.compose.ui.Alignment.Center) {
        androidx.compose.material3.Text(
            name.take(1).uppercase(),
            style = androidx.compose.ui.text.TextStyle(fontFamily = Outfit, fontWeight = androidx.compose.ui.text.font.FontWeight(700), fontSize = androidx.compose.ui.unit.TextUnit(17f, androidx.compose.ui.unit.TextUnitType.Sp), color = androidx.compose.ui.graphics.Color.White),
        )
        val shown by animateFloatAsState(if (bitmap != null) 1f else 0f, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "avatar")
        bitmap?.let { Image(it.asImageBitmap(), null, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize().graphicsLayer { alpha = shown }) }
    }
}

/** Light, dark or follow the phone: kept on the phone, read by MainActivity. */
object ThemePref {
    private const val KEY = "theme"
    private var prefs: android.content.SharedPreferences? = null
    /** 0 light, 1 dark, 2 the phone's own setting. */
    var mode by mutableIntStateOf(2)
        private set

    fun init(context: android.content.Context) {
        prefs = context.getSharedPreferences("mms.next.ui", android.content.Context.MODE_PRIVATE)
        mode = prefs?.getInt(KEY, 2) ?: 2
    }

    fun set(value: Int) {
        mode = value
        prefs?.edit()?.putInt(KEY, value)?.apply()
    }
}

/** The map style, as on the web: three OpenFreeMap styles or Esri satellite. Kept on the phone. */
object MapStylePref {
    val ids = listOf("positron" to "Positron", "bright" to "Bright", "liberty" to "Liberty", "satellite" to "Satelliet")
    private var prefs: android.content.SharedPreferences? = null
    var id by mutableStateOf("positron")
        private set
    fun init(context: android.content.Context) {
        prefs = context.getSharedPreferences("mms.next.ui", android.content.Context.MODE_PRIVATE)
        id = prefs?.getString("mapStyle", "positron") ?: "positron"
    }
    fun set(value: String) { id = value; prefs?.edit()?.putString("mapStyle", value)?.apply() }
}

/**
 * How big a trip shows on the homepage, as on the web: a default for all trips (Automatisch: the trips to come
 * and the latest one big, the rest as rows) and per trip a choice from its menu that wins over it. Kept on
 * this phone only.
 */
object CardSizePref {
    const val AUTO = "auto"; const val LARGE = "large"; const val COMPACT = "compact"
    private var prefs: android.content.SharedPreferences? = null
    var standard by mutableStateOf(AUTO)
        private set
    val overrides = androidx.compose.runtime.mutableStateMapOf<String, String>()
    fun init(context: android.content.Context) {
        prefs = context.getSharedPreferences("mms.next.ui", android.content.Context.MODE_PRIVATE)
        standard = prefs?.getString("cardSize", AUTO) ?: AUTO
        runCatching {
            val o = org.json.JSONObject(prefs?.getString("cardSizeOverrides", "{}") ?: "{}")
            o.keys().forEach { k -> overrides[k] = o.getString(k) }
        }
    }
    fun choose(v: String) { standard = v; prefs?.edit()?.putString("cardSize", v)?.apply() }
    /** null follows the default. */
    fun set(tripId: String, v: String?) {
        if (v == null || v == AUTO) overrides.remove(tripId) else overrides[tripId] = v
        save()
    }
    fun clear() { overrides.clear(); save() }
    private fun save() { prefs?.edit()?.putString("cardSizeOverrides", org.json.JSONObject(overrides.toMap()).toString())?.apply() }
    /** Whether this trip shows big; [autoBig] is what Automatisch means for it. */
    fun big(tripId: String, autoBig: Boolean): Boolean = when (overrides[tripId] ?: standard) {
        LARGE -> true
        COMPACT -> false
        else -> autoBig
    }
}

private val PersonPalette = listOf(
    androidx.compose.ui.graphics.Color(0xFFE8613C), androidx.compose.ui.graphics.Color(0xFF5B8DEF), androidx.compose.ui.graphics.Color(0xFF2BB6A8),
    androidx.compose.ui.graphics.Color(0xFFD9A441), androidx.compose.ui.graphics.Color(0xFF7A5BD6), androidx.compose.ui.graphics.Color(0xFFE34B8A), androidx.compose.ui.graphics.Color(0xFF4CAF50),
)

/** One colour per person, the same on every screen (behind their initial when they have no photo). */
fun personColor(key: String?): androidx.compose.ui.graphics.Color = PersonPalette[((key ?: "").hashCode() and 0x7fffffff) % PersonPalette.size]
