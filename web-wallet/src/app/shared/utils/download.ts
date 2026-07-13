/**
 * Save text content to a file, cross-environment.
 *
 * The Tauri WebView does NOT wire up browser downloads — a blob/anchor
 * `.click()` is silently dropped (no file, no error). So inside Tauri we use
 * the native save dialog to pick a destination and a Rust command
 * (`write_text_file`) to write it. In a plain browser we fall back to the
 * blob + anchor download (attached to the DOM, with deferred revocation).
 *
 * Resolves when the file is written, or when the user cancels the dialog.
 */
export async function downloadTextFile(
  filename: string,
  contents: string,
  mime = 'text/csv;charset=utf-8;'
): Promise<void> {
  const isTauri =
    typeof window !== 'undefined' &&
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ != null;

  if (isTauri) {
    const [{ save }, { invoke }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/api/core'),
    ]);
    const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.') + 1) : 'txt';
    const path = await save({
      defaultPath: filename,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (!path) return; // user cancelled the dialog
    await invoke('write_text_file', { path, contents });
    return;
  }

  // Browser: blob + anchor. The anchor must be connected to the DOM for the
  // synthetic click to register, and the object URL must outlive the click.
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
