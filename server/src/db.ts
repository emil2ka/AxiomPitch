import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { LocalAccount } from "../../src/lib/account.ts";
import type { SessionResult } from "../../src/lib/types.ts";

export type Presentation = {
  id: string;
  name: string;
  pageCount: number;
  size: number;
  notes: string[];
  createdAt: string;
};
export type StoredSession = SessionResult & {
  presentationId: string | null;
  savedAt: string;
};

type PresentationRow = {
  id: string;
  name: string;
  page_count: number;
  size: number;
  notes: string;
  created_at: string;
};

const toPresentation = (row: PresentationRow): Presentation => ({
  id: row.id,
  name: row.name,
  pageCount: row.page_count,
  size: row.size,
  notes: JSON.parse(row.notes) as string[],
  createdAt: row.created_at,
});

/** One SQLite file plus a folder of PDFs, both under the data directory. */
export class Store {
  readonly filesDir: string;
  private db: DatabaseSync;
  constructor(dataDir: string) {
    this.filesDir = join(dataDir, "presentations");
    mkdirSync(this.filesDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, "pitchflow.db"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS presentations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        page_count INTEGER NOT NULL,
        size INTEGER NOT NULL,
        notes TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        presentation_id TEXT REFERENCES presentations(id) ON DELETE SET NULL,
        mode TEXT NOT NULL,
        started_at TEXT NOT NULL,
        duration REAL NOT NULL,
        result TEXT NOT NULL,
        saved_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_by_start ON sessions (started_at DESC);
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
        created_at TEXT NOT NULL, learned_at TEXT,
        preferences TEXT NOT NULL DEFAULT '{}', workspace TEXT,
        updated_at TEXT NOT NULL
      );
    `);
    // Additive migration: old PDFs and results remain in the unassigned scope.
    for (const table of ["presentations", "sessions"]) {
      const columns = this.db.prepare(`PRAGMA table_info(${table})`).all();
      if (!columns.some(column => column.name === "profile_id"))
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN profile_id TEXT REFERENCES profiles(id)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS ${table}_by_profile ON ${table}(profile_id)`);
    }
  }

  listProfiles(): LocalAccount[] {
    return this.db.prepare("SELECT * FROM profiles ORDER BY updated_at DESC").all().map(row => ({
      id: String(row.id), name: String(row.name), email: String(row.email), createdAt: String(row.created_at),
      ...(row.learned_at ? { learnedAt: String(row.learned_at) } : {}),
    }));
  }
  getProfile(id: string) {
    const row = this.db.prepare("SELECT * FROM profiles WHERE id = ?").get(id);
    if (!row) return null;
    const account: LocalAccount = { id: String(row.id), name: String(row.name), email: String(row.email), createdAt: String(row.created_at), ...(row.learned_at ? { learnedAt: String(row.learned_at) } : {}) };
    const stats = this.db.prepare("SELECT COUNT(*) AS sessions, COALESCE(SUM(duration), 0) AS duration FROM sessions WHERE profile_id = ?").get(id)!;
    const decks = this.db.prepare("SELECT COUNT(*) AS presentations FROM presentations WHERE profile_id = ?").get(id)!;
    return { account, preferences: JSON.parse(String(row.preferences)) as Record<string, string>, workspace: row.workspace ? JSON.parse(String(row.workspace)) : null,
      stats: { sessions: Number(stats.sessions), duration: Number(stats.duration), presentations: Number(decks.presentations) } };
  }
  putProfile(account: LocalAccount) {
    this.db.prepare(`INSERT INTO profiles(id, name, email, created_at, learned_at, updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, email=excluded.email, learned_at=excluded.learned_at, updated_at=excluded.updated_at`)
      .run(account.id, account.name, account.email, account.createdAt, account.learnedAt ?? null, new Date().toISOString());
    return this.getProfile(account.id)!;
  }
  putPreferences(id: string, preferences: Record<string, string>) {
    this.db.prepare("UPDATE profiles SET preferences = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(preferences), new Date().toISOString(), id);
  }
  putWorkspace(id: string, workspace: { name: string; index: number; presentationId: string | null; kind?: "demo" | "pdf" }) {
    this.db.prepare("UPDATE profiles SET workspace = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(workspace), new Date().toISOString(), id);
  }
  linkLegacy(id: string, presentationId: string | null, sessionIds: string[]) {
    // Only records referenced by this browser's profile are migrated, once.
    if (presentationId) this.db.prepare("UPDATE presentations SET profile_id = ? WHERE id = ? AND profile_id IS NULL").run(id, presentationId);
    const link = this.db.prepare("UPDATE sessions SET profile_id = ? WHERE id = ? AND profile_id IS NULL");
    for (const sessionId of sessionIds) link.run(id, sessionId);
  }

  filePath(id: string) {
    return join(this.filesDir, `${id}.pdf`);
  }

  addPresentation(presentation: Presentation, profileId: string | null = null) {
    this.db
      .prepare(
        "INSERT INTO presentations (id, name, page_count, size, notes, created_at, profile_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        presentation.id,
        presentation.name,
        presentation.pageCount,
        presentation.size,
        JSON.stringify(presentation.notes),
        presentation.createdAt,
        profileId,
      );
  }

  listPresentations(profileId: string | null = null): Presentation[] {
    return (
      this.db
        .prepare("SELECT * FROM presentations WHERE profile_id IS ? ORDER BY created_at DESC")
        .all(profileId) as PresentationRow[]
    ).map(toPresentation);
  }

  getPresentation(id: string, profileId: string | null = null): Presentation | null {
    const row = this.db
      .prepare("SELECT * FROM presentations WHERE id = ? AND profile_id IS ?")
      .get(id, profileId) as PresentationRow | undefined;
    return row ? toPresentation(row) : null;
  }

  setNotes(id: string, notes: string[]) {
    this.db
      .prepare("UPDATE presentations SET notes = ? WHERE id = ?")
      .run(JSON.stringify(notes), id);
  }

  /** False when a session with this id is already stored. */
  addSession(session: StoredSession, profileId: string | null = null): boolean {
    const { presentationId, savedAt, ...result } = session;
    try {
      this.db
        .prepare(
          "INSERT INTO sessions (id, presentation_id, mode, started_at, duration, result, saved_at, profile_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          result.id,
          presentationId,
          result.mode,
          result.startedAt,
          result.duration,
          JSON.stringify(result),
          savedAt,
          profileId,
        );
      return true;
    } catch (error) {
      if (/UNIQUE|PRIMARY KEY/i.test(String(error))) return false;
      throw error;
    }
  }

  listSessions(limit: number, offset: number, profileId: string | null = null) {
    const rows = this.db
      .prepare(
        "SELECT result, presentation_id, saved_at FROM sessions WHERE profile_id IS ? ORDER BY started_at DESC, saved_at DESC LIMIT ? OFFSET ?",
      )
      .all(profileId, limit, offset) as Array<{
      result: string;
      presentation_id: string | null;
      saved_at: string;
    }>;
    const { total } = this.db
      .prepare("SELECT COUNT(*) AS total FROM sessions WHERE profile_id IS ?")
      .get(profileId) as { total: number };
    return {
      total,
      items: rows.map((row): StoredSession => ({
        ...(JSON.parse(row.result) as SessionResult),
        presentationId: row.presentation_id,
        savedAt: row.saved_at,
      })),
    };
  }

  /** Consistent, provider-neutral snapshot. PDFs are referenced by file manifest. */
  exportSnapshot() {
    this.db.exec("BEGIN");
    try {
      return {
        version: 1,
        exportedAt: new Date().toISOString(),
        profiles: this.db.prepare("SELECT * FROM profiles ORDER BY id").all().map(row => ({ ...row, preferences: JSON.parse(String(row.preferences)), workspace: row.workspace ? JSON.parse(String(row.workspace)) : null })),
        presentations: this.db.prepare("SELECT * FROM presentations ORDER BY id").all().map(row => ({ ...row, notes: JSON.parse(String(row.notes)), file: `${row.id}.pdf` })),
        sessions: this.db.prepare("SELECT * FROM sessions ORDER BY id").all().map(row => ({ ...row, result: JSON.parse(String(row.result)) })),
      };
    } finally { this.db.exec("COMMIT"); }
  }

  close() {
    if (this.db.isOpen) this.db.close();
  }
}
