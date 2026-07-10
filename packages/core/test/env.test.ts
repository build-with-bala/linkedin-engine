import { describe, expect, it } from "vitest";
import { brandFromEnv, providerChainFromEnv } from "../src/env.js";

describe("providerChainFromEnv", () => {
  it("builds an ordered chain with keys and model overrides", () => {
    const chain = providerChainFromEnv({
      PROVIDER_CHAIN: "anthropic,openai",
      ANTHROPIC_API_KEY: "sk-ant",
      ANTHROPIC_MODEL: "claude-opus-4-8",
      OPENAI_API_KEY: "sk-oai",
    } as NodeJS.ProcessEnv);

    expect(chain).toEqual([
      { name: "anthropic", apiKey: "sk-ant", model: "claude-opus-4-8" },
      { name: "openai", apiKey: "sk-oai" },
    ]);
  });

  it("drops an HTTP provider whose key is absent rather than failing every request", () => {
    const chain = providerChainFromEnv({
      PROVIDER_CHAIN: "anthropic,openai",
      OPENAI_API_KEY: "sk-oai",
    } as NodeJS.ProcessEnv);

    expect(chain.map((c) => c.name)).toEqual(["openai"]);
  });

  it("keeps credential-free providers (cli, mock)", () => {
    const chain = providerChainFromEnv({ PROVIDER_CHAIN: "codex-cli,mock" } as NodeJS.ProcessEnv);
    expect(chain.map((c) => c.name)).toEqual(["codex-cli", "mock"]);
  });

  it("defaults to mock when unset", () => {
    expect(providerChainFromEnv({} as NodeJS.ProcessEnv)).toEqual([{ name: "mock" }]);
  });
});

describe("brandFromEnv", () => {
  it("parses the comma-separated file list", () => {
    const b = brandFromEnv({
      BRAND_NAME: "Acme",
      BRAND_DIR: "./brand",
      BRAND_FILES: "voice.md, guardrails.md",
    } as NodeJS.ProcessEnv);

    expect(b).toMatchObject({ name: "Acme", baseDir: "./brand", files: ["voice.md", "guardrails.md"] });
  });

  it("yields an empty file list when unset", () => {
    expect(brandFromEnv({} as NodeJS.ProcessEnv).files).toEqual([]);
  });
});
