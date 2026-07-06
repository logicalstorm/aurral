import { isVerboseConsoleEnabled } from "../config/constants.js";

let verboseEnabled = isVerboseConsoleEnabled();

function log(level, category, message, data = {}) {
  if (level === "debug" && !verboseEnabled) return;
  const line = `[${level}] [${category}] ${message}`;
  const keys = Object.keys(data).length;
  if (level === "error") {
    keys > 0 ? console.error(line, data) : console.error(line);
  } else if (level === "warn") {
    keys > 0 ? console.warn(line, data) : console.warn(line);
  } else {
    keys > 0 ? console.log(line, data) : console.log(line);
  }
}

export const logger = {
  debug: (category, message, data) => log("debug", category, message, data),
  info: (category, message, data) => log("info", category, message, data),
  warn: (category, message, data) => log("warn", category, message, data),
  error: (category, message, data) => log("error", category, message, data),
};
