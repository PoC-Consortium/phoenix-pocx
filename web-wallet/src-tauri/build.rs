fn main() {
    // Tauri handles Windows manifest embedding automatically
    // We use restart_elevated() for on-demand elevation when plotting
    tauri_build::build()
}
