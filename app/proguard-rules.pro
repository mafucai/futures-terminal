# Add project specific ProGuard rules here.
# Keep JavaScript interface methods reachable from the WebView bridge.
-keepclassmembers class com.coomi.futuresterminal.MainActivity$* {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes *Annotation*
-keepattributes JavascriptInterface
