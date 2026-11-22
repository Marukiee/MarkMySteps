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

    defaultConfig {
        applicationId = "nl.markmaaktmedia.markmysteps.next"
        minSdk = 31
        targetSdk = 36
        versionCode = 1
        versionName = "0.0.1"
        ndk { abiFilters += "arm64-v8a" }
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

    buildFeatures { compose = true }

    // The build that goes on a phone: shrunk and optimised by R8, since a debug build of Compose
    // runs many times slower and makes gestures such as predictive back stutter. Signed with the
    // debug key, so it installs over the debug build and the other way round.
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("debug")
        }
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
