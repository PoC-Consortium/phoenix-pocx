package org.pocx.phoenix.foregroundservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat

/**
 * Foreground service that keeps the app alive during mining/plotting.
 *
 * Features:
 * - Persistent notification with stop button
 * - Wake lock to prevent CPU sleep
 * - Tap to return to app
 */
class MiningForegroundService : Service() {

    companion object {
        private const val TAG = "PhoenixForeground"
        const val ACTION_START = "org.pocx.phoenix.foregroundservice.START"
        const val ACTION_STOP = "org.pocx.phoenix.foregroundservice.STOP"
        const val ACTION_UPDATE = "org.pocx.phoenix.foregroundservice.UPDATE"

        const val EXTRA_MODE = "mode"
        const val EXTRA_TEXT = "text"

        const val CHANNEL_ID = "phoenix_mining_channel"
        const val NOTIFICATION_ID = 1001

        @Volatile
        var isRunning = false
            private set

        private var currentMode = "mining"
        private var currentText = ""
    }

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "Service onCreate")
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "onStartCommand: action=${intent?.action}")
        when (intent?.action) {
            ACTION_START -> {
                currentMode = intent.getStringExtra(EXTRA_MODE) ?: "mining"
                currentText = if (currentMode == "mining") "Mining active" else "Plotting active"
                Log.i(TAG, "Starting foreground service: mode=$currentMode")
                startForegroundWithNotification()
                acquireWakeLock()
                isRunning = true
                Log.i(TAG, "Foreground service started successfully")
            }
            ACTION_STOP -> {
                Log.i(TAG, "Stopping foreground service")
                stopForegroundService()
            }
            ACTION_UPDATE -> {
                val text = intent.getStringExtra(EXTRA_TEXT)
                if (text != null) {
                    currentText = text
                    Log.d(TAG, "Updating notification: $text")
                    updateNotification()
                }
            }
        }

        return START_STICKY
    }

    override fun onDestroy() {
        releaseWakeLock()
        isRunning = false
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Phoenix Mining",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows when mining or plotting is active"
                setShowBadge(false)
            }

            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun startForegroundWithNotification() {
        val notification = buildNotification()
        startForeground(NOTIFICATION_ID, notification)
    }

    private fun buildNotification(): Notification {
        // Intent to open the app when notification is tapped
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentIntent = PendingIntent.getActivity(
            this, 0, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Intent for stop button
        val stopIntent = Intent(this, StopServiceReceiver::class.java)
        val stopPendingIntent = PendingIntent.getBroadcast(
            this, 0, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val title = if (currentMode == "mining") "Phoenix PoCX Miner" else "Phoenix PoCX Plotter"

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(currentText)
            .setSmallIcon(android.R.drawable.ic_menu_manage) // Use system icon
            .setOngoing(true)
            .setContentIntent(contentIntent)
            .addAction(
                android.R.drawable.ic_menu_close_clear_cancel,
                "Stop",
                stopPendingIntent
            )
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    private fun updateNotification() {
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(NOTIFICATION_ID, buildNotification())
    }

    private fun acquireWakeLock() {
        if (wakeLock == null) {
            val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "Phoenix::MiningWakeLock"
            ).apply {
                acquire(24 * 60 * 60 * 1000L) // 24 hours max
            }
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let {
            if (it.isHeld) {
                it.release()
            }
        }
        wakeLock = null
    }

    private fun stopForegroundService() {
        releaseWakeLock()
        isRunning = false
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }
}
