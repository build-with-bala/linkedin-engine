import { brandFromEnv, providerChainFromEnv, type BrandConfig, type ProviderConfig } from "@linkedin-engine/core";

export { brandFromEnv, providerChainFromEnv };

export interface ServerConfig {
  port: number;
  /** When set, every request must send `Authorization: Bearer <token>`. */
  apiToken?: string;
  scraperUrl?: string;
  brand: BrandConfig;
  defaultProviders: ProviderConfig[];
}

export function configFromEnv(env = process.env): ServerConfig {
  return {
    port: Number(env.PORT ?? 4400),
    apiToken: env.API_TOKEN || undefined,
    scraperUrl: env.SCRAPER_URL || undefined,
    brand: brandFromEnv(env),
    defaultProviders: providerChainFromEnv(env),
  };
}
