import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

/** Open a paper in its own window (focuses the existing one if already open). */
export async function openPaperWindow(id: string, title: string): Promise<void> {
  const label = "paper-" + id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }
  const win = new WebviewWindow(label, {
    url: `index.html?paper=${encodeURIComponent(id)}`,
    title: title || "Reader",
    width: 1000,
    height: 760,
    // Match the main window's hidden title bar (macOS-only; ignored elsewhere).
    titleBarStyle: "overlay",
    hiddenTitle: true,
  });
  win.once("tauri://error", (e) => console.error("Failed to open paper window:", e));
}

/** Pop the Notes + AI screen for a paper into its own window. */
export async function openWorkspaceWindow(id: string, title: string): Promise<void> {
  const label = "workspace-" + id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }
  // Native title bar (not the app's hidden one): a utility window that drags and
  // closes without custom drag-region wiring.
  const win = new WebviewWindow(label, {
    url: `index.html?workspace=${encodeURIComponent(id)}`,
    title: title ? `${title} — Notes & AI` : "Notes & AI",
    width: 460,
    height: 720,
  });
  win.once("tauri://error", (e) => console.error("Failed to open workspace window:", e));
}
