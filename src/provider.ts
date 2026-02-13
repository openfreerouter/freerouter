/**
 * ClawRouter Provider — handles forwarding to backend APIs
 * Supports: Anthropic Messages API, OpenAI-compatible (Kimi, OpenAI)
 * Zero external deps — uses native fetch + streams.
 */

import { getAuth } from "./auth.js";
import { logger } from "./logger.js";
import type { IncomingMessage, ServerResponse } from "node:http";

// Provider configs loaded from openclaw.json
export type ProviderConfig = {
  baseUrl: string;
  api: "anthropic-messages" | "openai-completions";
  headers?: Record<string, string>;
};

// OpenAI-format message
export type ChatMessage = {
  role: "system" | "user" | "assistant" | "developer";
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
};

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  top_p?: number;
  stop?: string[];
};

// Hard-coded provider configs (from openclaw.json)
const PROVIDERS: Record<string, ProviderConfig> = {
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    api: "anthropic-messages",
    headers: {
      "anthropic-version": "2023-06-01",
    },
  },
  "kimi-coding": {
    baseUrl: "https://api.kimi.com/coding/v1",
    api: "openai-completions",
    headers: {
      "User-Agent": "KimiCLI/0.77",
    },
  },
};

/**
 * Parse a routed model ID like "anthropic/claude-opus-4-6" into provider + model parts.
 */
export function parseModelId(modelId: string): { provider: string; model: string } {
  const slash = modelId.indexOf("/");
  if (slash === -1) return { provider: "anthropic", model: modelId };
  return { provider: modelId.slice(0, slash), model: modelId.slice(slash + 1) };
}

/**
 * Check if a model supports adaptive thinking (Opus 4.6+)
 */
function supportsAdaptiveThinking(modelId: string): boolean {
  return modelId.includes("opus-4-6") || modelId.includes("opus-4.6");
}

/**
 * Get thinking config based on tier and model.
 * Opus 4.6+ uses adaptive thinking with effort levels.
 * Other models use budget-based thinking.
 */
function getThinkingConfig(tier: string, modelId: string): { type: string; budget_tokens?: number; effort?: string } | undefined {
  // Opus 4.6+ uses adaptive thinking — model decides how much to think (per Anthropic docs)
  if (supportsAdaptiveThinking(modelId) && (tier === "COMPLEX" || tier === "REASONING")) {
    return { type: "adaptive" };
  }

  // Sonnet/Haiku: MEDIUM gets thinking enabled with high budget
  if (tier === "MEDIUM") {
    return { type: "enabled", budget_tokens: 4096 };
  }

  // SIMPLE (Kimi/Haiku): no thinking
  return undefined;
}

/**
 * Forward a chat request to Anthropic Messages API, streaming back as OpenAI SSE.
 */
async function forwardToAnthropic(
  req: ChatRequest,
  modelName: string,
  tier: string,
  res: ServerResponse,
  stream: boolean,
): Promise<void> {
  const auth = getAuth("anthropic");
  if (!auth?.token) throw new Error("No Anthropic auth token");

  const config = PROVIDERS.anthropic;

  // Convert OpenAI messages to Anthropic format
  let systemContent = "";
  const messages: Array<{ role: string; content: string }> = [];

  for (const msg of req.messages) {
    const text = typeof msg.content === "string"
      ? msg.content
      : msg.content.filter(b => b.type === "text").map(b => b.text).join("\n");

    if (msg.role === "system" || msg.role === "developer") {
      systemContent += (systemContent ? "\n" : "") + text;
    } else {
      messages.push({ role: msg.role, content: text });
    }
  }

  const isOAuth = auth.token!.startsWith("sk-ant-oat");
  const thinkingConfig = getThinkingConfig(tier, modelName);
  const maxTokens = req.max_tokens ?? 4096;

  const body: Record<string, unknown> = {
    model: modelName,
    messages,
    max_tokens: (thinkingConfig?.type === "enabled" && thinkingConfig.budget_tokens) ? maxTokens + thinkingConfig.budget_tokens : maxTokens,
    stream: stream,
  };

  // System prompt: for OAuth, MUST include Claude Code identity (per OpenClaw pi-ai source)
  if (isOAuth) {
    const systemBlocks: Array<{ type: string; text: string; cache_control?: { type: string } }> = [
      {
        type: "text",
        text: "You are Claude Code, Anthropic\'s official CLI for Claude.",
        cache_control: { type: "ephemeral" },
      },
    ];
    if (systemContent) {
      systemBlocks.push({
        type: "text",
        text: systemContent,
        cache_control: { type: "ephemeral" },
      });
    }
    body.system = systemBlocks;
  } else if (systemContent) {
    body.system = systemContent;
  }

  if (thinkingConfig) {
    if (thinkingConfig.type === "adaptive") {
      body.thinking = { type: "adaptive" };
    } else {
      body.thinking = {
        type: "enabled",
        budget_tokens: thinkingConfig.budget_tokens,
      };
    }
  }

  if (req.temperature !== undefined && !thinkingConfig) {
    body.temperature = req.temperature;
  }

  const url = `${config.baseUrl}/v1/messages`;
  logger.info(`→ Anthropic: ${modelName} (tier=${tier}, thinking=${thinkingConfig?.type ?? "off"}, stream=${stream})`);

  const authHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    "accept": "application/json",
  };

  if (isOAuth) {
    // OAuth tokens require Bearer auth + special beta headers (discovered from OpenClaw source)
    authHeaders["Authorization"] = `Bearer ${auth.token}`;
    authHeaders["anthropic-beta"] = "claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14,interleaved-thinking-2025-05-14";
    authHeaders["user-agent"] = "claude-cli/2.1.2 (external, cli)";
    authHeaders["x-app"] = "cli";
    authHeaders["anthropic-dangerous-direct-browser-access"] = "true";
  } else {
    authHeaders["x-api-key"] = auth.token!;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    logger.error(`Anthropic ${response.status}: ${errText}`);
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }

  if (!stream) {
    // Non-streaming: convert Anthropic response to OpenAI format
    const data = await response.json() as {
      content: Array<{ type: string; text?: string; thinking?: string }>;
      usage?: { input_tokens: number; output_tokens: number };
      model: string;
      stop_reason?: string;
    };

    const textContent = data.content
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text?: string }) => b.text ?? "")
      .join("");

    const openaiResponse = {
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: `clawrouter/${modelName}`,
      choices: [{
        index: 0,
        message: { role: "assistant", content: textContent },
        finish_reason: data.stop_reason === "end_turn" ? "stop" : (data.stop_reason ?? "stop"),
      }],
      usage: {
        prompt_tokens: data.usage?.input_tokens ?? 0,
        completion_tokens: data.usage?.output_tokens ?? 0,
        total_tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      },
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(openaiResponse));
    return;
  }

  // Streaming: convert Anthropic SSE to OpenAI SSE format
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let insideThinking = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]" || !jsonStr) continue;

        try {
          const event = JSON.parse(jsonStr);

          if (event.type === "content_block_start") {
            if (event.content_block?.type === "thinking") {
              insideThinking = true;
            } else {
              insideThinking = false;
            }
            continue;
          }

          if (event.type === "content_block_stop") {
            insideThinking = false;
            continue;
          }

          if (event.type === "content_block_delta") {
            if (insideThinking) continue; // skip thinking deltas

            const text = event.delta?.text;
            if (text) {
              const chunk = {
                id: `chatcmpl-${Date.now()}`,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: `clawrouter/${modelName}`,
                choices: [{
                  index: 0,
                  delta: { content: text },
                  finish_reason: null,
                }],
              };
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
          }

          if (event.type === "message_stop") {
            const finalChunk = {
              id: `chatcmpl-${Date.now()}`,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: `clawrouter/${modelName}`,
              choices: [{
                index: 0,
                delta: {},
                finish_reason: "stop",
              }],
            };
            res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
          }
        } catch {
          // skip unparseable lines
        }
      }
    }
  } finally {
    res.write("data: [DONE]\n\n");
    res.end();
  }
}

/**
 * Forward a chat request to OpenAI-compatible API (Kimi), streaming back as-is.
 */
async function forwardToOpenAI(
  req: ChatRequest,
  provider: string,
  modelName: string,
  tier: string,
  res: ServerResponse,
  stream: boolean,
): Promise<void> {
  const auth = getAuth(provider);
  if (!auth?.apiKey) throw new Error(`No API key for ${provider}`);

  const config = PROVIDERS[provider];
  if (!config) throw new Error(`Unknown provider: ${provider}`);

  const body: Record<string, unknown> = {
    model: modelName,
    messages: req.messages,
    stream: stream,
  };

  if (req.max_tokens) body.max_tokens = req.max_tokens;
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.top_p !== undefined) body.top_p = req.top_p;

  const url = `${config.baseUrl}/chat/completions`;
  logger.info(`→ ${provider}: ${modelName} (tier=${tier}, stream=${stream})`);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${auth.apiKey}`,
    ...config.headers,
  };

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    logger.error(`${provider} ${response.status}: ${errText}`);
    throw new Error(`${provider} API error ${response.status}: ${errText}`);
  }

  if (!stream) {
    // Non-streaming: pass through with model name rewrite
    const data = await response.json() as Record<string, unknown>;
    if (data.model) data.model = `clawrouter/${modelName}`;

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
    return;
  }

  // Streaming: pass through SSE with model name rewrite
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") {
            res.write("data: [DONE]\n\n");
            continue;
          }
          try {
            const chunk = JSON.parse(jsonStr);
            if (chunk.model) chunk.model = `clawrouter/${modelName}`;
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          } catch {
            res.write(line + "\n");
          }
        } else if (line.trim()) {
          res.write(line + "\n");
        } else {
          res.write("\n");
        }
      }
    }
  } finally {
    if (!res.writableEnded) {
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }
}

/**
 * Forward a chat completion request to the appropriate backend.
 */
export async function forwardRequest(
  chatReq: ChatRequest,
  routedModel: string,
  tier: string,
  res: ServerResponse,
  stream: boolean,
): Promise<void> {
  const { provider, model } = parseModelId(routedModel);

  const providerConfig = PROVIDERS[provider];
  if (!providerConfig) {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  if (providerConfig.api === "anthropic-messages") {
    await forwardToAnthropic(chatReq, model, tier, res, stream);
  } else {
    await forwardToOpenAI(chatReq, provider, model, tier, res, stream);
  }
}
