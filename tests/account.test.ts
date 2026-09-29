import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accountHome,
  accountInitials,
  clearAccount,
  loadAccount,
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

test("marking learning keeps the account and unlocks the studio", () => {
  const store = fakeStorage();
  saveAccount("Алия", "aliya@example.com", store);
  assert.equal(accountHome(loadAccount(store)), "/learn");
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
  assert.equal(accountHome(null), "/register");
});

test("initials and email validation are predictable", () => {
  assert.equal(accountInitials("алия нурланова"), "АН");
  assert.equal(accountInitials("  "), "A");
  assert.equal(looksLikeEmail("you@example.com"), true);
  assert.equal(looksLikeEmail("you@example"), false);
  assert.equal(looksLikeEmail("not an email"), false);
});
