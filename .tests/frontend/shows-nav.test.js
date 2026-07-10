import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeShowsFilter,
  DEFAULT_SHOWS_FILTER,
} from "../../frontend/src/navigation/showsNavConfig.js";

test("normalizeShowsFilter falls back to all", () => {
  assert.equal(normalizeShowsFilter(undefined), DEFAULT_SHOWS_FILTER);
  assert.equal(normalizeShowsFilter("bogus"), "all");
  assert.equal(normalizeShowsFilter("library"), "library");
  assert.equal(normalizeShowsFilter("discover"), "discover");
});
