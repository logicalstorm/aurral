import { describe, it, expect } from "vitest";
import {
  normalizeBasePath,
  normalizeBasePathWithTrailingSlash,
  stripBasePath,
} from "./basePath.js";

describe("normalizeBasePath", () => {
  it("returns / for root", () => {
    expect(normalizeBasePath("/")).toBe("/");
  });

  it("strips trailing slash", () => {
    expect(normalizeBasePath("/app/")).toBe("/app");
  });

  it("adds leading slash", () => {
    expect(normalizeBasePath("app")).toBe("/app");
  });

  it("handles empty input as /", () => {
    expect(normalizeBasePath("")).toBe("/");
  });
});

describe("normalizeBasePathWithTrailingSlash", () => {
  it("returns / for root", () => {
    expect(normalizeBasePathWithTrailingSlash("/")).toBe("/");
  });

  it("adds trailing slash", () => {
    expect(normalizeBasePathWithTrailingSlash("/app")).toBe("/app/");
  });
});

describe("stripBasePath", () => {
  it("returns href unchanged when basePath is /", () => {
    expect(stripBasePath("/some/page", "/")).toBe("/some/page");
  });

  it("strips basePath prefix", () => {
    expect(stripBasePath("/app/page", "/app")).toBe("/page");
  });

  it("returns / when href equals basePath", () => {
    expect(stripBasePath("/app", "/app")).toBe("/");
  });

  it("returns href unchanged when basePath does not match", () => {
    expect(stripBasePath("/other/page", "/app")).toBe("/other/page");
  });
});
