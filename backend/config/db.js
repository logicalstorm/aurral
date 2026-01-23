import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { defaultData } from "./constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "db.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const adapter = new JSONFile(DB_PATH);
export const db = new Low(adapter, defaultData);

try {
  await db.read();
} catch (error) {
  console.error("Error reading database, using defaults:", error.message);
  db.data = defaultData;
}

if (!db.data) {
  db.data = defaultData;
}

if (!db.data.settings) {
  db.data.settings = defaultData.settings;
}

if (!db.data.settings.integrations) {
  db.data.settings.integrations = {
    navidrome: { url: "", username: "", password: "" },
    lastfm: { username: "" },
    slskd: { url: "", apiKey: "" },
    musicbrainz: { email: "" },
    general: { authUser: "", authPassword: "" }
  };
  try {
    await db.write();
  } catch (error) {
    console.error("Error writing database:", error.message);
  }
}

if (db.data.settings.integrations && !db.data.settings.integrations.musicbrainz) {
  db.data.settings.integrations.musicbrainz = { email: "" };
  try {
    await db.write();
  } catch (error) {
    console.error("Error writing database:", error.message);
  }
}
