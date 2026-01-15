package org.pocx.phoenix.foregroundservice

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

/** Arguments for startForegroundService command */
@InvokeArg
class StartServiceArgs {
    var mode: String = "mining"
}

/** Arguments for updateNotification command */
@InvokeArg
class UpdateNotificationArgs {
    var text: String = ""
}

/**
 * Tauri plugin for managing Android Foreground Service with wake lock.
 *
 * This keeps the app alive when backgrounded or screen is off during
 * mining and plotting operations.
 */
@TauriPlugin
class ForegroundServicePlugin(private val activity: Activity) : Plugin(activity) {

    /**
     * Start the foreground service with specified mode.
     * @param mode "mining" or "plotting"
     */
    @Command
    fun startForegroundService(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(StartServiceArgs::class.java)
            val mode = args.mode

            val intent = Intent(activity, MiningForegroundService::class.java).apply {
                action = MiningForegroundService.ACTION_START
                putExtra(MiningForegroundService.EXTRA_MODE, mode)
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                activity.startForegroundService(intent)
            } else {
                activity.startService(intent)
            }

            invoke.resolve(JSObject())
        } catch (e: Exception) {
            invoke.reject("Failed to start foreground service: ${e.message}")
        }
    }

    /**
     * Stop the foreground service and release wake lock.
     */
    @Command
    fun stopForegroundService(invoke: Invoke) {
        try {
            val intent = Intent(activity, MiningForegroundService::class.java).apply {
                action = MiningForegroundService.ACTION_STOP
            }
            activity.startService(intent)

            invoke.resolve(JSObject())
        } catch (e: Exception) {
            invoke.reject("Failed to stop foreground service: ${e.message}")
        }
    }

    /**
     * Update the notification text (for progress updates).
     */
    @Command
    fun updateNotification(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(UpdateNotificationArgs::class.java)
            val text = args.text

            val intent = Intent(activity, MiningForegroundService::class.java).apply {
                action = MiningForegroundService.ACTION_UPDATE
                putExtra(MiningForegroundService.EXTRA_TEXT, text)
            }
            activity.startService(intent)

            invoke.resolve(JSObject())
        } catch (e: Exception) {
            invoke.reject("Failed to update notification: ${e.message}")
        }
    }

    /**
     * Request battery optimization exemption by opening system settings.
     */
    @Command
    fun requestBatteryExemption(invoke: Invoke) {
        try {
            val powerManager = activity.getSystemService(Context.POWER_SERVICE) as PowerManager

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                if (!powerManager.isIgnoringBatteryOptimizations(activity.packageName)) {
                    val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:${activity.packageName}")
                    }
                    activity.startActivity(intent)
                }
            }

            invoke.resolve(JSObject())
        } catch (e: Exception) {
            // Fall back to general battery settings
            try {
                val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                activity.startActivity(intent)
                invoke.resolve(JSObject())
            } catch (e2: Exception) {
                invoke.reject("Failed to open battery settings: ${e2.message}")
            }
        }
    }

    /**
     * Check if the foreground service is currently running.
     */
    @Command
    fun isServiceRunning(invoke: Invoke) {
        val result = JSObject()
        result.put("value", MiningForegroundService.isRunning)
        invoke.resolve(result)
    }
}
