import java.util.Properties
import java.io.FileInputStream

// Load signing properties - REQUIRED for release builds
val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties()

if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
} else {
    throw GradleException("Missing keystore.properties - release signing is required. See: https://v2.tauri.app/distribute/sign/android/")
}

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

// Per-flavor build identity is injected by CI via environment variables so a
// single template produces the three Android flavors (hybrid / wallet / mining)
// with distinct appIds. Fallbacks keep local `tauri android build` working:
//   PHX_APP_ID       — applicationId ONLY (default: hybrid appId)
//   PHX_VERSION_NAME — versionName, the release tag without a leading "v"
//   PHX_VERSION_CODE — integer versionCode (see CI: MAJOR*10000+MINOR*100+PATCH)
//
// The `namespace` must NOT vary per flavor: Tauri generates its Kotlin glue
// (Logger.kt, the main activity) into the `org.pocx.phoenix` package (the
// tauri.conf.json identifier / WRY_ANDROID_PACKAGE) and references BuildConfig
// unqualified. BuildConfig is emitted into the `namespace` package, so moving
// the namespace to a flavor appId (e.g. org.pocx.phoenix.wallet) leaves those
// generated files unable to resolve BuildConfig. Keep namespace fixed and vary
// only applicationId — the standard Android "same code, distinct appId" pattern.
val phxAppId: String = System.getenv("PHX_APP_ID") ?: "org.pocx.phoenix"
val phxVersionName: String = System.getenv("PHX_VERSION_NAME") ?: "1.0"
val phxVersionCode: Int = (System.getenv("PHX_VERSION_CODE") ?: "1").toInt()

android {
    compileSdk = 35
    // Fixed — matches the tauri.conf.json identifier where Tauri's generated
    // Kotlin + BuildConfig live. Per-flavor identity is applicationId only.
    namespace = "org.pocx.phoenix"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = phxAppId
        minSdk = 24
        targetSdk = 35
        versionCode = phxVersionCode
        versionName = phxVersionName
    }

    signingConfigs {
        create("release") {
            storeFile = file(keystoreProperties["storeFile"] as String)
            storePassword = keystoreProperties["storePassword"] as String
            keyAlias = keystoreProperties["keyAlias"] as String
            keyPassword = keystoreProperties["keyPassword"] as String
        }
    }

    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
}

apply(from = "tauri.build.gradle.kts")
