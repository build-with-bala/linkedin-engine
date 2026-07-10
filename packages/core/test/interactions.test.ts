import { afterEach, describe, expect, it, vi } from "vitest";
import { commentKey, scrapeAndAnalyze, runInteractionsSweep } from "../src/interactions.js";
import { MemoryStore } from "../src/storage.js";
import { MockProvider, ProviderRegistry, type Provider } from "../src/providers/index.js";
import type { PostInput } from "../src/types.js";

const posted: PostInput = {
  id: "p1",
  title: "a shipped thing",
  type: "present",
  status: "posted",
  postedUrl: "https://www.linkedin.com/feed/update/urn:li:activity:7469961505204187136",
};

const html = `
  <html><body>
    <meta property="og:title" content="A shipped thing" />
    <p>the post body text</p>
    <a href="https://example.com/ref">ref</a>
    "numLikes": 120, "numComments": 2, "numShares": 3
    "commentary":{"text":"This resonated a lot, thank you"}
    "commentary":{"text":"How did you handle the rollback?"}
  </body></html>`;

const mockFetch = (body: string, ok = true) =>
  vi.fn().mockResolvedValue(new Response(body, { status: ok ? 200 : 500 }));

const opts = (store: MemoryStore, registry?: ProviderRegistry) => ({
  brand: { name: "Acme", inline: [{ label: "voice", content: "Plain." }] },
  store,
  providers: [{ name: "mock" }],
  registry: registry ?? new ProviderRegistry([new MockProvider()]),
});

afterEach(() => vi.unstubAllGlobals());

describe("commentKey", () => {
  it("is stable for the same text and differs across texts", () => {
    expect(commentKey("hello")).toBe(commentKey("hello"));
    expect(commentKey("hello")).not.toBe(commentKey("world"));
  });
});

describe("scrapeAndAnalyze", () => {
  it("records the scrape, metrics, and drafts a reply per new comment", async () => {
    vi.stubGlobal("fetch", mockFetch(html));
    const store = new MemoryStore([posted]);

    const r = await scrapeAndAnalyze(posted, opts(store));

    expect(r.ok).toBe(true);
    expect(r.commentsFound).toBe(2);
    expect(r.drafted).toBe(2);
    expect(r.summary).toBeTruthy();
    expect(r.links).toContain("https://example.com/ref");
    expect(store.metrics[0]).toMatchObject({ likes: 120, comments: 2, reposts: 3 });
    expect(store.comments.every((c) => c.status === "drafted")).toBe(true);
  });

  it("dedupes comments already seen in a previous sweep", async () => {
    vi.stubGlobal("fetch", mockFetch(html));
    const store = new MemoryStore([posted]);

    await scrapeAndAnalyze(posted, opts(store));
    const second = await scrapeAndAnalyze(posted, opts(store));

    expect(second.drafted).toBe(0);
    expect(store.comments).toHaveLength(2);
  });

  it("still records metrics when every model call fails", async () => {
    vi.stubGlobal("fetch", mockFetch(html));
    const dead: Provider = {
      name: "dead",
      async isAvailable() {
        return true;
      },
      async complete() {
        throw new Error("provider down");
      },
    };
    const store = new MemoryStore([posted]);

    const r = await scrapeAndAnalyze(posted, {
      ...opts(store, new ProviderRegistry([dead])),
      providers: [{ name: "dead" }],
    });

    expect(r.summary).toBeNull();
    expect(store.metrics[0]).toMatchObject({ likes: 120 });
    expect(store.comments.every((c) => c.draftReply === null && c.status === "new")).toBe(true);
  });

  it("refuses a post with no live URL", async () => {
    const store = new MemoryStore();
    await expect(
      scrapeAndAnalyze({ ...posted, postedUrl: null }, opts(store)),
    ).rejects.toThrow(/no live URL/);
  });
});

describe("runInteractionsSweep", () => {
  it("returns a failure row per post instead of aborting the whole sweep", async () => {
    vi.stubGlobal("fetch", mockFetch(html));
    const store = new MemoryStore([posted, { ...posted, id: "p2", postedUrl: null }]);

    const { checked, results } = await runInteractionsSweep({ ...opts(store), days: 7 });

    expect(checked).toBe(1); // p2 has no URL, so listPostedSince excludes it
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
  });
});
