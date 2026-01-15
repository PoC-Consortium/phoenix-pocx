const COMMANDS: &[&str] = &["has_all_files_access", "request_all_files_access"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
