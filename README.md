# linkedin-engine

A provider-agnostic LinkedIn content engine: **generate** posts (hooks, body, media concepts) from a brand context pack, **scrape** live posts for engagement metrics, and **draft on-brand replies** to new comments.

Extracted from a working Next.js app and repackaged so it can be embedded in a larger product: the model layer is pluggable per request, and persistence is an interface you implement.

```
packages/
  core/     ← the library: providers, generation, scraping, interactions, formatting
  server/   ← optional REST service + Dockerfile
  cli/      ← npx linkedin-engine generate …
examples/
  embed/    ← wiring core into your own app + database
```

## Install

```bash
pnpm install
pnpm build
pnpm test          # 46 tests
```

Requires Node ≥ 20.

## The two design decisions

**1. Credentials arrive per call, never from env.** The core library does not read `process.env`. A provider chain is an argument. That is what makes it safe to serve two tenants with two different API keys from one process.

**2. Storage is an interface.** The original code called Prisma directly from the orchestrator, welding it to one schema. Here the engine depends on a `Store` interface with exactly one required method (`getPost`). Back it with Prisma, Drizzle, Mongo — or nothing at all, and call `generateFor(post, …)` statelessly.

## Quick start (library)

```ts
import { LinkedInEngine } from "@linkedin-engine/core";

const engine = new LinkedInEngine({
  brand: {
    name: "Acme",
    // Files on disk…
    baseDir: "./brand",
    files: ["voice.md", "guardrails.md", "pillars.md"],
    // …or literal blocks straight from your database:
    inline: [{ label: "voice", content: "Plain. Specific. Never hype." }],
  },
});

const result = await engine.generateFor(
  { id: "p1", title: "the migration that took three attempts", type: "past", status: "idea" },
  {
    stage: "hooks",          // "hooks" | "body" | "media" | "regenerate"
    hookCount: 10,
    providers: [
      { name: "anthropic", apiKey: k1, model: "claude-sonnet-5" },
      { name: "openai",    apiKey: k2, model: "gpt-4o" },  // fallback
      { name: "mock" },                                     // last resort
    ],
  },
);

result.hooks;    // string[]
result.provider; // whichever one actually answered
```

### The fallback chain

`providers` is ordered. The chain retries **retryable** failures (429, 5xx, timeouts, socket errors, empty completions) with exponential backoff, then moves to the next provider. A **terminal** failure (401 bad key, 400 malformed) skips retries and falls through immediately — retrying a bad key only burns latency. When every provider is exhausted it throws `AllProvidersFailedError` carrying each attempt.

```ts
new LinkedInEngine({
  brand,
  chain: {
    retriesPerProvider: 2,                     // default
    backoffMs: 500,                            // doubles per retry
    onAttempt: (i) => metrics.record(i),       // observability hook
  },
});
```

### Built-in providers

| name | credential | notes |
|---|---|---|
| `anthropic` | `apiKey` | Messages API. Sends the brand pack as a cached system prompt. Default `claude-sonnet-5`. |
| `openai` | `apiKey` | Chat Completions. Default `gpt-4o`. |
| `gemini` | `apiKey` | `generateContent`. Default `gemini-2.0-flash`. |
| `codex-cli` | — | Shells out to a logged-in `codex` binary. |
| `claude-cli` | — | Shells out to a logged-in `claude` binary. |
| `mock` | — | Deterministic. Tests and offline dev. |

> Anthropic model IDs current as of Jan 2026: `claude-opus-4-8` (deep reasoning), `claude-sonnet-5` (balanced), `claude-haiku-4-5-20251001` (fast/cheap). Older docs listing `claude-sonnet-4-0` / `claude-opus-4-1` are stale.

Any `baseUrl` is overridable, so a proxy or gateway works without code changes.

### Bring your own provider

```ts
import { ProviderRegistry, defaultRegistry } from "@linkedin-engine/core";

const registry = defaultRegistry().register({
  name: "my-llama",
  async isAvailable() { return true; },
  async complete(req, cfg) {
    const text = await myLlama(req.system, req.prompt);
    return { text, provider: "my-llama", latencyMs: 0 };
  },
});

new LinkedInEngine({ brand, registry, defaultProviders: [{ name: "my-llama" }] });
```

## Persistence

Implement as much of `Store` as you need. Only `getPost` is required; every other method is optional and silently skipped when absent.

```ts
const store: Store = {
  async getPost(id)            { return db.post.findUnique({ where: { id } }); },
  async updatePost(id, patch)  { await db.post.update({ where: { id }, data: patch }); },
  async saveHooks(postId, hs)  { await db.hook.createMany({ data: hs.map(text => ({ postId, text })) }); },
  async countHooks(postId)     { return db.hook.count({ where: { postId } }); },
  // recordGeneration, recordScrape, recordMetric, findComment, createComment,
  // listPostedSince — implement to enable run history, metrics and the sweep.
};
```

`MemoryStore` ships for tests, demos, and the CLI.

## Interactions: metrics + reply drafting

```ts
import { runInteractionsSweep } from "@linkedin-engine/core";

await runInteractionsSweep({
  brand, store,
  providers: [{ name: "anthropic", apiKey }],
  days: 7,
  scrape: { serviceUrl: process.env.SCRAPER_URL }, // optional headless-browser service
});
```

Scrapes each post published in the last `days`, snapshots likes/comments/reposts, and drafts a reply for every comment it has not seen before (deduped by a stable content hash). **Model failures degrade gracefully** — if the LLM is down, the scrape and the metrics are still recorded, with `summary: null` and comments left `status: "new"`. Losing a nice-to-have summary must never lose the metrics snapshot.

LinkedIn renders comments client-side, so plain-`fetch` comment extraction is best-effort. Point `serviceUrl` at a headless-browser scrape service (any `POST /scrape` endpoint) for real coverage; the library falls back to `fetch` if it is unset or unreachable.

## Unicode formatting

LinkedIn post bodies have no rich text. `boldKeywords` swaps in Unicode Mathematical Alphanumerics so emphasis survives copy-paste:

```ts
boldKeywords("we cut latency with AI agents", ["AI agents", "latency"]);
// → "we cut 𝗹𝗮𝘁𝗲𝗻𝗰𝘆 with 𝗔𝗜 𝗮𝗴𝗲𝗻𝘁𝘀"
```

## HTTP service

```bash
cp .env.example .env      # set PROVIDER_CHAIN + keys
pnpm dev:server           # http://localhost:4400
```

| route | purpose |
|---|---|
| `GET  /health` | liveness; lists registered providers and the default chain |
| `POST /v1/generate` | stateless — you pass the post and (optionally) the provider chain |
| `POST /v1/posts/:id/generate` | store-backed by post id |
| `POST /v1/scrape` | scrape a URL; also decodes the true publish time from the activity id |
| `POST /v1/posts/:id/interactions` | scrape one post, draft replies |
| `POST /v1/interactions/sweep` | the periodic watcher |
| `POST /v1/format/bold-keywords` | unicode emphasis |

Set `API_TOKEN` to require `Authorization: Bearer <token>` on everything except `/health`. Callers may pass their own `providers` array per request, overriding the server default — that is the multi-tenant path.

Errors map honestly: `400` invalid request or bad credential, `404` unknown post, `502` `all_providers_failed` (with every attempt attached).

```bash
docker build -f packages/server/Dockerfile -t linkedin-engine .
docker run -p 4400:4400 --env-file .env linkedin-engine
```

`env` is read only at the edge (`server`, `cli`) via the opt-in `brandFromEnv` / `providerChainFromEnv` helpers. A provider named in `PROVIDER_CHAIN` whose key is missing is dropped from the chain rather than left to fail every request.

## CLI

```bash
PROVIDER_CHAIN=anthropic ANTHROPIC_API_KEY=sk-… \
  npx linkedin-engine generate --title "the migration that took three attempts" --stage hooks --hooks 10

npx linkedin-engine scrape --url https://www.linkedin.com/feed/update/urn:li:activity:74699…
npx linkedin-engine bold --text "we cut latency" --keywords "latency"
```

## Output contract

Prompts ask the model for this shape, and the parsers are deliberately forgiving so a slightly-off model still parses:

```
HOOK OPTIONS
1. …
2. …

POST
<body>

NOTES
- char count
```

Override any stage's prompt with `promptTemplate` (`{{hookCount}}` is interpolated); defaults live in `DEFAULT_PROMPTS`.

## What was left behind

The Next.js dashboard, WebAuthn auth, Prisma schema, trend inbox, and image generation stayed in the original app. This package is the reusable core: generation, providers, parsing, scraping, interactions, formatting.
