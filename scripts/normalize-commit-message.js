import fs from "fs";
import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const CONVENTIONAL_HEADER_RE =
  /^(feat|fix|refactor|chore|docs|ci)(\([a-z0-9-]+\))?(!)?: .+/;

export function inferCommitTypeFromBranch(branchName) {
  const branch = String(branchName || "").trim().toLowerCase();
  if (branch.startsWith("feat/")) return "feat";
  if (branch.startsWith("fix/")) return "fix";
  if (branch.startsWith("hotfix/")) return "fix";
  if (branch.startsWith("refactor/")) return "refactor";
  if (branch.startsWith("chore/")) return "chore";
  if (branch.startsWith("docs/")) return "docs";
  if (branch.startsWith("ci/")) return "ci";
  return null;
}

export function normalizeCommitMessage(content, branchName) {
  const text = String(content || "");
  const lines = text.split(/\r?\n/);
  const header = String(lines[0] || "").trim();
  if (!header) return text;

  if (
    CONVENTIONAL_HEADER_RE.test(header) ||
    header.startsWith("Merge ") ||
    header.startsWith("Revert ")
  ) {
    return text;
  }

  const type = inferCommitTypeFromBranch(branchName);
  if (!type) return text;

  lines[0] = `${type}: ${header}`;
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

function getCurrentBranch() {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function runCli() {
  const commitMsgPath = process.argv[2];
  if (!commitMsgPath) process.exit(0);

  const original = fs.readFileSync(commitMsgPath, "utf8");
  const normalized = normalizeCommitMessage(original, getCurrentBranch());
  if (normalized !== original) {
    fs.writeFileSync(commitMsgPath, normalized, "utf8");
  }
}

const isDirectRun =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  runCli();
}
