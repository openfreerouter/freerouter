/**
 * ClawRouter Auth — loads API keys from OpenClaw auth-profiles.json
 * Zero-dep, reads from ~/.openclaw/agents/main/agent/auth-profiles.json
 */

import { readFileSync } from "node:fs";
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
  const filePath = join(homedir(), ".openclaw", "agents", "main", "agent", "auth-profiles.json");
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
  if (!authCache) {
    authCache = loadAuthProfiles();
  }
  return authCache.get(provider);
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
