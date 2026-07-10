#!/usr/bin/env node
import { parseArgs } from "node:util";
import {
  LinkedInEngine,
  MemoryStore,
  boldKeywords,
  linkedInPostedAt,
  scrapeUrl,
  brandFromEnv,
  providerChainFromEnv,
  type ProviderConfig,
} from "@linkedin-engine/core";


const USAGE = `linkedin-engine — generate and inspect LinkedIn content

Usage:
  linkedin-engine generate --title "..." [--stage hooks|body|media] [--type past|present|trend]
                           [--provider anthropic,openai] [--model <id>] [--hooks 10] [--extra "..."]
  linkedin-engine scrape   --url <post-url>
  linkedin-engine bold     --text "..." --keywords "AI agents,latency"

Providers resolve from PROVIDER_CHAIN + <PROVIDER>_API_KEY unless --provider is given.
Brand pack resolves from BRAND_NAME / BRAND_DIR / BRAND_FILES.
`;

function chain(flag?: string, model?: string): ProviderConfig[] {
  if (!flag) {
    const fromEnv = providerChainFromEnv();
    return fromEnv.length ? fromEnv : [{ name: "mock" }];
  }
  const keyFor: Record<string, string | undefined> = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
  };
  return flag
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => ({ name, apiKey: keyFor[name], ...(model && { model }) }));
}

async function main() {
  const cmd = process.argv[2];
  const { values } = parseArgs({
    args: process.argv.slice(3),
    allowPositionals: false,
    options: {
      title: { type: "string" },
      stage: { type: "string", default: "body" },
      type: { type: "string", default: "present" },
      provider: { type: "string" },
      model: { type: "string" },
      hooks: { type: "string", default: "10" },
      extra: { type: "string" },
      url: { type: "string" },
      text: { type: "string" },
      keywords: { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  if (cmd === "generate") {
    if (!values.title) throw new Error("--title is required");
    const engine = new LinkedInEngine({ brand: brandFromEnv(), store: new MemoryStore() });
    const result = await engine.generateFor(
      { id: "cli", title: values.title, type: values.type!, status: "idea" },
      {
        stage: values.stage as any,
        providers: chain(values.provider, values.model),
        hookCount: Number(values.hooks),
        extraInputs: values.extra,
      },
    );

    if (values.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (result.missingSources.length) {
      console.error(`⚠ brand files not found: ${result.missingSources.join(", ")}`);
    }
    console.error(`— ${result.provider}${result.model ? `/${result.model}` : ""} · ${result.latencyMs}ms\n`);
    console.log(result.hooks?.map((h, i) => `${i + 1}. ${h}`).join("\n") ?? result.body ?? result.mediaPrompt ?? result.output);
    return;
  }

  if (cmd === "scrape") {
    if (!values.url) throw new Error("--url is required");
    const r = await scrapeUrl(values.url, { serviceUrl: process.env.SCRAPER_URL });
    console.log(JSON.stringify({ ...r, postedAt: linkedInPostedAt(values.url) }, null, 2));
    return;
  }

  if (cmd === "bold") {
    if (!values.text || !values.keywords) throw new Error("--text and --keywords are required");
    console.log(boldKeywords(values.text, values.keywords.split(",")));
    return;
  }

  console.log(USAGE);
  process.exitCode = cmd ? 1 : 0;
}

main().catch((e) => {
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
