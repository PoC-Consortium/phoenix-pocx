package org.pocx.phoenix.foregroundservice

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Broadcast receiver for the "Stop" button in the notification.
 *
 * When the user taps Stop in the notification, this receiver
 * sends a stop command to the MiningForegroundService.
 */
class StopServiceReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        val stopIntent = Intent(context, MiningForegroundService::class.java).apply {
            action = MiningForegroundService.ACTION_STOP
        }
        context.startService(stopIntent)
    }
}
