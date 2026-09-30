import type { Slide } from "./types.ts";
export type Workspace = { slides: Slide[]; name: string; index: number; presentationId: string | null };
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("axiompitch-workspaces", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("workspaces");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function loadWorkspace(id: string): Promise<Workspace | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("workspaces").objectStore("workspaces").get(id);
      request.onsuccess = () => {
        const value = request.result as Workspace | undefined;
        resolve(value && Array.isArray(value.slides) && value.slides.length > 0 && value.slides.length <= 60 &&
          value.slides.every(slide => typeof slide.id === "string" && typeof slide.title === "string" && typeof slide.notes === "string") &&
          typeof value.name === "string" ? { ...value, index: Math.max(0, Math.min(value.slides.length - 1, Number(value.index) || 0)) } : null);
      };
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
export async function saveWorkspace(id: string, workspace: Workspace): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("workspaces", "readwrite");
      transaction.objectStore("workspaces").put(workspace, id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
