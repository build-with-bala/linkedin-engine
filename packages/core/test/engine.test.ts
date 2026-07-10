import { describe, expect, it } from "vitest";
import { LinkedInEngine } from "../src/engine.js";
import { MemoryStore } from "../src/storage.js";
import { MockProvider, ProviderRegistry } from "../src/providers/index.js";
import type { PostInput } from "../src/types.js";

const post: PostInput = {
  id: "p1",
  title: "the migration that took three attempts",
  type: "past",
  status: "idea",
  pillar: "Engineering",
};

const makeEngine = (store?: MemoryStore) =>
  new LinkedInEngine({
    brand: { name: "Acme", inline: [{ label: "voice", content: "Plain. Specific. No hype." }] },
    store,
    registry: new ProviderRegistry([new MockProvider()]),
    defaultProviders: [{ name: "mock" }],
  });

describe("LinkedInEngine", () => {
  it("generates hooks and persists them", async () => {
    const store = new MemoryStore([post]);
    const r = await makeEngine(store).generate("p1", { stage: "hooks", hookCount: 5 });

    expect(r.provider).toBe("mock");
    expect(r.hooks).toHaveLength(5);
    expect(store.hooks.get("p1")).toHaveLength(5);
    expect(store.generations).toHaveLength(1);
  });

  it("generates a body, promotes idea → draft, and seeds hooks when there are none", async () => {
    const store = new MemoryStore([post]);
    const r = await makeEngine(store).generate("p1", { stage: "body" });

    expect(r.body).toMatch(/It started with/);
    expect(r.body).not.toMatch(/HOOK OPTIONS|NOTES/);
    expect(store.posts.get("p1")!.status).toBe("draft");
    expect(store.hooks.get("p1")!.length).toBeGreaterThan(0);
  });

  it("does not overwrite existing hooks when generating a body", async () => {
    const store = new MemoryStore([post]);
    await store.saveHooks("p1", ["a chosen hook"], "human");
    await makeEngine(store).generate("p1", { stage: "body" });
    expect(store.hooks.get("p1")).toEqual(["a chosen hook"]);
  });

  it("extracts the media prompt without the MEDIA PROMPT label", async () => {
    const store = new MemoryStore([post]);
    const r = await makeEngine(store).generate("p1", { stage: "media" });
    expect(r.mediaPrompt).not.toMatch(/^MEDIA PROMPT/);
    expect(store.media[0].prompt).toBe(r.mediaPrompt);
  });

  it("runs statelessly via generateFor with no store at all", async () => {
    const r = await makeEngine().generateFor(post, { stage: "hooks", hookCount: 3 });
    expect(r.hooks).toHaveLength(3);
    expect(r.runId).toBeUndefined();
  });

  it("reports declared-but-unreadable brand files instead of failing silently", async () => {
    const engine = new LinkedInEngine({
      brand: { name: "Acme", baseDir: "/nonexistent", files: ["voice.md"] },
      registry: new ProviderRegistry([new MockProvider()]),
      defaultProviders: [{ name: "mock" }],
    });
    const r = await engine.generateFor(post, { stage: "hooks" });
    expect(r.missingSources).toEqual(["voice.md"]);
  });

  it("requires a provider chain", async () => {
    const engine = new LinkedInEngine({
      brand: { name: "Acme" },
      registry: new ProviderRegistry([new MockProvider()]),
    });
    await expect(engine.generateFor(post, { stage: "hooks" })).rejects.toThrow(/no providers/);
  });

  it("throws a clear error for an unknown post id", async () => {
    await expect(makeEngine(new MemoryStore()).generate("nope", { stage: "hooks" })).rejects.toThrow(
      /Post not found/,
    );
  });
});
