import dotenv from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const TRUE_ENV_VALUES = new Set(["1", "true", "yes", "on", "verbose", "debug"]);

export const isVerboseConsoleEnabled = (env = process.env) =>
  TRUE_ENV_VALUES.has(
    String(env.AURRAL_VERBOSE_LOGS || "").trim().toLowerCase(),
  );

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env"), quiet: true });
