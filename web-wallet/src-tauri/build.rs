fn main() {
    // Windows/MSVC: the dependency graph statically imports
    // comctl32!TaskDialogIndirect (rfd task dialogs), which only exists in
    // Common Controls v6 — and v6 only binds through a manifest's SxS
    // activation context. The app binary has Tauri's embedded manifest, but
    // TEST executables get none, so they fail to LOAD with
    // STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139). Delay-loading comctl32
    // fixes both worlds: tests load (the import resolves lazily and task
    // dialogs are never shown in tests), and the app resolves v6 at call
    // time through its activation context exactly as before.
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if target_os == "windows" && target_env == "msvc" {
        println!("cargo:rustc-link-arg=/DELAYLOAD:comctl32.dll");
        println!("cargo:rustc-link-arg=delayimp.lib");
    }

    // Tauri handles the APP binary's Windows manifest embedding itself.
    // We use restart_elevated() for on-demand elevation when plotting.
    tauri_build::build()
}
