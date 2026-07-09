import assert from "node:assert/strict";
import { UUID_REGEX } from "../../lib/uuid.js";

assert.equal(UUID_REGEX.test("902823"), false);
assert.equal(UUID_REGEX.test("525047bc-9f75-3ec2-b75f-c37b933c2bc4"), true);
console.log("spidarrMbid.check.js ok");
