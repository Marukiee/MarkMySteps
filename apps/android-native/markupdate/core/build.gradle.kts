// De kern van markupdate: zonder Compose. Dit bestand staat in elke app hetzelfde; wijzig het alleen in Keeper (zie ../README.md).
//
// Bewust zelfstandig: geen `libs.`-verwijzingen (elke app heeft een andere catalog), geen `repositories {}` (Keeper verbiedt dat in de
// projecten), plugins zonder versie (de versies komen uit de root van de app). Heeft een app Kotlin of de Android-plugin nog niet op de
// classpath van de root, dan moet dat daar eerst; zie de README.
plugins {
    id("com.android.library")
}

// AGP 8 heeft de Kotlin-plugin nodig; AGP 9 heeft Kotlin ingebouwd en weigert hem. De Kotlin-versie en de JVM-versie volgen de app.
if (androidComponents.pluginVersion.major < 9) apply(plugin = "org.jetbrains.kotlin.android")

android {
    namespace = "nl.markmaaktmedia.markupdate"
    compileSdk = 36
    // Elke resource van de module begint met markupdate_, zodat niets uit een app of uit de kaart ermee botst.
    resourcePrefix = "markupdate_"

    defaultConfig {
        minSdk = 24
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions { unitTests.isReturnDefaultValues = true }

    lint {
        abortOnError = false
    }
}

// Op taakniveau, zodat dit voor AGP 8 en AGP 9 hetzelfde werkt (de `kotlin {}`-extensie bestaat niet als de plugin hierboven voorwaardelijk komt).
tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinJvmCompile>().configureEach {
    compilerOptions.jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
}

dependencies {
    implementation("androidx.core:core-ktx:1.17.0")
    // StateFlow staat in de openbare API, dus de app moet coroutines ook zien.
    api("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    testImplementation("junit:junit:4.13.2")
    // Op de JVM is org.json van Android een lege stub; de echte is nodig om de GitHub-JSON te kunnen testen.
    testImplementation("org.json:json:20240303")
}
