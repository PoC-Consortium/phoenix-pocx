package org.pocx.phoenix.storagepermission

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

/**
 * Tauri plugin for managing MANAGE_EXTERNAL_STORAGE permission on Android 11+.
 *
 * This permission is required for apps that need to access files created by
 * other apps (e.g., plot files for mining that may have been created externally).
 */
@TauriPlugin
class StoragePermissionPlugin(private val activity: Activity) : Plugin(activity) {

    /**
     * Check if the app has "All files access" permission.
     * Returns true on Android 10 and below (permission not needed).
     */
    @Command
    fun hasAllFilesAccess(invoke: Invoke) {
        val hasAccess = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Environment.isExternalStorageManager()
        } else {
            // Android 10 and below don't need this special permission
            true
        }
        val result = JSObject()
        result.put("value", hasAccess)
        invoke.resolve(result)
    }

    /**
     * Open the system settings page for "All files access" permission.
     * On Android 10 and below, this is a no-op.
     */
    @Command
    fun requestAllFilesAccess(invoke: Invoke) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                // Try to open the app-specific settings page first
                val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION).apply {
                    data = Uri.parse("package:${activity.packageName}")
                }
                activity.startActivity(intent)
            } catch (e: Exception) {
                // Fall back to the general "All files access" settings page
                try {
                    val intent = Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)
                    activity.startActivity(intent)
                } catch (e2: Exception) {
                    invoke.reject("Failed to open settings: ${e2.message}")
                    return
                }
            }
        }
        invoke.resolve(JSObject())
    }
}
