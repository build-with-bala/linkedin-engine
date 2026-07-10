import type { BrandConfig } from "./context.js";
import type { ProviderConfig } from "./providers/types.js";

/**
 * OPT-IN env helpers.
 *
 * The engine itself never reads process.env — that is what keeps it
 * multi-tenant safe. These helpers exist for the edge (a server, a CLI, a cron)
 * where reading env IS the right thing. Import them deliberately; nothing in
 * the core calls them.
 */

const KEY_ENV: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

const MODEL_ENV: Record<string, string> = {
  anthropic: "ANTHROPIC_MODEL",
  openai: "OPENAI_MODEL",
  gemini: "GEMINI_MODEL",
};

/**
 * Build an ordered chain from `PROVIDER_CHAIN=anthropic,openai`.
 * An HTTP provider with no credential is dropped rather than left in the chain
 * to fail on every single request.
 */
export function providerChainFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderConfig[] {
  return (env.PROVIDER_CHAIN ?? "mock")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name): ProviderConfig | null => {
      const keyVar = KEY_ENV[name];
      if (keyVar && !env[keyVar]) return null;
      const modelVar = MODEL_ENV[name];
      return {
        name,
        ...(keyVar && { apiKey: env[keyVar] }),
        ...(modelVar && env[modelVar] && { model: env[modelVar] }),
      };
    })
    .filter((c): c is ProviderConfig => c !== null);
}

export function brandFromEnv(env: NodeJS.ProcessEnv = process.env): BrandConfig {
  return {
    name: env.BRAND_NAME ?? "Your Brand",
    baseDir: env.BRAND_DIR,
    files: (env.BRAND_FILES ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    fullStoryFile: env.BRAND_FULL_STORY,
  };
}
