package com.cashflowus.pocket

import android.annotation.SuppressLint
import android.app.Notification
import android.content.Context
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

/**
 * Loads the Runtime page off-screen with `?bg=1`. The page syncs, checks
 * signatures, runs every agent that is due in its locked-down worker,
 * reports the runs and says "done".
 */
class RunWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    @SuppressLint("SetJavaScriptEnabled")
    override suspend fun doWork(): Result {
        val finished = withTimeoutOrNull(170_000) {
            withContext(Dispatchers.Main) {
                suspendCancellableCoroutine { cont ->
                    val web = WebView(applicationContext)
                    var closed = false
                    val close = {
                        if (!closed) {
                            closed = true
                            web.destroy()
                            if (cont.isActive) cont.resume(true)
                        }
                    }
                    web.settings.javaScriptEnabled = true
                    web.settings.domStorageEnabled = true
                    web.webViewClient = WebViewClient()
                    if (!Bridge(applicationContext) { close() }.attach(web)) { close(); return@suspendCancellableCoroutine }
                    cont.invokeOnCancellation { if (!closed) { closed = true; web.destroy() } }
                    web.loadUrl("${BuildConfig.BASE_URL}/runtime?bg=1")
                }
            }
        }
        return if (finished == true) Result.success() else Result.retry()
    }

    override suspend fun getForegroundInfo(): ForegroundInfo {
        val n: Notification = NotificationCompat.Builder(applicationContext, Notifier.CHANNEL)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle("Running your agents")
            .setSilent(true)
            .build()
        return ForegroundInfo(4207, n)
    }
}
