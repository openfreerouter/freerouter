/**
 * ClawRouter Config — loads external configuration from freerouter.config.json
 * Zero external deps. Falls back to hardcoded defaults if no config file exists.
 *
 * Config file search order:
 *   1. FREEROUTER_CONFIG env var
 *   2. ./freerouter.config.json (cwd)
 *   3. ~/.config/freerouter/config.json
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { logger } from "./logger.js";

// ─── Config Types ───

export type AuthConfig = {
  type: "openclaw" | "env" | "file" | "keychain";
  key?: string;           // env var name for type=env
  profilesPath?: string;  // for type=openclaw
  filePath?: string;      // for type=file
  service?: string;       // for type=keychain
  account?: string;       // for type=keychain
};

export type ProviderConfigEntry = {
  baseUrl: string;
  api: "anthropic" | "openai";
  headers?: Record<string, string>;
  auth?: AuthConfig;
};

export type TierMapping = {
  primary: string;
  fallback: string[];
};

export type ThinkingConfig = {
  adaptive?: string[];
  enabled?: { models: string[]; budget: number };
};

export type FreeRouterConfig = {
  port: number;
  host: string;
  providers: Record<string, ProviderConfigEntry>;
  tiers: Record<string, TierMapping>;
  agenticTiers?: Record<string, TierMapping>;
  tierBoundaries?: {
    simpleMedium: number;
    mediumComplex: number;
    complexReasoning: number;
  };
  thinking?: ThinkingConfig;
  auth: {
    default: string;
    [strategy: string]: unknown;
  };
  scoring?: Record<string, unknown>;
};

// ─── Defaults (current hardcoded behavior) ───

const DEFAULT_CONFIG: FreeRouterConfig = {
  port: 18800,
  host: "127.0.0.1",
  providers: {
    anthropic: {
      baseUrl: "https://api.anthropic.com",
      api: "anthropic",
    },
    "kimi-coding": {
      baseUrl: "https://api.kimi.com/coding/v1",
      api: "openai",
      headers: { "User-Agent": "KimiCLI/0.77" },
    },
  },
  tiers: {
    SIMPLE:    { primary: "kimi-coding/kimi-for-coding", fallback: ["anthropic/claude-haiku-4-5"] },
    MEDIUM:    { primary: "anthropic/claude-sonnet-4-5", fallback: ["anthropic/claude-opus-4-6"] },
    COMPLEX:   { primary: "anthropic/claude-opus-4-6", fallback: ["anthropic/claude-haiku-4-5"] },
    REASONING: { primary: "anthropic/claude-opus-4-6", fallback: ["anthropic/claude-haiku-4-5"] },
  },
  agenticTiers: {
    SIMPLE:    { primary: "kimi-coding/kimi-for-coding", fallback: ["anthropic/claude-haiku-4-5"] },
    MEDIUM:    { primary: "anthropic/claude-sonnet-4-5", fallback: ["anthropic/claude-opus-4-6"] },
    COMPLEX:   { primary: "anthropic/claude-opus-4-6", fallback: ["anthropic/claude-haiku-4-5"] },
    REASONING: { primary: "anthropic/claude-opus-4-6", fallback: ["anthropic/claude-haiku-4-5"] },
  },
  thinking: {
    adaptive: ["claude-opus-4-6", "claude-opus-4.6"],
    enabled: { models: ["claude-sonnet-4-5"], budget: 4096 },
  },
  auth: {
    default: "openclaw",
    openclaw: {
      type: "openclaw",
      profilesPath: "~/.openclaw/agents/main/agent/auth-profiles.json",
    },
  },
};

// ─── Singleton ───

let _config: FreeRouterConfig | null = null;
let _configPath: string | null = null;

/**
 * Resolve ~ to home directory in paths.
 */
function resolvePath(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return join(homedir(), p.slice(1));
  }
  return p;
}

/**
 * Resolve $ENV_VAR references in string values.
 */
function resolveEnvVars(value: string): string {
  return value.replace(/\$([A-Z_][A-Z0-9_]*)/g, (_match, name) => {
    return process.env[name] ?? "";
  });
}

/**
 * Deep-merge source into target (source wins). Arrays are replaced, not merged.
 */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (sv && typeof sv === "object" && !Array.isArray(sv) && tv && typeof tv === "object" && !Array.isArray(tv)) {
      result[key] = deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>);
    } else {
      result[key] = sv;
    }
  }
  return result;
}

/**
 * Find config file path.
 */
function findConfigFile(): string | null {
  // 1. Env var
  const envPath = process.env.FREEROUTER_CONFIG;
  if (envPath && existsSync(envPath)) return envPath;

  // 2. CWD
  const cwdPath = join(process.cwd(), "freerouter.config.json");
  if (existsSync(cwdPath)) return cwdPath;

  // 3. ~/.config/freerouter/config.json
  const homePath = join(homedir(), ".config", "freerouter", "config.json");
  if (existsSync(homePath)) return homePath;

  return null;
}

/**
 * Load config from file, merging with defaults.
 */
export function loadConfig(): FreeRouterConfig {
  const configPath = findConfigFile();

  if (!configPath) {
    logger.info("No freerouter.config.json found, using built-in defaults");
    _config = { ...DEFAULT_CONFIG };
    _configPath = null;
    return _config;
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const fileConfig = JSON.parse(raw) as Partial<FreeRouterConfig>;

    // Deep-merge file config over defaults
    _config = deepMerge(DEFAULT_CONFIG as unknown as Record<string, unknown>, fileConfig as unknown as Record<string, unknown>) as unknown as FreeRouterConfig;
    _configPath = configPath;

    logger.info(`Loaded config from ${configPath}`);
    logger.info(`  Providers: ${Object.keys(_config.providers).join(", ")}`);
    logger.info(`  Tiers: ${Object.keys(_config.tiers).join(", ")}`);

    return _config;
  } catch (err) {
    logger.error(`Failed to load config from ${configPath}:`, err);
    logger.info("Falling back to built-in defaults");
    _config = { ...DEFAULT_CONFIG };
    _configPath = null;
    return _config;
  }
}

/**
 * Reload config from file (for /reload endpoint).
 */
export function reloadConfig(): FreeRouterConfig {
  _config = null;
  return loadConfig();
}

/**
 * Get the current config (loads if not yet loaded).
 */
export function getConfig(): FreeRouterConfig {
  if (!_config) return loadConfig();
  return _config;
}

/**
 * Get config path (null if using defaults).
 */
export function getConfigPath(): string | null {
  return _configPath;
}

/**
 * Get sanitized config for display (no secrets).
 */
export function getSanitizedConfig(): Record<string, unknown> {
  const cfg = getConfig();
  const sanitized = JSON.parse(JSON.stringify(cfg));

  // Redact auth keys
  if (sanitized.auth) {
    for (const [key, val] of Object.entries(sanitized.auth)) {
      if (key === "default") continue;
      if (val && typeof val === "object" && (val as any).profilesPath) {
        (val as any).profilesPath = "***";
      }
    }
  }

  // Redact provider auth
  for (const prov of Object.values(sanitized.providers ?? {})) {
    if ((prov as any).auth?.key) {
      (prov as any).auth.key = "***";
    }
  }

  return sanitized;
}

/**
 * Convert config api type to internal provider api type.
 */
export function toInternalApiType(api: "anthropic" | "openai"): "anthropic-messages" | "openai-completions" {
  return api === "anthropic" ? "anthropic-messages" : "openai-completions";
}

/**
 * Check if a model supports adaptive thinking based on config.
 */
export function supportsAdaptiveThinking(modelId: string): boolean {
  const cfg = getConfig();
  const patterns = cfg.thinking?.adaptive ?? ["claude-opus-4-6", "claude-opus-4.6"];
  return patterns.some(p => modelId.includes(p));
}

/**
 * Check if a model has thinking enabled and get the budget.
 */
export function getThinkingBudget(modelId: string): number | null {
  const cfg = getConfig();
  const enabled = cfg.thinking?.enabled;
  if (!enabled) return null;
  if (enabled.models.some(m => modelId.includes(m))) {
    return enabled.budget;
  }
  return null;
}

// Export defaults for backward compat
export { DEFAULT_CONFIG };
