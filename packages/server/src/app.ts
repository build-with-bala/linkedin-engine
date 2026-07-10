import Fastify, { type FastifyInstance } from "fastify";
import {
  AllProvidersFailedError,
  GenerateInput,
  LinkedInEngine,
  MemoryStore,
  PostInput,
  ProviderError,
  type Store,
  boldKeywords,
  linkedInPostedAt,
  runInteractionsSweep,
  scrapeAndAnalyze,
  scrapeUrl,
} from "@linkedin-engine/core";
import { z } from "zod";
import type { ServerConfig } from "./config.js";

/**
 * A thin HTTP shell over the core. Every route validates with zod, resolves a
 * provider chain (request-supplied, else the server default), and maps engine
 * errors onto honest status codes.
 */
export function buildApp(cfg: ServerConfig, store: Store = new MemoryStore()): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

  const engine = new LinkedInEngine({
    brand: cfg.brand,
    store,
    defaultProviders: cfg.defaultProviders,
    chain: {
      onAttempt: (i) =>
        app.log.info({ provider: i.provider, attempt: i.attempt, ok: i.ok, err: i.error }, "provider attempt"),
    },
  });

  // Bearer auth, when a token is configured. Health stays public for probes.
  app.addHook("onRequest", async (req, reply) => {
    if (!cfg.apiToken || req.url === "/health") return;
    if (req.headers.authorization !== `Bearer ${cfg.apiToken}`) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.setErrorHandler((rawErr, _req, reply) => {
    // Fastify types the handler arg as FastifyError; widen it so `instanceof`
    // narrowing against our own error classes actually works.
    const err: unknown = rawErr;

    if (err instanceof AllProvidersFailedError) {
      // Every backend is down or misconfigured — upstream failure, not client error.
      return reply.code(502).send({ error: "all_providers_failed", attempts: err.attempts });
    }
    if (err instanceof ProviderError) {
      return reply.code(err.status === 401 ? 400 : 502).send({ error: err.message });
    }
    if (err instanceof z.ZodError) {
      return reply.code(400).send({ error: "invalid_request", issues: err.issues });
    }

    const message = err instanceof Error ? err.message : String(err);
    if (/not found/i.test(message)) return reply.code(404).send({ error: message });
    app.log.error(err);
    return reply.code(500).send({ error: message });
  });

  app.get("/health", async () => ({
    ok: true,
    providers: engine.providers,
    defaultChain: cfg.defaultProviders.map((p) => p.name),
  }));

  /**
   * Stateless generation: the caller owns the post and the keys.
   * This is the endpoint a larger product integrates against.
   */
  app.post("/v1/generate", async (req) => {
    const body = z
      .object({ post: PostInput, ...GenerateInput.partial({ providers: true }).shape })
      .parse(req.body);

    return engine.generateFor(body.post, {
      stage: body.stage,
      providers: body.providers ?? cfg.defaultProviders,
      promptTemplate: body.promptTemplate,
      extraInputs: body.extraInputs,
      includeFullStory: body.includeFullStory,
      hookCount: body.hookCount,
    });
  });

  /** Store-backed generation by post id. */
  app.post<{ Params: { id: string } }>("/v1/posts/:id/generate", async (req) => {
    const body = GenerateInput.partial({ providers: true }).parse(req.body);
    return engine.generate(req.params.id, {
      ...body,
      providers: body.providers ?? cfg.defaultProviders,
    });
  });

  app.post("/v1/scrape", async (req) => {
    const { url } = z.object({ url: z.string().url() }).parse(req.body);
    const result = await scrapeUrl(url, { serviceUrl: cfg.scraperUrl });
    return { ...result, postedAt: linkedInPostedAt(url) };
  });

  app.post<{ Params: { id: string } }>("/v1/posts/:id/interactions", async (req) => {
    const post = await store.getPost(req.params.id);
    if (!post) throw new Error(`Post not found: ${req.params.id}`);
    return scrapeAndAnalyze(post, {
      brand: cfg.brand,
      store,
      providers: cfg.defaultProviders,
      scrape: { serviceUrl: cfg.scraperUrl },
    });
  });

  app.post("/v1/interactions/sweep", async (req) => {
    const { days } = z.object({ days: z.number().int().positive().max(90).optional() }).parse(
      req.body ?? {},
    );
    return runInteractionsSweep({
      brand: cfg.brand,
      store,
      providers: cfg.defaultProviders,
      scrape: { serviceUrl: cfg.scraperUrl },
      days,
    });
  });

  /** Unicode bold/italic for LinkedIn's plain-text bodies. */
  app.post("/v1/format/bold-keywords", async (req) => {
    const { text, keywords } = z
      .object({ text: z.string(), keywords: z.array(z.string()) })
      .parse(req.body);
    return { text: boldKeywords(text, keywords) };
  });

  return app;
}
