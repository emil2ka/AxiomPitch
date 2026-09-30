import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/src/db.ts";
import { startServer, makePdf, json } from "./support.ts";

const account = (name: string) => ({ id: randomUUID(), name, email: "", createdAt: new Date().toISOString() });
const scoped = (id: string, init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "x-axiom-profile": id } });
async function upload(base: string, profile?: string) {
  const form = new FormData(); form.set("file", new File([makePdf(2)], "pitch.pdf", { type: "application/pdf" }));
  const response = await fetch(`${base}/api/presentations`, profile ? scoped(profile, { method: "POST", body: form }) : { method: "POST", body: form });
  assert.equal(response.status, 201); return response.json();
}
const result = () => ({ id: randomUUID(), name: "Питч", startedAt: new Date().toISOString(), duration: 3000, perSlide: [1000, 2000], slideTitles: ["Один", "Два"], commands: { next: 1, previous: 0, toggle: 0 }, corrections: {}, mode: "rehearsal" });

test("database profiles own PDFs, notes, results and preferences without cross-profile access", async () => {
  const server = await startServer(); const a = account("Алия"), b = account("Бек");
  try {
    for (const profile of [a, b]) assert.equal((await fetch(`${server.base}/api/profiles/${profile.id}`, json(profile, "PUT"))).status, 200);
    const deck = await upload(server.base, a.id);
    assert.equal((await fetch(`${server.base}/api/presentations/${deck.id}`, scoped(b.id))).status, 404);
    assert.equal((await fetch(deck.url, scoped(b.id))).status, 404);
    assert.equal((await fetch(deck.url)).status, 200);
    const notes = json({ notes: ["Новая заметка", "Финал"] }, "PATCH");
    assert.equal((await fetch(`${server.base}/api/presentations/${deck.id}/notes`, scoped(b.id, notes))).status, 404);
    assert.equal((await fetch(`${server.base}/api/presentations/${deck.id}/notes`, scoped(a.id, notes))).status, 200);
    assert.equal((await fetch(`${server.base}/api/sessions`, scoped(b.id, json({ ...result(), presentationId: deck.id })))).status, 400);
    assert.equal((await fetch(`${server.base}/api/sessions`, scoped(a.id, json({ ...result(), presentationId: deck.id })))).status, 201);
    assert.equal((await (await fetch(`${server.base}/api/sessions`, scoped(a.id))).json()).total, 1);
    assert.equal((await (await fetch(`${server.base}/api/sessions`, scoped(b.id))).json()).total, 0);
    assert.equal((await (await fetch(`${server.base}/api/sessions`)).json()).total, 0);
    assert.equal((await fetch(`${server.base}/api/profiles/${a.id}/preferences`, json({ "axiompitch-notch-scale": "1.2" }, "PATCH"))).status, 200);
    assert.equal((await fetch(`${server.base}/api/profiles/${a.id}/workspace`, json({ presentationId: deck.id, index: 1, name: "Питч", kind: "pdf" }, "PUT"))).status, 200);
    const profile = await (await fetch(`${server.base}/api/profiles/${a.id}`)).json();
    assert.equal(profile.preferences["axiompitch-notch-scale"], "1.2"); assert.equal(profile.workspace.index, 1); assert.equal(profile.workspace.kind, "pdf"); assert.equal(profile.stats.sessions, 1); assert.equal(profile.stats.duration, 3000);
    assert.deepEqual((await (await fetch(`${server.base}/api/profiles/${b.id}`)).json()).preferences, {});
    assert.equal((await fetch(`${server.base}/api/profiles/${b.id}/workspace`, json({ presentationId: null, index: 0, name: "Питч", kind: "unknown" }, "PUT"))).status, 400);
  } finally { await server.stop(); }
});
test("legacy record adoption is scoped and never reassigns another profile's records", async () => {
  const server = await startServer(); const a = account("Алия"), b = account("Бек");
  try {
    const deck = await upload(server.base); const session = result();
    await fetch(`${server.base}/api/sessions`, json({ ...session, presentationId: deck.id }));
    for (const profile of [a, b]) await fetch(`${server.base}/api/profiles/${profile.id}`, json(profile, "PUT"));
    for (const profile of [a, b]) assert.equal((await fetch(`${server.base}/api/profiles/${profile.id}/migrate`, json({ presentationId: deck.id, sessionIds: [session.id] }))).status, 200);
    assert.ok(server.app.store.getPresentation(deck.id, a.id)); assert.equal(server.app.store.getPresentation(deck.id, b.id), null);
    assert.equal(server.app.store.listSessions(10, 0, a.id).total, 1); assert.equal(server.app.store.listSessions(10, 0, b.id).total, 0);
    assert.equal((await fetch(`${server.base}/api/profiles/${b.id}/workspace`, json({ presentationId: deck.id, name: "Чужое", index: 0 }, "PUT"))).status, 404);
    assert.equal((await fetch(`${server.base}/api/presentations`, scoped(randomUUID()))).status, 409);
    assert.equal((await fetch(`${server.base}/api/profiles/broken`, json(a, "PUT"))).status, 400);
  } finally { await server.stop(); }
});


test("profile data survives restart and export retains owned and unassigned records", () => {
  const dir = mkdtempSync(join(tmpdir(), "axiom-profile-persistence-"));
  const a = account("Алия"); let store = new Store(dir);
  try {
    store.putProfile(a);
    store.putPreferences(a.id, { "axiompitch-notch-scale": "1.2" });
    const deck = { id: randomUUID(), name: "Питч", pageCount: 2, size: 100, notes: ["Вступление", "Финал"], createdAt: a.createdAt };
    store.addPresentation(deck, a.id);
    store.addPresentation({ ...deck, id: "legacy-deck" });
    store.putWorkspace(a.id, { presentationId: deck.id, index: 1, name: "Питч" });
    const session = { ...result(), mode: "rehearsal" as const, presentationId: deck.id, savedAt: a.createdAt };
    store.addSession(session, a.id);
    store.close(); store = new Store(dir);
    assert.equal(store.getProfile(a.id)?.preferences["axiompitch-notch-scale"], "1.2");
    assert.equal(store.getProfile(a.id)?.workspace.index, 1);
    assert.equal(store.listSessions(10, 0, a.id).total, 1);
    const snapshot = store.exportSnapshot();
    assert.equal(snapshot.version, 1); assert.equal(snapshot.profiles.length, 1);
    assert.equal(snapshot.presentations.length, 2); assert.equal(snapshot.sessions.length, 1);
    assert.deepEqual(snapshot.presentations.find(item => item.id === deck.id)?.notes, deck.notes);
    assert.equal(snapshot.presentations.find(item => item.id === "legacy-deck")?.profile_id, null);
    assert.equal(snapshot.sessions[0].profile_id, a.id);
    assert.deepEqual(snapshot.sessions[0].result, resultFromStored(session));
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
function resultFromStored(session: ReturnType<typeof result> & { presentationId: string; savedAt: string }) {
  const { presentationId: _presentationId, savedAt: _savedAt, ...value } = session; return value;
}
