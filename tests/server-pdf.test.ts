import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { json, makePdf, startServer } from "./support.ts";

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => {
  server = await startServer();
});
after(() => server.stop());

function upload(
  bytes: Uint8Array,
  name = "deck.pdf",
  extra?: [string, string],
) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/pdf" }), name);
  if (extra) form.append(...extra);
  return fetch(`${server.base}/api/presentations`, {
    method: "POST",
    body: form,
  });
}

test("a file that is not a PDF is rejected with a short Russian reason", async () => {
  const response = await upload(new TextEncoder().encode("не презентация"));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "Это не PDF.");
});

test("a PDF over 30 MB is rejected", async () => {
  const bytes = new Uint8Array(30 * 1024 * 1024 + 1).fill(32);
  bytes.set(new TextEncoder().encode("%PDF-1.4\n"));
  const response = await upload(bytes);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /30 МБ/);
});

test("a document longer than 60 pages is rejected by the server's own count", async () => {
  const response = await upload(makePdf(61), "long.pdf", ["pageCount", "3"]);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /61 страниц/);
});

test("a small PDF is stored, counted by the server and served back to localhost", async () => {
  const bytes = makePdf(3);
  // The client-side count is a lie and must be ignored.
  const response = await upload(bytes, "Первый питч.pdf", ["pageCount", "40"]);
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.name, "Первый питч");
  assert.equal(created.pageCount, 3);
  assert.equal(
    created.url,
    `${server.base}/api/presentations/${created.id}/file`,
  );

  const list = await (await fetch(`${server.base}/api/presentations`)).json();
  assert.deepEqual(
    list.items.map((item: { id: string }) => item.id),
    [created.id],
  );
  const file = await fetch(created.url);
  assert.equal(file.headers.get("content-type"), "application/pdf");
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);

  const notesUrl = `${server.base}/api/presentations/${created.id}/notes`;
  const short = await fetch(notesUrl, json({ notes: ["одна"] }, "PATCH"));
  assert.equal(short.status, 400);
  const saved = await fetch(
    notesUrl,
    json({ notes: ["а", "б", "в"] }, "PATCH"),
  );
  assert.equal(saved.status, 200);
  const again = await (
    await fetch(`${server.base}/api/presentations/${created.id}`)
  ).json();
  assert.deepEqual(again.notes, ["а", "б", "в"]);
});
