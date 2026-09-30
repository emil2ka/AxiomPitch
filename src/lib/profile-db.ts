import type { LocalAccount } from "./account.ts";
import { loadAccount, profileStorage } from "./account.ts";
import { apiBase, jsonBody, request } from "./api.ts";
export const databasePreferences = ["axiompitch-notch", "axiompitch-notch-display", "axiompitch-notch-scale", "axiompitch-sensitivity", "axiompitch-target-duration", "axiompitch-learning-progress"] as const;
export type DatabaseProfile = { account: LocalAccount; preferences: Record<string, string>; workspace: { name: string; index: number; presentationId: string | null; kind?: "demo" | "pdf" } | null; stats: { sessions: number; duration: number; presentations: number } };
export const syncProfile = (account: LocalAccount) => request<DatabaseProfile>(`/api/profiles/${encodeURIComponent(account.id)}`, jsonBody({ ...account, createdAt: account.createdAt || new Date().toISOString() }, "PUT"));
export const databaseProfile = (id: string) => request<DatabaseProfile>(`/api/profiles/${encodeURIComponent(id)}`);
export const databaseProfiles = () => request<{ items: LocalAccount[] }>("/api/profiles");
export const saveDatabaseWorkspace = (id: string, workspace: { name: string; index: number; presentationId: string | null; kind?: "demo" | "pdf" }) => request(`/api/profiles/${encodeURIComponent(id)}/workspace`, jsonBody(workspace, "PUT"));
export const linkLegacyData = (id: string, presentationId: string | null, sessionIds: string[]) => request(`/api/profiles/${encodeURIComponent(id)}/migrate`, jsonBody({ presentationId, sessionIds }));
export async function saveDatabasePreferences() {
  const account = loadAccount();
  if (!account || !apiBase) return;
  const storage = profileStorage(account.id);
  const preferences = Object.fromEntries(databasePreferences.flatMap(key => { const value = storage.getItem(key); return value === null ? [] : [[key, value]]; }));
  return request(`/api/profiles/${encodeURIComponent(account.id)}/preferences`, jsonBody(preferences, "PATCH"));
}
