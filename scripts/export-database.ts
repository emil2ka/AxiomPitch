import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../server/src/db.ts";
const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(process.argv[2] || `${root}/work/database-export/snapshot.json`);
const store = new Store(process.env.PITCHFLOW_DATA_DIR || `${root}/server/data`);
try {
  const snapshot = store.exportSnapshot();
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
  console.log(`Экспорт: ${output}\nPDF остаются в ${store.filesDir}; поле file связывает записи с файлами.`);
} finally { store.close(); }
