const COMMANDS: &[&str] = &[
    "start_foreground_service",
    "stop_foreground_service",
    "update_service_notification",
    "request_battery_exemption",
    "is_service_running",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
