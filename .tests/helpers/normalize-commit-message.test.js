import test from "node:test";
import assert from "node:assert/strict";

import {
  inferCommitTypeFromBranch,
  normalizeCommitMessage,
} from "../../scripts/normalize-commit-message.js";

test("infers commit types from supported branch names", () => {
  assert.equal(inferCommitTypeFromBranch("feat/listenbrainz-support"), "feat");
  assert.equal(inferCommitTypeFromBranch("feature/listenbrainz-support"), "feat");
  assert.equal(inferCommitTypeFromBranch("fix/login-loop"), "fix");
  assert.equal(inferCommitTypeFromBranch("bugfix/login-loop"), "fix");
  assert.equal(inferCommitTypeFromBranch("hotfix/crash-on-submit"), "fix");
  assert.equal(inferCommitTypeFromBranch("refactor/discovery-cache"), "refactor");
  assert.equal(inferCommitTypeFromBranch("chore/update-deps"), "chore");
  assert.equal(inferCommitTypeFromBranch("docs/contributing"), "docs");
  assert.equal(inferCommitTypeFromBranch("ci/release-pipeline"), "ci");
  assert.equal(inferCommitTypeFromBranch("main"), null);
});

test("normalizes plain commit subjects using the branch type", () => {
  const message = [
    "Add ListenBrainz listening history support",
    "",
    "- Generalize per-user listening history settings",
  ].join("\n");

  assert.equal(
    normalizeCommitMessage(message, "feat/103-listenbrainz-support"),
    [
      "feat: Add ListenBrainz listening history support",
      "",
      "- Generalize per-user listening history settings",
      "",
    ].join("\n"),
  );

  assert.equal(
    normalizeCommitMessage(message, "feature/103-listenbrainz-support"),
    [
      "feat: Add ListenBrainz listening history support",
      "",
      "- Generalize per-user listening history settings",
      "",
    ].join("\n"),
  );
});

test("leaves existing conventional commits unchanged", () => {
  const message = "feat: add ListenBrainz listening history support\n";
  assert.equal(
    normalizeCommitMessage(message, "feat/103-listenbrainz-support"),
    message,
  );
});

test("leaves unsupported branches unchanged", () => {
  const message = "Add ListenBrainz listening history support\n";
  assert.equal(normalizeCommitMessage(message, "test"), message);
});
