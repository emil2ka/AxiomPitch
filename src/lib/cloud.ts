import type { SupabaseClient, User } from "@supabase/supabase-js";
import { adoptAccount, profileStorage } from "./account.ts";
import type { LocalAccount } from "./account.ts";
import { databasePreferences } from "./profile-db.ts";
import type { SessionResult } from "./types.ts";

// Undefined outside Vite (node:test imports this module too).
const env = import.meta.env as ImportMetaEnv | undefined;
const url = String(env?.VITE_SUPABASE_URL ?? "").trim();
const key = String(env?.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim();
/** Without both values PitchFlow keeps its device-only profiles. */
export const cloudEnabled = url !== "" && key !== "";

/** The display number belongs to this computer, so it never follows the account. */
export const cloudPreferences: readonly string[] = databasePreferences.filter(key => key !== "axiompitch-notch-display");

let client: Promise<SupabaseClient> | undefined;
/** Loaded on demand, so an offline build never downloads the SDK. */
export function cloud(): Promise<SupabaseClient> {
  if (!cloudEnabled) return Promise.reject(new Error("Облако не настроено."));
  client ??= import("@supabase/supabase-js").then(({ createClient }) => createClient(url, key));
  return client;
}

type Failure = { code?: string; name?: string; message?: string };
const messages: Record<string, string> = {
  invalid_credentials: "Неверная почта или пароль.",
  email_not_confirmed: "Сначала подтверди почту: открой ссылку из письма.",
  user_already_exists: "Эта почта уже зарегистрирована. Войди или восстанови пароль.",
  email_exists: "Эта почта уже зарегистрирована. Войди или восстанови пароль.",
  weak_password: "Пароль слишком простой. Возьми хотя бы 8 символов, буквы и цифры.",
  same_password: "Новый пароль должен отличаться от старого.",
  email_address_invalid: "Проверь почту: нужен адрес вида you@example.com.",
  over_email_send_rate_limit: "Слишком много писем подряд. Подожди немного и повтори.",
  over_request_rate_limit: "Слишком много попыток. Подожди минуту и повтори.",
  signup_disabled: "Регистрация сейчас закрыта.",
  // The built-in Supabase mailer only writes to members of the project's team.
  email_address_not_authorized: "Supabase не может отправить письмо на этот адрес. Нужен свой SMTP или выключенное подтверждение почты.",
  session_not_found: "Ссылка устарела. Запроси новое письмо.",
  otp_expired: "Ссылка устарела. Запроси новое письмо.",
  // PostgREST and PostgreSQL codes for a project without database/postgres-schema.sql.
  PGRST205: "База Supabase не подготовлена: выполни database/postgres-schema.sql в SQL Editor.",
  "42P01": "База Supabase не подготовлена: выполни database/postgres-schema.sql в SQL Editor.",
};
/** Short Russian text for the speaker; the English original goes to the console. */
export function cloudMessage(failure: Failure): string {
  if (failure.code && messages[failure.code]) return messages[failure.code];
  if (failure.name === "AuthSessionMissingError") return messages.session_not_found;
  if (failure.name === "AuthRetryableFetchError" || failure.message === "Failed to fetch") return "Нет связи с сервером. Проверь интернет и повтори.";
  if (failure.message?.includes("Invalid API key")) return "Ключ Supabase не подходит: проверь VITE_SUPABASE_PUBLISHABLE_KEY.";
  return "Облако не ответило. Повтори чуть позже.";
}
function fail(failure: Failure): never {
  console.warn("Supabase:", failure.code ?? failure.name, failure.message);
  throw new Error(cloudMessage(failure));
}

/** The registration name waits in user metadata until the first sign-in. */
export function profileName(user: Pick<User, "email" | "user_metadata">): string {
  const given = typeof user.user_metadata?.name === "string" ? user.user_metadata.name.trim().slice(0, 80) : "";
  if (given.length >= 2) return given;
  const mailbox = (user.email ?? "").split("@")[0].trim().slice(0, 80);
  return mailbox.length >= 2 ? mailbox : "Спикер";
}

export type ProfileRow = {
  id: string;
  owner_user_id: string;
  name: string;
  email: string;
  created_at: string;
  learned_at: string | null;
  preferences: Record<string, unknown> | null;
};
const profileColumns = "id, owner_user_id, name, email, created_at, learned_at, preferences";
export const rowToAccount = (row: ProfileRow): LocalAccount => ({
  id: row.id, ownerId: row.owner_user_id, name: row.name, email: row.email, createdAt: row.created_at,
  ...(row.learned_at ? { learnedAt: row.learned_at } : {}),
});
/** Only known string settings from the server reach this device. */
export function cloudPreferencesFrom(row: Pick<ProfileRow, "preferences">): Record<string, string> {
  return Object.fromEntries(Object.entries(row.preferences ?? {}).filter((entry): entry is [string, string] => cloudPreferences.includes(entry[0]) && typeof entry[1] === "string" && entry[1].length <= 200));
}

/** The oldest profile of this user; a first sign-in creates one with the user's ID. */
async function ownProfile(db: SupabaseClient, user: User): Promise<{ row: ProfileRow; created: boolean }> {
  const find = () => db.from("profiles").select(profileColumns).eq("owner_user_id", user.id).order("created_at").limit(1).maybeSingle<ProfileRow>();
  const found = await find();
  if (found.error) fail(found.error);
  if (found.data) return { row: found.data, created: false };
  const inserted = await db.from("profiles").insert({ id: user.id, owner_user_id: user.id, name: profileName(user), email: user.email ?? "" }).select(profileColumns).single<ProfileRow>();
  if (!inserted.error) return { row: inserted.data, created: true };
  // Another tab finished the same first sign-in a moment earlier.
  if (inserted.error.code !== "23505") fail(inserted.error);
  const again = await find();
  if (again.error || !again.data) fail(again.error ?? { message: "profile vanished" });
  return { row: again.data, created: false };
}

type ProfileStore = ReturnType<typeof profileStorage>;
/** Settings as the server last saw them, so an unchanged device never overwrites newer ones. */
const SYNCED = "axiompitch-cloud-preferences";
/** Always in cloudPreferences order, so equal settings serialize equally. */
const pick = (read: (name: string) => string | null | undefined): Record<string, string> =>
  Object.fromEntries(cloudPreferences.flatMap(name => { const value = read(name); return typeof value === "string" ? [[name, value]] : []; }));
const localPreferences = (storage: ProfileStore) => pick(name => storage.getItem(name));
export function cloudPreferencesChanged(account: Pick<LocalAccount, "id">): boolean {
  const storage = profileStorage(account.id);
  return storage.getItem(SYNCED) !== JSON.stringify(localPreferences(storage));
}

export type CloudEntry = { account: LocalAccount; created: boolean };
/** Signing in on a device takes the account's settings from the server. */
async function enter(db: SupabaseClient, user: User): Promise<CloudEntry> {
  const { row, created } = await ownProfile(db, user);
  const account = adoptAccount(rowToAccount(row));
  const storage = profileStorage(account.id);
  const remote = cloudPreferencesFrom(row);
  for (const [name, value] of Object.entries(remote)) storage.setItem(name, value);
  // Settings only this device had are then uploaded as a change.
  storage.setItem(SYNCED, JSON.stringify(pick(name => remote[name])));
  return { account, created };
}

/** `confirm` means Supabase sent a confirmation email and there is no session yet. */
export async function cloudSignUp(name: string, email: string, password: string): Promise<CloudEntry | { confirm: string }> {
  const db = await cloud();
  const { data, error } = await db.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: `${location.origin}/learn` } });
  if (error) fail(error);
  if (!data.session || !data.user) return { confirm: email };
  return enter(db, data.user);
}
export async function cloudSignIn(email: string, password: string): Promise<CloudEntry> {
  const db = await cloud();
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) fail(error);
  return enter(db, data.user);
}
/** Finishes a sign-in that arrived through an email link or an existing session. */
export async function cloudResume(user: User): Promise<CloudEntry> {
  return enter(await cloud(), user);
}
export async function cloudResetPassword(email: string) {
  const db = await cloud();
  const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/reset-password` });
  if (error) fail(error);
}
/** Works only inside the session that a password reset link opened. */
export async function cloudNewPassword(password: string): Promise<CloudEntry> {
  const db = await cloud();
  const { data, error } = await db.auth.updateUser({ password });
  if (error) fail(error);
  return enter(db, data.user);
}
/** "offline" keeps the cached account: the refresh token is still stored. */
export async function cloudSession(): Promise<User | null | "offline"> {
  const db = await cloud();
  const { data, error } = await db.auth.getSession();
  if (data.session) return data.session.user;
  return error?.name === "AuthRetryableFetchError" ? "offline" : null;
}
/** Signs out this browser only; other devices stay signed in. */
export async function cloudSignOut() {
  await (await cloud()).auth.signOut({ scope: "local" });
}
/** Reports a sign-out from another tab or an expired refresh token. */
export async function watchCloudSignOut(onSignedOut: () => void): Promise<() => void> {
  const { data } = (await cloud()).auth.onAuthStateChange(event => { if (event === "SIGNED_OUT") onSignedOut(); });
  return () => data.subscription.unsubscribe();
}

/** Name, learning date and portable settings; the server row is replaced as a whole. */
export async function saveCloudProfile(account: LocalAccount) {
  if (!account.ownerId) return;
  const storage = profileStorage(account.id);
  const preferences = localPreferences(storage);
  const { error } = await (await cloud()).from("profiles")
    .update({ name: account.name, learned_at: account.learnedAt ?? null, preferences, updated_at: new Date().toISOString() })
    .eq("id", account.id);
  if (error) fail(error);
  storage.setItem(SYNCED, JSON.stringify(preferences));
}

export const isSessionResult = (item: unknown): item is SessionResult => {
  const value = item as Partial<SessionResult> | null;
  return !!value && typeof value.id === "string" && typeof value.name === "string" && typeof value.startedAt === "string"
    && Number.isFinite(value.duration) && (value.mode === "rehearsal" || value.mode === "live")
    && Array.isArray(value.perSlide) && Array.isArray(value.slideTitles) && !!value.commands && !!value.corrections;
};
/** Newest ten, one entry per ID, the same limit as the browser history. */
export function mergeHistory(...lists: SessionResult[][]): SessionResult[] {
  return [...new Map(lists.flat().map(item => [item.id, item])).values()]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 10);
}
const sessionRow = (profileId: string, item: SessionResult) => ({
  id: item.id, profile_id: profileId, mode: item.mode, started_at: item.startedAt, duration: item.duration, result: item,
});
/** Repeated IDs are skipped, so retrying an upload never duplicates a rehearsal. */
export async function saveCloudSessions(account: Pick<LocalAccount, "id" | "ownerId">, items: SessionResult[]) {
  if (!account.ownerId || !items.length) return;
  const { error } = await (await cloud()).from("sessions")
    .upsert(items.map(item => sessionRow(account.id, item)), { onConflict: "id", ignoreDuplicates: true });
  if (error) fail(error);
}
/** Uploads what this device has not shared yet and returns the newest ten from every device. */
export async function syncCloudHistory(account: Pick<LocalAccount, "id" | "ownerId">, local: SessionResult[]): Promise<SessionResult[]> {
  await saveCloudSessions(account, local);
  const { data, error } = await (await cloud()).from("sessions").select("result")
    .eq("profile_id", account.id).order("started_at", { ascending: false }).limit(10);
  if (error) fail(error);
  return mergeHistory(local, data.map(row => row.result).filter(isSessionResult));
}
