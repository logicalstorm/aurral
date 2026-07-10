import test from "node:test";
import assert from "node:assert/strict";

import { resolveNextRelease } from "../../lib/release-version.js";

const cases = [
  {
    name: "next stable patch from latest stable tag",
    input: {
      branch: "main",
      allTags: ["v1.76.0", "v1.75.0", "v1.76.1-test.2"],
    },
    expected: {
      tag: "v1.76.1",
      version: "1.76.1",
      channel: "stable",
      isPrerelease: false,
      makeLatest: true,
      reusedExistingTag: false,
    },
  },
  {
    name: "first test prerelease from latest stable tag",
    input: { branch: "test", allTags: ["v1.76.0", "v1.75.0"] },
    expected: {
      tag: "v1.76.1-test.1",
      version: "1.76.1-test.1",
      channel: "test",
      isPrerelease: true,
      makeLatest: false,
      reusedExistingTag: false,
    },
  },
  {
    name: "increments existing test prereleases for next stable patch",
    input: {
      branch: "test",
      allTags: ["v1.76.0", "v1.76.1-test.1", "v1.76.1-test.2", "v1.75.9"],
    },
    expected: {
      tag: "v1.76.1-test.3",
      version: "1.76.1-test.3",
      channel: "test",
      isPrerelease: true,
      makeLatest: false,
      reusedExistingTag: false,
    },
  },
  {
    name: "resets test prerelease base after stable release ships",
    input: {
      branch: "test",
      allTags: ["v1.76.1", "v1.76.1-test.3", "v1.76.0"],
    },
    expected: {
      tag: "v1.76.2-test.1",
      version: "1.76.2-test.1",
      channel: "test",
      isPrerelease: true,
      makeLatest: false,
      reusedExistingTag: false,
    },
  },
  {
    name: "reuses an existing head tag on reruns",
    input: {
      branch: "main",
      allTags: ["v1.76.1", "v1.76.0"],
      headTags: ["v1.76.1"],
    },
    expected: {
      tag: "v1.76.1",
      version: "1.76.1",
      channel: "stable",
      isPrerelease: false,
      makeLatest: true,
      reusedExistingTag: true,
    },
  },
  {
    name: "first dev prerelease from latest stable tag",
    input: { branch: "dev", allTags: ["v1.76.0", "v1.75.0"] },
    expected: {
      tag: "v1.76.1-dev.1",
      version: "1.76.1-dev.1",
      channel: "dev",
      isPrerelease: true,
      makeLatest: false,
      reusedExistingTag: false,
    },
  },
  {
    name: "increments existing dev prereleases independently of test",
    input: {
      branch: "dev",
      allTags: [
        "v1.76.0",
        "v1.76.1-test.1",
        "v1.76.1-test.2",
        "v1.76.1-dev.1",
      ],
    },
    expected: {
      tag: "v1.76.1-dev.2",
      version: "1.76.1-dev.2",
      channel: "dev",
      isPrerelease: true,
      makeLatest: false,
      reusedExistingTag: false,
    },
  },
  {
    name: "ignores malformed tags and can bootstrap",
    input: {
      branch: "main",
      allTags: ["nightly-build", "release-foo"],
      initialStableVersion: "1.0.0",
    },
    expected: {
      tag: "v1.0.1",
      version: "1.0.1",
      channel: "stable",
      isPrerelease: false,
      makeLatest: true,
      reusedExistingTag: false,
    },
  },
];

for (const { name, input, expected } of cases) {
  test(`resolveNextRelease ${name}`, () => {
    assert.deepEqual(resolveNextRelease(input), expected);
  });
}
