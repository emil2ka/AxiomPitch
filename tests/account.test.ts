import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accountHome,
  accountInitials,
  clearAccount,
  loadAccount,
  loadSavedAccount,
  listAccounts,
  createAccount,
  resumeAccount,
  signOut,
  profileStorage,
  looksLikeEmail,
  markLearned,
  saveAccount,
} from "../src/lib/account.ts";

const fakeStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
};

test("a saved account survives a reload and keeps the first creation date", () => {
  const store = fakeStorage();
  const created = saveAccount("  Алия ", "aliya@example.com", store);
  assert.equal(created.name, "Алия");
  assert.equal(created.learnedAt, undefined);
  const again = saveAccount("Алия", "aliya@example.com", store);
  assert.equal(again.createdAt, created.createdAt);
  const loaded = loadAccount(store);
  assert.deepEqual(loaded, created);
});

test("learning stays optional and completing it persists the progress", () => {
  const store = fakeStorage();
  saveAccount("Алия", "aliya@example.com", store);
  assert.equal(accountHome(loadAccount(store)), "/studio");
  const learned = markLearned(store);
  assert.ok(learned?.learnedAt);
  assert.equal(accountHome(loadAccount(store)), "/studio");
});

test("broken and cleared accounts fall back to registration", () => {
  const store = fakeStorage();
  store.setItem("axiompitch-account", "{not json");
  assert.equal(loadAccount(store), null);
  saveAccount("Алия", "aliya@example.com", store);
  clearAccount(store);
  assert.equal(loadAccount(store), null);
  assert.equal(accountHome(null), "/login");
});

test("initials and email validation are predictable", () => {
  assert.equal(accountInitials("алия нурланова"), "АН");
  assert.equal(accountInitials("  "), "A");
  assert.equal(looksLikeEmail("you@example.com"), true);
  assert.equal(looksLikeEmail("you@example"), false);
  assert.equal(looksLikeEmail("not an email"), false);
});


test("signing out keeps the profile, progress and preferences; returning restores them", () => {
  const store = fakeStorage();
  const account = saveAccount("Алия", "aliya@example.com", store);
  const learned = markLearned(store);
  const data = profileStorage(account.id, store);
  data.setItem("axiompitch-history", "saved-history");
  data.setItem("axiompitch-notch", "off");
  signOut(store);
  assert.equal(loadAccount(store), null);
  assert.deepEqual(loadSavedAccount(store), learned);
  assert.equal(data.getItem("axiompitch-history"), "saved-history");
  assert.deepEqual(resumeAccount(account.id, store), learned);
  assert.deepEqual(loadAccount(store), learned);
  assert.equal(profileStorage(account.id, store).getItem("axiompitch-notch"), "off");
});

test("switching profiles isolates history and settings without losing an earlier profile", () => {
  const store = fakeStorage();
  const a = createAccount("Алия", "", store);
  profileStorage(a.id, store).setItem("axiompitch-history", "a-history");
  const b = createAccount("Бек", "", store);
  assert.notEqual(a.id, b.id);
  assert.equal(profileStorage(b.id, store).getItem("axiompitch-history"), null);
  profileStorage(b.id, store).setItem("axiompitch-history", "b-history");
  assert.equal(listAccounts(store).length, 2);
  resumeAccount(a.id, store);
  const edited = saveAccount("Алия Нурланова", "aliya@example.com", store);
  assert.equal(edited.id, a.id);
  assert.equal(profileStorage(edited.id, store).getItem("axiompitch-history"), "a-history");
  assert.equal(profileStorage(b.id, store).getItem("axiompitch-history"), "b-history");
  assert.equal(listAccounts(store).length, 2);
});

test("old profile and preferences migrate without leaking into a new profile", () => {
  const store = fakeStorage();
  store.setItem("axiompitch-account", JSON.stringify({ name: "Алия", email: "aliya@example.com", createdAt: "2026-09-29", learnedAt: "2026-09-30" }));
  store.setItem("axiompitch-notch", "off");
  const old = loadAccount(store)!;
  assert.equal(old.id, "legacy");
  assert.equal(profileStorage(old.id, store).getItem("axiompitch-notch"), "off");
  const next = createAccount("Бек", "", store);
  assert.equal(profileStorage(next.id, store).getItem("axiompitch-notch"), null);
  resumeAccount(old.id, store);
  assert.equal(loadAccount(store)?.learnedAt, "2026-09-30");
});

test("failed browser storage never reports a created profile", () => {
  const store = { getItem: () => null, setItem: () => { throw new Error("quota"); }, removeItem: () => undefined };
  assert.throws(() => createAccount("Алия", "", store), /quota/);
  assert.equal(loadAccount(store), null);
});
