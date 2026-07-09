import test from "node:test";
import assert from "node:assert/strict";
import { LidarrClient } from "../../backend/services/lidarrClient.js";

test("isCircuitOpen returns stale GET cache instead of throwing", async () => {
  const client = new LidarrClient();
  client.config = { url: "http://localhost:8686", apiKey: "test", circuitDisabled: false };
  client._circuitOpen = true;
  client._circuitOpenedAt = Date.now();
  client._artistListCache = { data: [{ id: 1, artistName: "Test" }], at: 0 };

  assert.equal(client.isCircuitOpen(), true);
  const artists = await client.request("/artist", "GET", null, true);
  assert.equal(artists.length, 1);
  assert.equal(artists[0].artistName, "Test");
});
