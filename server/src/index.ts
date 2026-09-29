import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";

const port = Number(process.env.PITCHFLOW_PORT) || 8787;
const dataDir =
  process.env.PITCHFLOW_DATA_DIR ||
  fileURLToPath(new URL("../data", import.meta.url));

const app = createApp({ dataDir });
try {
  await app.listen(port);
} catch (error) {
  console.error(
    (error as NodeJS.ErrnoException).code === "EADDRINUSE"
      ? `Порт ${port} занят: мост уже запущен или порт нужен другой программе.`
      : error,
  );
  process.exit(1);
}
console.log(`PitchFlow bridge: http://127.0.0.1:${port} · данные: ${dataDir}`);

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
