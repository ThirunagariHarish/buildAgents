package com.cashflowus.pocket

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.GeolocationPermissions
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView

/** The Runtime page, full screen, with the native bridge attached. */
class MainActivity : Activity() {
    companion object { const val EXTRA_HASH = "hash" }

    private lateinit var web: WebView
    private val host by lazy { Uri.parse(BuildConfig.BASE_URL).host }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        web.layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.setGeolocationEnabled(false) // location goes through the bridge
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // Pocket Box pages stay in the app; anything else opens in the browser.
                if (request.url.host == host) return false
                startActivity(Intent(Intent.ACTION_VIEW, request.url))
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) = callback.invoke(origin, false, false)
        }
        if (!Bridge(applicationContext).attach(web)) {
            setContentView(TextView(this).apply { text = "Update Android System WebView from the Play Store to use Pocket."; setPadding(48, 96, 48, 48) })
            return
        }
        setContentView(web)
        askPermissions()
        web.loadUrl(urlFor(intent))
    }

    private fun urlFor(intent: Intent?): String {
        val hash = intent?.getStringExtra(EXTRA_HASH)
        return "${BuildConfig.BASE_URL}/runtime${if (hash != null) "#$hash" else ""}"
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (::web.isInitialized) web.loadUrl(urlFor(intent))
    }

    private fun askPermissions() {
        val want = mutableListOf(Manifest.permission.ACCESS_COARSE_LOCATION)
        if (Build.VERSION.SDK_INT >= 33) want += Manifest.permission.POST_NOTIFICATIONS
        val missing = want.filter { checkSelfPermission(it) != android.content.pm.PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) requestPermissions(missing.toTypedArray(), 1)
    }

    @Deprecated("Activity back handling")
    override fun onBackPressed() {
        if (::web.isInitialized && web.canGoBack()) web.goBack() else super.onBackPressed()
    }
}
