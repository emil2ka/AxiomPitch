import assert from "node:assert/strict";
import { test } from "node:test";
import { adoptAccount, cacheAccounts, listAccounts, loadAccount, signOut } from "../src/lib/account.ts";
import {
  cloudEnabled,
  cloudMessage,
  cloudPreferencesFrom,
  isSessionResult,
  mergeHistory,
  profileName,
  rowToAccount,
} from "../src/lib/cloud.ts";
import type { SessionResult } from "../src/lib/types.ts";

const fakeStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
};
const owner = "0b7f6c1e-2d4a-4e8b-9c3d-5a6b7c8d9e0f";
const row = {
  id: owner, owner_user_id: owner, name: "Алия", email: "aliya@example.com",
  created_at: "2026-09-30T08:00:00+00:00", learned_at: null, preferences: {},
};
const session = (id: string, startedAt: string): SessionResult => ({
  id, name: "Питч", startedAt, duration: 1000, perSlide: [1000], slideTitles: ["Вступление"],
  commands: { next: 1, previous: 0, toggle: 0 }, corrections: {}, mode: "rehearsal",
});

test("without Supabase settings the app keeps device-only profiles", () => {
  assert.equal(cloudEnabled, false);
});

test("a profile row becomes the cached account and keeps its owner", () => {
  assert.deepEqual(rowToAccount(row), { id: owner, ownerId: owner, name: "Алия", email: "aliya@example.com", createdAt: row.created_at });
  assert.equal(rowToAccount({ ...row, learned_at: "2026-09-30T09:00:00+00:00" }).learnedAt, "2026-09-30T09:00:00+00:00");
});

test("the owner survives saving, signing out and a bridge copy without it", () => {
  const store = fakeStorage();
  adoptAccount(rowToAccount(row), store);
  assert.equal(loadAccount(store)?.ownerId, owner);
  // The local bridge returns profiles without the cloud owner.
  cacheAccounts([{ id: owner, name: "Алия", email: "aliya@example.com", createdAt: row.created_at }], store);
  assert.equal(listAccounts(store).find(account => account.id === owner)?.ownerId, owner);
  signOut(store);
  assert.equal(loadAccount(store), null);
});

test("the registration name comes from metadata, then the mailbox, then a default", () => {
  assert.equal(profileName({ email: "a@b.kz", user_metadata: { name: "  Данияр " } }), "Данияр");
  assert.equal(profileName({ email: "dana@b.kz", user_metadata: { name: "Д" } }), "dana");
  assert.equal(profileName({ email: "d@b.kz", user_metadata: {} }), "Спикер");
  assert.equal(profileName({ email: "a@b.kz", user_metadata: { name: "Я".repeat(120) } }).length, 80);
});

test("only portable string settings arrive from the server", () => {
  assert.deepEqual(cloudPreferencesFrom({ preferences: {
    "axiompitch-sensitivity": "0.9",
    "axiompitch-notch-display": "2",
    "axiompitch-target-duration": 7,
    "axiompitch-unknown": "x",
    "axiompitch-notch": "x".repeat(201),
  } }), { "axiompitch-sensitivity": "0.9" });
  assert.deepEqual(cloudPreferencesFrom({ preferences: null }), {});
});

test("history from two devices merges by ID, newest first, ten at most", () => {
  const phone = [session("a", "2026-09-30T10:00:00Z"), session("b", "2026-09-30T09:00:00Z")];
  const laptop = [session("b", "2026-09-30T09:00:00Z"), session("c", "2026-09-30T11:00:00Z")];
  assert.deepEqual(mergeHistory(phone, laptop).map(item => item.id), ["c", "a", "b"]);
  const many = Array.from({ length: 14 }, (_, i) => session(`s${i}`, `2026-09-${String(i + 10).padStart(2, "0")}T10:00:00Z`));
  assert.equal(mergeHistory(many).length, 10);
  assert.equal(mergeHistory(many)[0].id, "s13");
});

test("a malformed server row never reaches the history list", () => {
  assert.equal(isSessionResult(session("a", "2026-09-30T10:00:00Z")), true);
  assert.equal(isSessionResult(null), false);
  assert.equal(isSessionResult({ ...session("a", "2026-09-30T10:00:00Z"), startedAt: 5 }), false);
  assert.equal(isSessionResult({ ...session("a", "2026-09-30T10:00:00Z"), mode: "demo" }), false);
  assert.equal(isSessionResult({ ...session("a", "2026-09-30T10:00:00Z"), perSlide: undefined }), false);
});

test("Supabase failures become short Russian messages", () => {
  assert.equal(cloudMessage({ code: "invalid_credentials", message: "Invalid login credentials" }), "Неверная почта или пароль.");
  assert.match(cloudMessage({ code: "PGRST205", message: "Could not find the table" }), /postgres-schema\.sql/);
  assert.match(cloudMessage({ name: "AuthRetryableFetchError", message: "Failed to fetch" }), /Нет связи/);
  assert.match(cloudMessage({ name: "AuthSessionMissingError", message: "Auth session missing!" }), /устарела/);
  assert.match(cloudMessage({ message: "Invalid API key" }), /VITE_SUPABASE_PUBLISHABLE_KEY/);
  assert.equal(cloudMessage({ code: "something_new", message: "?" }), "Облако не ответило. Повтори чуть позже.");
});
