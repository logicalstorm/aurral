import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import fs from "fs";
import path from "path";
import { defaultData } from "./constants.js";

const DATA_DIR = "data";
const DB_PATH = path.join(DATA_DIR, "db.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const adapter = new JSONFile(DB_PATH);
export const db = new Low(adapter, defaultData);
await db.read();

if (!db.data.settings.integrations) {
  db.data.settings.integrations = {
    navidrome: { url: "", username: "", password: "" },
    lastfm: { username: "" },
    lidarr: { url: "", apiKey: "" },
    musicbrainz: { email: "" },
    general: { authUser: "", authPassword: "" }
  };
  await db.write();
}

if (db.data.settings.integrations && !db.data.settings.integrations.musicbrainz) {
  db.data.settings.integrations.musicbrainz = { email: "" };
  await db.write();
}
