/**
 * ClawRouter Auth — loads API keys from OpenClaw auth-profiles.json
 * Zero-dep, reads from ~/.openclaw/agents/main/agent/auth-profiles.json
 */

import { readFileSync, existsSync } from "node:fs";
import { getConfig } from "./config.js";
import { join } from "node:path";
import { homedir } from "node:os";
import { logger } from "./logger.js";

export type ProviderAuth = {
  provider: string;
  profileName: string;
  token?: string;   // Anthropic OAuth token
  apiKey?: string;   // API key (Kimi, OpenAI)
};

type AuthProfilesFile = {
  version: number;
  profiles: Record<string, {
    type: "token" | "api_key";
    provider: string;
    token?: string;
    key?: string;
  }>;
  lastGood?: Record<string, string>;
};

let authCache: Map<string, ProviderAuth> | null = null;

function loadAuthProfiles(): Map<string, ProviderAuth> {
  // Get path from config, fall back to default
  const cfg = getConfig();
  const authCfg = cfg.auth;
  const defaultAuth = authCfg[authCfg.default] as { type?: string; profilesPath?: string } | undefined;
  let filePath: string;
  if (defaultAuth?.profilesPath) {
    const p = defaultAuth.profilesPath;
    filePath = p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
  } else {
    filePath = join(homedir(), ".openclaw", "agents", "main", "agent", "auth-profiles.json");
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    const data: AuthProfilesFile = JSON.parse(raw);
    const map = new Map<string, ProviderAuth>();

    // Build a map of provider → best profile (prefer lastGood)
    const lastGood = data.lastGood ?? {};

    for (const [name, profile] of Object.entries(data.profiles)) {
      const provider = profile.provider;
      const existing = map.get(provider);

      // Prefer lastGood profile
      const isLastGood = lastGood[provider] === name;
      if (existing && !isLastGood) continue;

      map.set(provider, {
        provider,
        profileName: name,
        token: profile.type === "token" ? profile.token : undefined,
        apiKey: profile.type === "api_key" ? profile.key : undefined,
      });
    }

    logger.info(`Loaded auth for providers: ${[...map.keys()].join(", ")}`);
    return map;
  } catch (err) {
    logger.error("Failed to load auth-profiles.json:", err);
    return new Map();
  }
}

export function getAuth(provider: string): ProviderAuth | undefined {
  // Check env var auth first (per-provider config override)
  const envAuth = getEnvAuth(provider);
  if (envAuth) return envAuth;

  // Fall back to auth-profiles.json
  if (!authCache) {
    authCache = loadAuthProfiles();
  }
  return authCache.get(provider);
}



/**
 * Get auth from environment variable (for providers with auth.type=env in config).
 */
function getEnvAuth(provider: string): ProviderAuth | undefined {
  const cfg = getConfig();
  const providerCfg = cfg.providers[provider];
  if (!providerCfg?.auth || providerCfg.auth.type !== "env") return undefined;
  const envKey = providerCfg.auth.key;
  if (!envKey) return undefined;
  const value = process.env[envKey];
  if (!value) return undefined;
  return {
    provider,
    profileName: envKey,
    apiKey: value,
  };
}

export function reloadAuth(): void {
  authCache = null;
  logger.info("Auth cache cleared, will reload on next access");
}

/**
 * Get the authorization header value for a provider.
 */
export function getAuthHeader(provider: string): string | undefined {
  const auth = getAuth(provider);
  if (!auth) return undefined;

  if (auth.token) {
    // Anthropic uses x-api-key header, not Authorization
    return auth.token;
  }
  if (auth.apiKey) {
    return auth.apiKey;
  }
  return undefined;
}
