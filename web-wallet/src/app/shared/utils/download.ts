/**
 * Trigger a client-side text-file download that works inside the Tauri
 * WebView (Windows WebView2 / macOS WKWebView), not just in a browser.
 *
 * A detached `<a download>.click()` is a silent no-op in some webviews: the
 * anchor must be connected to the DOM for the synthetic click to register,
 * and the object URL must outlive the click (revoking it synchronously can
 * cancel the download before it starts). This helper does both.
 */
export function downloadTextFile(
  filename: string,
  contents: string,
  mime = 'text/csv;charset=utf-8;'
): void {
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
  // Defer revocation so the webview has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
