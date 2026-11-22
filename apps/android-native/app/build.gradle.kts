import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

// A first test of MarkMySteps as a native Compose app: the home page only,
// with invented trips, to see how the design carries over.
android {
    namespace = "nl.markmaaktmedia.markmysteps.next"
    compileSdk = 36

    // The store build (MMS_RELEASE=true in the release workflow) replaces the old web-wrapper app: its package,
    // its signing key and a build number above the old app's, so it installs as an update over it. Every other
    // build is "MarkMySteps Dev" next to it.
    val store = providers.environmentVariable("MMS_RELEASE").orNull == "true"
    val storeCode = providers.environmentVariable("MMS_VERSION_CODE").orNull?.toIntOrNull() ?: 1
    defaultConfig {
        applicationId = if (store) "nl.markmaaktmedia.markmysteps" else "nl.markmaaktmedia.markmysteps.next"
        minSdk = 31
        targetSdk = 36
        versionCode = if (store) storeCode else 1
        versionName = if (store) "2.0 ($storeCode)" else "0.0.1"
        manifestPlaceholders["appLabel"] = if (store) "MarkMySteps" else "MarkMySteps Dev"
        // The store build ignores test extras (dry run, previews) so no other app can switch them on.
        buildConfigField("boolean", "STORE", store.toString())
        ndk { abiFilters += "arm64-v8a" }
        // Where the update card looks for a newer build: a GitHub repo (empty switches it off), and per build the exact
        // name of the apk on its releases (see androidComponents below and Update.kt). Change the repo with
        // -Pmms.updateRepo=... (or in gradle.properties).
        buildConfigField("String", "UPDATE_REPO", "\"${providers.gradleProperty("mms.updateRepo").getOrElse("Marukiee/MarkMySteps")}\"")
        // The host whose share and trip links open in the app: linkHost in local.properties, else the public default server.
        val props = Properties().apply { rootProject.file("local.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) } }
        val linkHost = props.getProperty("linkHost") ?: "reis.markmaaktmedia.nl"
        manifestPlaceholders["linkHost"] = linkHost
        resValue("string", "link_host", linkHost)
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
            freeCompilerArgs.addAll(
                "-opt-in=androidx.compose.material3.ExperimentalMaterial3Api",
                "-opt-in=androidx.compose.material3.ExperimentalMaterial3ExpressiveApi",
                "-opt-in=androidx.compose.ui.text.ExperimentalTextApi",
            )
        }
    }

    buildFeatures { compose = true; buildConfig = true }

    // The build that goes on a phone: shrunk and optimised by R8, since a debug build of Compose
    // runs many times slower and makes gestures such as predictive back stutter. Signed with the
    // debug key, so it installs over the debug build and the other way round.
    // The store build is signed with the key of the old app (from the release workflow's secrets).
    signingConfigs {
        create("store") {
            providers.environmentVariable("MMS_KEYSTORE_FILE").orNull?.let { storeFile = file(it) }
            storePassword = providers.environmentVariable("MMS_KEYSTORE_PASSWORD").orNull
            keyAlias = providers.environmentVariable("MMS_KEY_ALIAS").orNull
            keyPassword = providers.environmentVariable("MMS_KEY_PASSWORD").orNull
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // A store build never falls back to the debug key: without the release key it does not build.
            signingConfig = if (store) {
                require(providers.environmentVariable("MMS_KEYSTORE_FILE").isPresent || providers.environmentVariable("MMS_ALLOW_UNSIGNED_STORE").orNull == "true") {
                    "The store build (MMS_RELEASE=true) needs the release key in MMS_KEYSTORE_FILE"
                }
                if (providers.environmentVariable("MMS_KEYSTORE_FILE").isPresent) signingConfigs.getByName("store") else signingConfigs.getByName("debug")
            } else signingConfigs.getByName("debug")
        }
    }
}


// The apk the update card looks for, per build. The app that replaces the old one (package nl.markmaaktmedia.markmysteps)
// looks for markmysteps.apk, the release asset that is marked latest. A dev build (package ...next) looks for a name that
// is never published, so it never offers an update and never installs the old app over itself. -Pmms.updateAsset=...
// overrides both. The app only ever offers a release whose apk has exactly this name (Update.kt).
androidComponents {
    onVariants { variant ->
        val dev = variant.applicationId.get().endsWith(".next")
        val asset = providers.gradleProperty("mms.updateAsset").orNull ?: if (dev) "markmysteps-dev-never-published.apk" else "markmysteps.apk"
        variant.buildConfigFields?.put("UPDATE_ASSET", com.android.build.api.variant.BuildConfigField("String", "\"$asset\"", "the apk the update card looks for"))
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.foundation)
    implementation(libs.androidx.animation)
    implementation(libs.androidx.material3)
    testImplementation("junit:junit:4.13.2")
    // The update card and its updater, shared by all of Marks apps (markupdate/, a copy of Keeper's module).
    implementation(project(":markupdate:card"))
    // The same map as the web app: MapLibre with the OpenFreeMap styles.
    implementation("org.maplibre.gl:android-sdk:11.8.0")
    // Colours from a cover photo, for the rows that take on the tone of their trip.
    implementation("androidx.palette:palette-ktx:1.0.0")
    // The QR code for setting up two-step verification, drawn from its module matrix (encoding only).
    implementation("com.google.zxing:core:3.5.3")
    // The web app's own flat flag set (SVG), drawn instead of the font's waving emoji flags.
    implementation("com.caverock:androidsvg-aar:1.4")
    // A light blur of the photo behind the pills and buttons on the trip cards.
    implementation("dev.chrisbanes.haze:haze:1.7.1")
    // Installs the Compose libraries' baseline profiles, so the first scrolls and gestures are compiled ahead.
    implementation("androidx.profileinstaller:profileinstaller:1.4.1")
}
