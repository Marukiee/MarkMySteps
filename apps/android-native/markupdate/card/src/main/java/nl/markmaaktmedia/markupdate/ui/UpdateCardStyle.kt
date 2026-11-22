package nl.markmaaktmedia.markupdate.ui

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp

/**
 * Hoe de kaart beweegt. De standaardwaarden zijn die van Keeper; een app met andere afspraken geeft hier de zijne.
 *
 * Alles wat van plek of maat verandert is een veer (die houdt zijn snelheid vast en leest als iets dat echt verschoven wordt), alles wat
 * alleen van kleur of doorzichtigheid verandert is een tween (een veerkrachtige kleur ziet eruit als een fout).
 */
@Immutable
data class UpdateCardMotion(
    /** Veer voor maat en plek: weinig doorschieten. */
    val damping: Float = 0.9f,
    val stiffness: Float = Spring.StiffnessMediumLow,
    /** Veer voor het groeien en krimpen van de kaart zelf. */
    val sizeDamping: Float = 0.85f,
    val fadeMillis: Int = 260,
    val colourMillis: Int = 320,
    /** Snel weg uit de startblokken en een lange uitloop. */
    val easing: Easing = CubicBezierEasing(0.22f, 1f, 0.36f, 1f),
    /** De veer van het indrukken van een knop: mag een beetje doorschieten. */
    val pressDamping: Float = Spring.DampingRatioLowBouncy,
    val pressStiffness: Float = Spring.StiffnessMedium,
    /**
     * De veer waarmee Later krimpt (als aandeel van de breedte, van een derde tot niets) als het bijwerken begint. Zacht en langzaam: een
     * stijvere veer laat de knop verdwijnen voordat de balk ruimte heeft genomen.
     */
    val laterDamping: Float = 0.9f,
    val laterStiffness: Float = 90f,
) {
    fun <T> spatial(): FiniteAnimationSpec<T> = spring(dampingRatio = damping, stiffness = stiffness)
    fun <T> fade(): FiniteAnimationSpec<T> = tween(durationMillis = fadeMillis, easing = easing)
    fun <T> colour(): FiniteAnimationSpec<T> = tween(durationMillis = colourMillis, easing = easing)
    fun <T> press(): FiniteAnimationSpec<T> = spring(dampingRatio = pressDamping, stiffness = pressStiffness)
    fun laterSpring(): FiniteAnimationSpec<Float> = spring(dampingRatio = laterDamping, stiffness = laterStiffness)

    /** Maatveranderingen hebben een eigen drempel nodig, anders trilt de laatste pixel. */
    fun sizeSpring(): FiniteAnimationSpec<IntSize> = spring(dampingRatio = sizeDamping, stiffness = stiffness, visibilityThreshold = IntSize(1, 1))
}

/**
 * Wat per app anders is aan de kaart; de rest (kleuren, lettertypen, hoeken van de knoppen) komt uit [androidx.compose.material3.MaterialTheme].
 */
@Immutable
data class UpdateCardStyle(
    /** De vorm van de kaart zelf, passend bij de andere kaarten van de app. */
    val shape: Shape = RoundedCornerShape(24.dp),
    /** Het groen van het vinkje als de update installeert. [Color.Unspecified] kiest een groen dat past bij een licht of donker thema. */
    val successColor: Color = Color.Unspecified,
    /** Hoever een ingedrukte knop krimpt. */
    val pressedScale: Float = 0.96f,
    val motion: UpdateCardMotion = UpdateCardMotion(),
    /**
     * De regel onder "Installeren X" terwijl de app bijgewerkt wordt. `null` is de standaardtekst "De app sluit zo even, daarna is hij
     * bijgewerkt"; een app die zichzelf na de update weer opent (zie [nl.markmaaktmedia.markupdate.InstallHook]) zegt hier wat anders.
     */
    val installingSubtitle: String? = null,
)
