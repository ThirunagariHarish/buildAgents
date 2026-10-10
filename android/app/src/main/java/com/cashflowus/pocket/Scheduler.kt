package com.cashflowus.pocket

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import org.json.JSONArray
import java.util.concurrent.TimeUnit

/**
 * Wake-ups, set from the schedule the Runtime page reports after every sync:
 * an alarm at each scheduled run time, and one periodic job for agents that
 * run on an interval. Each wake-up runs the page in the background, which
 * runs whatever is due.
 */
object Scheduler {
    private const val PREFS = "pocket"
    private const val KEY = "schedule"
    private const val INTERVAL_WORK = "pocket-interval"

    fun apply(context: Context, itemsJson: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, itemsJson).apply()
        reapply(context)
    }

    fun reapply(context: Context) {
        val items = try {
            JSONArray(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]"))
        } catch (_: Exception) { JSONArray() }
        val am = context.getSystemService(AlarmManager::class.java)
        val now = System.currentTimeMillis()
        // Up to 8 alarm slots; old ones are replaced, unused ones cancelled.
        val times = (0 until items.length()).map { items.getJSONObject(it) }
            .filter { it.optString("kind") == "schedule" && it.optLong("at") > now }
            .map { it.optLong("at") }.distinct().sorted().take(8)
        for (slot in 0 until 8) {
            val pi = PendingIntent.getBroadcast(context, slot, Intent(context, AlarmReceiver::class.java),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val at = times.getOrNull(slot)
            if (at == null) { am.cancel(pi); continue }
            val exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()
            if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        }
        val minutes = (0 until items.length()).map { items.getJSONObject(it) }
            .filter { it.optString("kind") == "interval" }.map { it.optLong("minutes") }.filter { it > 0 }.minOrNull()
        val wm = WorkManager.getInstance(context)
        if (minutes == null) wm.cancelUniqueWork(INTERVAL_WORK)
        else wm.enqueueUniquePeriodicWork(
            INTERVAL_WORK, ExistingPeriodicWorkPolicy.UPDATE,
            PeriodicWorkRequestBuilder<RunWorker>(maxOf(15L, minutes), TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
        )
    }
}
