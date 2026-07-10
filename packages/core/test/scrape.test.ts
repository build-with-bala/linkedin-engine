import { describe, it, expect } from "vitest";
import { linkedInPostedAt } from "../src/scrape.js";

describe("linkedInPostedAt", () => {
  it("decodes the real publish time from a post URL's activity id", () => {
    const url =
      "https://www.linkedin.com/posts/jane-doe-000000000_a-post-slug-activity-7469961505204187136-AbC1";
    const d = linkedInPostedAt(url);
    expect(d).toBeInstanceOf(Date);
    // activity 7469961505204187136 >> 22 => 2026-06-09T04:00:08Z
    expect(d!.toISOString().slice(0, 10)).toBe("2026-06-09");
  });

  it("handles the urn:li:activity form", () => {
    const d = linkedInPostedAt("https://www.linkedin.com/feed/update/urn:li:activity:7469961505204187136");
    expect(d?.getUTCFullYear()).toBe(2026);
  });

  it("returns null when there is no activity id", () => {
    expect(linkedInPostedAt("https://example.com/page")).toBeNull();
  });
});
