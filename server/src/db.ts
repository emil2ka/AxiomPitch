import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
    `);
  }

  filePath(id: string) {
    return join(this.filesDir, `${id}.pdf`);
  }

  addPresentation(presentation: Presentation) {
    this.db
      .prepare(
        "INSERT INTO presentations (id, name, page_count, size, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        presentation.id,
        presentation.name,
        presentation.pageCount,
        presentation.size,
        JSON.stringify(presentation.notes),
        presentation.createdAt,
      );
  }

  listPresentations(): Presentation[] {
    return (
      this.db
        .prepare("SELECT * FROM presentations ORDER BY created_at DESC")
        .all() as PresentationRow[]
    ).map(toPresentation);
  }

  getPresentation(id: string): Presentation | null {
    const row = this.db
      .prepare("SELECT * FROM presentations WHERE id = ?")
      .get(id) as PresentationRow | undefined;
    return row ? toPresentation(row) : null;
  }

  setNotes(id: string, notes: string[]) {
    this.db
      .prepare("UPDATE presentations SET notes = ? WHERE id = ?")
      .run(JSON.stringify(notes), id);
  }

  /** False when a session with this id is already stored. */
  addSession(session: StoredSession): boolean {
    const { presentationId, savedAt, ...result } = session;
    try {
      this.db
        .prepare(
          "INSERT INTO sessions (id, presentation_id, mode, started_at, duration, result, saved_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          result.id,
          presentationId,
          result.mode,
          result.startedAt,
          result.duration,
          JSON.stringify(result),
          savedAt,
        );
      return true;
    } catch (error) {
      if (/UNIQUE|PRIMARY KEY/i.test(String(error))) return false;
      throw error;
    }
  }

  listSessions(limit: number, offset: number) {
    const rows = this.db
      .prepare(
        "SELECT result, presentation_id, saved_at FROM sessions ORDER BY started_at DESC, saved_at DESC LIMIT ? OFFSET ?",
      )
      .all(limit, offset) as Array<{
      result: string;
      presentation_id: string | null;
      saved_at: string;
    }>;
    const { total } = this.db
      .prepare("SELECT COUNT(*) AS total FROM sessions")
      .get() as { total: number };
    return {
      total,
      items: rows.map(
        (row): StoredSession => ({
          ...(JSON.parse(row.result) as SessionResult),
          presentationId: row.presentation_id,
          savedAt: row.saved_at,
        }),
      ),
    };
  }

  close() {
    if (this.db.isOpen) this.db.close();
  }
}
