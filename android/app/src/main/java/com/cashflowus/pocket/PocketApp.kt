package com.cashflowus.pocket

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager

class PocketApp : Application() {
    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(Notifier.CHANNEL, "Agents", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "What your agents tell you"
            }
        )
        // Alarms do not survive an app update; set them again from the last schedule.
        Scheduler.reapply(this)
    }
}
