/**
 * Embedding the engine in a larger product.
 *
 * The two things that make this multi-tenant-safe:
 *   1. keys arrive per call, not from env
 *   2. storage is an interface you implement against your own schema
 */
import {
  LinkedInEngine,
  type PostInput,
  type Store,
} from "@linkedin-engine/core";

// 1. Back the engine with YOUR database. Only getPost is required.
const store: Store = {
  async getPost(id) {
    // return await db.post.findUnique({ where: { id } });
    return { id, title: "the migration that took three attempts", type: "past", status: "idea" };
  },
  async updatePost(id, patch) {
    // await db.post.update({ where: { id }, data: patch });
  },
  async saveHooks(postId, hooks) {
    // await db.hook.createMany({ data: hooks.map((text) => ({ postId, text })) });
  },
  async countHooks() {
    return 0;
  },
};

// 2. Your brand pack: files on disk, or literal blocks straight from your DB.
const engine = new LinkedInEngine({
  brand: {
    name: "Acme",
    inline: [
      { label: "voice", content: "Plain. Specific. Never hype. Short sentences." },
      { label: "guardrails", content: "Never claim revenue numbers. Never name clients." },
    ],
  },
  store,
  chain: {
    retriesPerProvider: 2,
    onAttempt: (i) => console.log(`[llm] ${i.provider} attempt=${i.attempt} ok=${i.ok}`),
  },
});

// 3. Per-request keys + an ordered fallback chain.
const result = await engine.generate("post_123", {
  stage: "hooks",
  hookCount: 10,
  providers: [
    { name: "anthropic", apiKey: process.env.TENANT_ANTHROPIC_KEY, model: "claude-sonnet-5" },
    { name: "openai", apiKey: process.env.TENANT_OPENAI_KEY, model: "gpt-4o" }, // fallback
    { name: "mock" }, // last resort so a demo never hard-fails
  ],
});

console.log(`served by ${result.provider} in ${result.latencyMs}ms`);
console.log(result.hooks);
