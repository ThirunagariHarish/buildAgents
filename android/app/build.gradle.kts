plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.cashflowus.pocket"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.cashflowus.pocket"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1.0.${System.getenv("GITHUB_RUN_NUMBER") ?: "0"}"
        buildConfigField("String", "BASE_URL", "\"${System.getenv("POCKET_BASE_URL") ?: "https://agents.cashflowus.com"}\"")
    }

    // The signing key lives on the Pocket Box server, never in this public
    // repository; CI fetches it for each build so every build installs over
    // the last. Without it (a local build) the debug key is used.
    val keystore = System.getenv("POCKET_KEYSTORE")?.let { file(it) }?.takeIf { it.exists() }
    signingConfigs {
        if (keystore != null) create("sideload") {
            storeFile = keystore
            storePassword = System.getenv("POCKET_KEYSTORE_PASS")
            keyAlias = "pocket"
            keyPassword = System.getenv("POCKET_KEYSTORE_PASS")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (keystore != null) signingConfigs.getByName("sideload") else signingConfigs.getByName("debug")
        }
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
}
