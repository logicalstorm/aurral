const { execFileSync } = require("node:child_process");

function getCurrentBranch() {
  if (process.env.GITHUB_REF_NAME) {
    return process.env.GITHUB_REF_NAME;
  }

  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

const plugins = [
  [
    "@semantic-release/commit-analyzer",
    {
      releaseRules: [{ type: "refactor", release: "patch" }],
    },
  ],
  "@semantic-release/release-notes-generator",
  ["@semantic-release/npm", { npmPublish: false }],
  [
    "@semantic-release/git",
    {
      assets: ["package.json", "package-lock.json"],
      message: "chore(release): ${nextRelease.version} [skip ci]",
    },
  ],
];

if (getCurrentBranch() === "main") {
  plugins.push("@semantic-release/github");
}

module.exports = {
  branches: ["main", { name: "test", prerelease: "test" }],
  plugins,
};
