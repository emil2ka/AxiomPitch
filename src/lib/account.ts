export type LocalAccount = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  learnedAt?: string;
  /** Supabase user who owns this profile; absent for device-only profiles. */
  ownerId?: string;
};
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const KEY = "axiompitch-account";
const PROFILES = "axiompitch-profiles";
const SIGNED_OUT = "axiompitch-signed-out";

function resolveStorage(fallback?: StorageLike): StorageLike | null {
  if (fallback) return fallback;
  try { return typeof localStorage === "undefined" ? null : localStorage; }
  catch { return null; }
}
function parse(raw: string | null): LocalAccount | null {
  try {
    const value = JSON.parse(raw || "null");
    if (!value || typeof value.name !== "string" || typeof value.email !== "string") return null;
    return { id: typeof value.id === "string" ? value.id : "legacy", name: value.name, email: value.email,
      createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
      learnedAt: typeof value.learnedAt === "string" ? value.learnedAt : undefined,
      ...(typeof value.ownerId === "string" ? { ownerId: value.ownerId } : {}) };
  } catch { return null; }
}
export function loadSavedAccount(from?: StorageLike): LocalAccount | null {
  try { return parse(resolveStorage(from)?.getItem(KEY) ?? null); }
  catch { return null; }
}
export function loadAccount(from?: StorageLike): LocalAccount | null {
  try {
    if (resolveStorage(from)?.getItem(SIGNED_OUT) === "1") return null;
    return loadSavedAccount(from);
  } catch { return null; }
}
export function listAccounts(from?: StorageLike): LocalAccount[] {
  try {
    const raw = JSON.parse(resolveStorage(from)?.getItem(PROFILES) || "[]");
    const accounts: LocalAccount[] = Array.isArray(raw) ? raw.flatMap(value => {
      const account = parse(JSON.stringify(value)); return account ? [account] : [];
    }) : [];
    const saved = loadSavedAccount(from);
    if (saved && !accounts.some(account => account.id === saved.id)) accounts.unshift(saved);
    return accounts;
  } catch { const saved = loadSavedAccount(from); return saved ? [saved] : []; }
}
function persist(account: LocalAccount, from?: StorageLike) {
  const store = resolveStorage(from);
  if (!store) throw new Error("Браузер не разрешает сохранять профиль. Разреши хранение данных для этого сайта.");
  const accounts = listAccounts(store).filter(item => item.id !== account.id);
  store.setItem(PROFILES, JSON.stringify([account, ...accounts]));
  store.setItem(KEY, JSON.stringify(account));
  store.removeItem(SIGNED_OUT);
  return account;
}
export function saveAccount(name: string, email: string, from?: StorageLike): LocalAccount {
  const previous = loadSavedAccount(from);
  return persist({ id: previous?.id ?? crypto.randomUUID(), name: name.trim(), email: email.trim(),
    createdAt: previous?.createdAt || new Date().toISOString(), learnedAt: previous?.learnedAt }, from);
}
export function updateAccount(id: string, name: string, email: string, from?: StorageLike): LocalAccount {
  const previous = listAccounts(from).find(account => account.id === id);
  if (!previous) throw new Error("Профиль больше не доступен на этом устройстве.");
  return persist({ ...previous, name: name.trim(), email: email.trim() }, from);
}
export function createAccount(name: string, email: string, from?: StorageLike): LocalAccount {
  return persist({ id: crypto.randomUUID(), name: name.trim(), email: email.trim(), createdAt: new Date().toISOString() }, from);
}
/** A cloud sign-in makes the profile the server returned the current one. */
export function adoptAccount(account: LocalAccount, from?: StorageLike): LocalAccount {
  return persist(account, from);
}
export function resumeAccount(id: string, from?: StorageLike): LocalAccount | null {
  const account = listAccounts(from).find(item => item.id === id);
  return account ? persist(account, from) : null;
}
export function markLearned(from?: StorageLike): LocalAccount | null {
  const account = loadAccount(from);
  return account ? persist({ ...account, learnedAt: new Date().toISOString() }, from) : null;
}
/** Sign out keeps profiles and all their workspaces on this device. */
export function signOut(from?: StorageLike) {
  resolveStorage(from)?.setItem(SIGNED_OUT, "1");
}
/** Explicit removal, kept separate from signing out. */
export function clearAccount(from?: StorageLike) {
  const store = resolveStorage(from);
  const saved = loadSavedAccount(from);
  try {
    store?.setItem(PROFILES, JSON.stringify(listAccounts(store ?? undefined).filter(item => item.id !== saved?.id)));
    store?.removeItem(KEY); store?.removeItem(SIGNED_OUT);
  } catch { /* Nothing to clean up. */ }
}
export function accountHome(account: LocalAccount | null): string {
  return account ? "/studio" : "/login";
}
export function accountInitials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() ?? "").join("") || "A";
}
export const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());

/** Old preferences belong only to the migrated profile, never to a new user. */
export function profileStorage(id: string, from?: StorageLike): StorageLike {
  const store = resolveStorage(from);
  const keyFor = (key: string) => `axiompitch-profile:${id}:${key}`;
  return {
    getItem(key) {
      try { return store?.getItem(keyFor(key)) ?? (id === "legacy" ? store?.getItem(key) : null) ?? null; }
      catch { return null; }
    },
    setItem(key, value) {
      if (!store) throw new Error("Хранение данных недоступно.");
      store.setItem(keyFor(key), value);
    },
    removeItem(key) { store?.removeItem(keyFor(key)); },
  };
}


/** Cache database profiles without signing in or changing the selected profile. */
export function cacheAccounts(accounts: LocalAccount[], from?: StorageLike) {
  const store = resolveStorage(from);
  if (!store) return;
  const merged = new Map(listAccounts(store).map(account => [account.id, account]));
  // The bridge does not know the cloud owner, so keep fields it did not send.
  for (const account of accounts) merged.set(account.id, { ...merged.get(account.id), ...account });
  store.setItem(PROFILES, JSON.stringify([...merged.values()]));
}
