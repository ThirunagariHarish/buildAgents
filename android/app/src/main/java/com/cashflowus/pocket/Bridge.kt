package com.cashflowus.pocket

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/**
 * The page's `PocketNative` object. Only the Pocket Box origin may use it;
 * it can show a notification, set the wake-up schedule, read the location
 * (when the person allowed it) and say a background run is done.
 */
class Bridge(private val context: Context, private val onDone: () -> Unit = {}) {

    fun attach(webView: WebView): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return false
        val origin = Uri.parse(BuildConfig.BASE_URL).let { "${it.scheme}://${it.host}" }
        WebViewCompat.addWebMessageListener(webView, "PocketNative", setOf(origin)) { _, message, _, isMainFrame, reply ->
            if (isMainFrame) handle(message, reply)
        }
        return true
    }

    private fun handle(message: WebMessageCompat, reply: JavaScriptReplyProxy) {
        val m = try { JSONObject(message.data ?: return) } catch (_: Exception) { return }
        when (m.optString("type")) {
            "notify" -> Notifier.show(context, m.optString("title"), m.optString("body"), m.optString("tag", "agent"))
            "schedule" -> Scheduler.apply(context, m.optJSONArray("items")?.toString() ?: "[]")
            "done" -> onDone()
            "location" -> currentLocation { loc ->
                val v = loc?.let { JSONObject().put("lat", it.latitude).put("lon", it.longitude) }
                answer(reply, m.optInt("id"), v != null, v)
            }
            // No on-device model on Android yet: the page falls back to a hand-off.
            "model" -> answer(reply, m.optInt("id"), false, null)
        }
    }

    private fun answer(reply: JavaScriptReplyProxy, id: Int, ok: Boolean, value: Any?) {
        val out = JSONObject().put("reply", id).put("ok", ok).put("value", value ?: JSONObject.NULL)
        Handler(Looper.getMainLooper()).post { try { reply.postMessage(out.toString()) } catch (_: Exception) {} }
    }

    @SuppressLint("MissingPermission")
    private fun currentLocation(done: (Location?) -> Unit) {
        val granted = context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!granted) return done(null)
        val lm = context.getSystemService(LocationManager::class.java)
        val provider = listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER).firstOrNull { lm.isProviderEnabled(it) }
            ?: return done(null)
        if (Build.VERSION.SDK_INT >= 30) {
            lm.getCurrentLocation(provider, CancellationSignal(), context.mainExecutor) { done(it ?: lm.getLastKnownLocation(provider)) }
        } else {
            done(lm.getLastKnownLocation(provider))
        }
    }
}
