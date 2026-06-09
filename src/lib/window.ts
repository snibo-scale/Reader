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
  });
  win.once("tauri://error", (e) => console.error("Failed to open paper window:", e));
}
