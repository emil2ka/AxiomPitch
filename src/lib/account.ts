export type LocalAccount = {
  name: string;
  email: string;
  createdAt: string;
  learnedAt?: string;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const KEY = "axiompitch-account";

/** localStorage is missing in node:test and blocked in some private modes. */
function resolveStorage(fallback?: StorageLike): StorageLike | null {
  if (fallback) return fallback;
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadAccount(from?: StorageLike): LocalAccount | null {
  const store = resolveStorage(from);
  if (!store) return null;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as LocalAccount;
    if (typeof candidate.name !== "string" || typeof candidate.email !== "string")
      return null;
    return {
      name: candidate.name,
      email: candidate.email,
      createdAt:
        typeof candidate.createdAt === "string" ? candidate.createdAt : "",
      learnedAt:
        typeof candidate.learnedAt === "string" ? candidate.learnedAt : undefined,
    };
  } catch {
    return null;
  }
}

export function saveAccount(
  name: string,
  email: string,
  store?: StorageLike,
): LocalAccount {
  const previous = loadAccount(store);
  const account: LocalAccount = {
    name: name.trim(),
    email: email.trim(),
    createdAt: previous?.createdAt || new Date().toISOString(),
    learnedAt: previous?.learnedAt,
  };
  try {
    resolveStorage(store)?.setItem(KEY, JSON.stringify(account));
  } catch {
    // Private mode: the account lives for this tab only.
  }
  return account;
}

export function markLearned(store?: StorageLike): LocalAccount | null {
  const account = loadAccount(store);
  if (!account) return null;
  const next: LocalAccount = { ...account, learnedAt: new Date().toISOString() };
  try {
    resolveStorage(store)?.setItem(KEY, JSON.stringify(next));
  } catch {
    return account;
  }
  return next;
}

export function clearAccount(store?: StorageLike): void {
  try {
    resolveStorage(store)?.removeItem(KEY);
  } catch {
    // Nothing to clean up.
  }
}

export function accountHome(account: LocalAccount | null): string {
  if (!account) return "/register";
  return account.learnedAt ? "/studio" : "/learn";
}

export function accountInitials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  const initials = parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
  return initials || "A";
}

export const looksLikeEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
