import dotenv from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const patchConsoleWithTimestamp = () => {
  if (globalThis.__aurralConsoleTimestampPatched) return;
  globalThis.__aurralConsoleTimestampPatched = true;
  const formatLogTimestamp = () =>
    new Date().toISOString().replace("T", " ").slice(0, 19);
  for (const method of ["log", "info", "warn", "error", "debug"]) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      const timestamp = `[${formatLogTimestamp()}]`;
      if (args.length === 0) {
        original(timestamp);
        return;
      }
      const [first, ...rest] = args;
      if (typeof first === "string") {
        original(`${timestamp} ${first}`, ...rest);
        return;
      }
      original(timestamp, first, ...rest);
    };
  }
};

patchConsoleWithTimestamp();

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env") });
