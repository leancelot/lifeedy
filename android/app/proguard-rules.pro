# Regras de preservação R8 / ProGuard para Lifeedy (Capacitor + Plugins Nativos + ML Kit + Biometria)

-keepattributes SourceFile,LineNumberTable
-keepattributes *Annotation*

# App & Plugins Nativos Capacitor
-keep class com.vidaorganizada.app.** { *; }
-keep class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod <methods>;
}
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.getcapacitor.** { *; }

# Biometria & AndroidX
-keep class androidx.biometric.** { *; }
-keep class androidx.core.content.FileProvider { *; }

# ML Kit OCR Offline
-keep class com.google.mlkit.** { *; }
-dontwarn com.google.mlkit.**
-dontwarn com.google.android.gms.**
