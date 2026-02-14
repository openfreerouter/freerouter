/**
 * ClawRouter Proxy Server
 *
 * OpenAI-compatible HTTP server that classifies incoming requests
 * using the 14-dimension weighted scorer and routes to the best backend.
 *
 * Endpoints:
 *   POST /v1/chat/completions  — OpenAI-compatible chat completions
 *   GET  /v1/models            — list available models
 *   GET  /health               — health check
 *
 * Zero external deps. Uses Node.js built-in http + native fetch.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { route } from "./router/index.js";
import { getRoutingConfig } from "./router/config.js";
import { buildPricingMap } from "./models.js";
import { forwardRequest, TimeoutError, type ChatRequest } from "./provider.js";
import { reloadAuth } from "./auth.js";
import { loadConfig, getConfig, reloadConfig, getSanitizedConfig, getConfigPath } from "./config.js";
import { logger, setLogLevel } from "./logger.js";

// Load config at startup
const appConfig = loadConfig();
const PORT = parseInt(process.env.CLAWROUTER_PORT ?? String(appConfig.port), 10);
const HOST = process.env.CLAWROUTER_HOST ?? appConfig.host ?? "127.0.0.1";

// Build pricing map once at startup
const modelPricing = buildPricingMap();

// Stats
const stats = {
  started: new Date().toISOString(),
  requests: 0,
  errors: 0,
  timeouts: 0,
  byTier: { SIMPLE: 0, MEDIUM: 0, COMPLEX: 0, REASONING: 0 } as Record<string, number>,
  byModel: {} as Record<string, number>,
};

/**
 * Read request body as JSON.
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/**
 * Send JSON error response.
 */
function sendError(res: ServerResponse, status: number, message: string, type = "server_error") {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    error: { message, type, code: status },
  }));
}

/**
 * Extract the user's prompt text from messages for classification.
 */
function extractPromptForClassification(messages: ChatRequest["messages"]): {
  prompt: string;
  systemPrompt: string | undefined;
} {
  let systemPrompt: string | undefined;
  const contextWindow = 3; // Include last N non-system messages for context-aware classification

  // Separate system messages from conversation
  const conversationMsgs: Array<{ role: string; text: string }> = [];
  for (const msg of messages) {
    const text = typeof msg.content === "string"
      ? msg.content
      : (msg.content ?? []).filter(b => b.type === "text").map(b => b.text ?? "").join("\n");

    if (msg.role === "system" || msg.role === "developer") {
      systemPrompt = (systemPrompt ? systemPrompt + "\n" : "") + text;
    } else {
      conversationMsgs.push({ role: msg.role, text });
    }
  }

  // Take the last N messages for classification context
  const recentMsgs = conversationMsgs.slice(-contextWindow);

  // Build classification prompt: weight the last user message most,
  // but include recent context so quoted/replied content gets scored too
  const lastUserMsg = recentMsgs.filter(m => m.role === "user").pop()?.text ?? "";
  const contextParts: string[] = [];
  for (const msg of recentMsgs) {
    if (msg.text !== lastUserMsg) {
      // Truncate context messages to avoid over-counting long assistant replies
      contextParts.push(msg.text.slice(0, 500));
    }
  }

  // Combine: context (truncated) + full last user message
  const prompt = contextParts.length > 0
    ? contextParts.join("\n") + "\n" + lastUserMsg
    : lastUserMsg;

  return { prompt, systemPrompt };
}


/**
 * Detect user-requested mode override in prompt text.
 * Users can prefix or include mode directives to force a specific tier:
 *   "simple mode: ..."  or  "/simple ..."   → SIMPLE
 *   "medium mode: ..."  or  "/medium ..."   → MEDIUM  
 *   "complex mode: ..." or  "/complex ..."  → COMPLEX
 *   "max mode: ..."     or  "/max ..."      → REASONING
 *   "reasoning mode: ..." or "/reasoning ..." → REASONING
 * 
 * Returns the forced tier and cleaned prompt (directive stripped), or null if no override.
 */
function detectModeOverride(prompt: string): { tier: string; cleanedPrompt: string } | null {
  const modeMap: Record<string, string> = {
    simple: "SIMPLE",
    basic: "SIMPLE",
    cheap: "SIMPLE",
    medium: "MEDIUM",
    balanced: "MEDIUM",
    complex: "COMPLEX",
    advanced: "COMPLEX",
    max: "REASONING",
    reasoning: "REASONING",
    think: "REASONING",
    deep: "REASONING",
  };

  // Pattern 1: "/mode ..." at start of message
  const slashMatch = prompt.match(/^\/([a-z]+)\s+/i);
  if (slashMatch) {
    const mode = slashMatch[1].toLowerCase();
    if (modeMap[mode]) {
      return { tier: modeMap[mode], cleanedPrompt: prompt.slice(slashMatch[0].length).trim() };
    }
  }

  // Pattern 2: "mode mode: ..." or "mode mode, ..." at start  
  const prefixMatch = prompt.match(/^([a-z]+)\s+mode[:\s,]+/i);
  if (prefixMatch) {
    const mode = prefixMatch[1].toLowerCase();
    if (modeMap[mode]) {
      return { tier: modeMap[mode], cleanedPrompt: prompt.slice(prefixMatch[0].length).trim() };
    }
  }

  // Pattern 3: "[mode]" at start
  const bracketMatch = prompt.match(/^\[([a-z]+)\]\s*/i);
  if (bracketMatch) {
    const mode = bracketMatch[1].toLowerCase();
    if (modeMap[mode]) {
      return { tier: modeMap[mode], cleanedPrompt: prompt.slice(bracketMatch[0].length).trim() };
    }
  }

  return null;
}

/**
 * Handle POST /v1/chat/completions
 */
async function handleChatCompletions(req: IncomingMessage, res: ServerResponse) {
  const bodyStr = await readBody(req);
  let chatReq: ChatRequest;

  try {
    chatReq = JSON.parse(bodyStr);
  } catch {
    return sendError(res, 400, "Invalid JSON body");
  }

  if (!chatReq.model) {
    return sendError(res, 400, "model field is required");
  }

  if (!chatReq.messages || !Array.isArray(chatReq.messages) || chatReq.messages.length === 0) {
    return sendError(res, 400, "messages array is required");
  }

  const stream = chatReq.stream ?? false;
  const maxTokens = chatReq.max_tokens ?? 4096;

  // Extract prompt for classification
  const { prompt, systemPrompt } = extractPromptForClassification(chatReq.messages);

  if (!prompt) {
    return sendError(res, 400, "No user message found");
  }

  // Route through classifier
  const requestedModel = chatReq.model ?? "auto";
  let routedModel: string;
  let tier: string;
  let reasoning: string;

  if (requestedModel === "auto" || requestedModel === "clawrouter/auto" || requestedModel === "blockrun/auto") {
    // Check for user mode override (e.g., "max mode: ...", "/complex ...", "[reasoning] ...")
    const modeOverride = detectModeOverride(prompt);
    
    if (modeOverride) {
      // User explicitly requested a tier — honor it
      const routingCfg = getRoutingConfig();
      const tierConfig = routingCfg.tiers[modeOverride.tier as keyof typeof routingCfg.tiers];
      routedModel = tierConfig?.primary ?? "anthropic/claude-opus-4-6";
      tier = modeOverride.tier;
      reasoning = `user-mode: ${modeOverride.tier.toLowerCase()}`;
      logger.info(`[${stats.requests + 1}] Mode override: tier=${tier} model=${routedModel} | ${reasoning}`);
    } else {
      // Run the classifier
      const decision = route(prompt, systemPrompt, maxTokens, {
        config: getRoutingConfig(),
        modelPricing,
      });

      routedModel = decision.model;
      tier = decision.tier;
      reasoning = decision.reasoning;

      logger.info(`[${stats.requests + 1}] Classified: tier=${tier} model=${routedModel} confidence=${decision.confidence.toFixed(2)} | ${reasoning}`);
    }
  } else {
    // Explicit model requested — pass through
    routedModel = requestedModel;
    tier = "EXPLICIT";
    reasoning = `explicit model: ${requestedModel}`;
    logger.info(`[${stats.requests + 1}] Passthrough: model=${routedModel}`);
  }

  // Update stats
  stats.requests++;
  stats.byTier[tier] = (stats.byTier[tier] ?? 0) + 1;
  stats.byModel[routedModel] = (stats.byModel[routedModel] ?? 0) + 1;

  // Add routing info headers
  res.setHeader("X-ClawRouter-Model", routedModel);
  res.setHeader("X-ClawRouter-Tier", tier);
  res.setHeader("X-ClawRouter-Reasoning", reasoning.slice(0, 200));

  // Build model list: primary + fallbacks
  const modelsToTry: string[] = [routedModel];
  if (tier !== "EXPLICIT") {
    const routingCfg = getRoutingConfig();
    const tierConfig = routingCfg.tiers[tier as keyof typeof routingCfg.tiers];
    if (tierConfig?.fallback) {
      for (const fb of tierConfig.fallback) {
        if (fb !== routedModel) modelsToTry.push(fb);
      }
    }
  }

  let lastError: string = "";
  for (const modelToTry of modelsToTry) {
    try {
      if (modelToTry !== routedModel) {
        logger.info(`[${stats.requests}] Falling back to ${modelToTry}`);
        res.setHeader("X-ClawRouter-Model", modelToTry);
      }
      await forwardRequest(chatReq, modelToTry, tier, res, stream);
      return; // success
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      const isTimeout = err instanceof TimeoutError;
      if (isTimeout) {
        stats.timeouts++;
        logger.error(`\u23f1 TIMEOUT (${modelToTry}): ${lastError} — trying fallback...`);
      } else {
        logger.error(`Forward error (${modelToTry}): ${lastError}`);
      }
      if (res.headersSent) break; // can't retry if already streaming
    }
  }

  stats.errors++;
  if (!res.headersSent) {
    sendError(res, 502, `Backend error: ${lastError}`, "upstream_error");
  } else if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify({ error: { message: lastError } })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  }
}

/**
 * Handle GET /v1/models
 */
function handleListModels(_req: IncomingMessage, res: ServerResponse) {
  const models = [
    {
      id: "auto",
      object: "model",
      created: Math.floor(Date.now() / 1000),
      owned_by: "clawrouter",
      permission: [],
    },
    {
      id: "anthropic/claude-opus-4-6",
      object: "model",
      created: Math.floor(Date.now() / 1000),
      owned_by: "anthropic",
    },
    {
      id: "anthropic/claude-sonnet-4-5",
      object: "model",
      created: Math.floor(Date.now() / 1000),
      owned_by: "anthropic",
    },
    {
      id: "anthropic/claude-haiku-4-5",
      object: "model",
      created: Math.floor(Date.now() / 1000),
      owned_by: "anthropic",
    },
    {
      id: "kimi-coding/kimi-for-coding",
      object: "model",
      created: Math.floor(Date.now() / 1000),
      owned_by: "kimi-coding",
    },
  ];

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ object: "list", data: models }));
}

/**
 * Handle GET /health
 */
function handleHealth(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    status: "ok",
    version: "1.1.0",
    uptime: process.uptime(),
    stats,
  }));
}

/**
 * Handle GET /stats
 */
function handleStats(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(stats, null, 2));
}


/**
 * Handle GET /config — show sanitized config (no secrets)
 */
function handleConfig(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    configPath: getConfigPath(),
    config: getSanitizedConfig(),
  }, null, 2));
}

/**
 * Handle POST /reload-config — reload config + auth without restart
 */
function handleReloadConfig(_req: IncomingMessage, res: ServerResponse) {
  reloadConfig();
  reloadAuth();
  const cfg = getConfig();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    status: "reloaded",
    configPath: getConfigPath(),
    providers: Object.keys(cfg.providers),
    tiers: Object.keys(cfg.tiers),
  }));
}

/**
 * Handle POST /reload
 */
function handleReload(_req: IncomingMessage, res: ServerResponse) {
  reloadConfig();
  reloadAuth();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "reloaded" }));
}

/**
 * Request router.
 */
async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const method = req.method ?? "GET";
  const url = req.url ?? "/";

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (method === "POST" && (url === "/v1/chat/completions" || url === "/chat/completions")) {
      await handleChatCompletions(req, res);
    } else if (method === "GET" && (url === "/v1/models" || url === "/models")) {
      handleListModels(req, res);
    } else if (method === "GET" && url === "/health") {
      handleHealth(req, res);
    } else if (method === "GET" && url === "/stats") {
      handleStats(req, res);
    } else if (method === "POST" && url === "/reload") {
      handleReload(req, res);
    } else if (method === "GET" && url === "/config") {
      handleConfig(req, res);
    } else if (method === "POST" && url === "/reload-config") {
      handleReloadConfig(req, res);
    } else {
      sendError(res, 404, `Not found: ${method} ${url}`, "not_found");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Unhandled error: ${msg}`);
    if (!res.headersSent) {
      sendError(res, 500, msg);
    }
  }
}

// ─── Start server ───

if (process.argv.includes("--debug")) {
  setLogLevel("debug");
}

const server = createServer(handleRequest);

server.listen(PORT, HOST, () => {
  logger.info(`🚀 ClawRouter proxy listening on http://${HOST}:${PORT} (config: ${getConfigPath() ?? "built-in defaults"})`);
  logger.info(`   POST /v1/chat/completions  — route & forward`);
  logger.info(`   GET  /v1/models            — list models`);
  logger.info(`   GET  /health               — health check`);
  logger.info(`   GET  /stats                — request statistics`);
  logger.info(`   POST /reload               — reload auth keys`);
  logger.info(`   GET  /config               — show config (sanitized)`);
  logger.info(`   POST /reload-config         — reload config + auth`);
});

// Graceful shutdown
process.on("SIGINT", () => {
  logger.info("Shutting down...");
  server.close(() => process.exit(0));
});

process.on("SIGTERM", () => {
  logger.info("Shutting down...");
  server.close(() => process.exit(0));
});
