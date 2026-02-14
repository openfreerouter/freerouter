/**
 * ClawRouter Provider â€” handles forwarding to backend APIs
 * Supports: Anthropic Messages API, OpenAI-compatible (Kimi, OpenAI)
 * Zero external deps â€” uses native fetch + streams.
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

// OpenAI tool types
export type OpenAIFunction = {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
};

export type OpenAITool = {
  type: "function";
  function: OpenAIFunction;
};

export type OpenAIToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

// OpenAI-format message
export type ChatMessage = {
  role: "system" | "user" | "assistant" | "developer" | "tool";
  content: string | null | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
};

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  top_p?: number;
  stop?: string[];
  tools?: OpenAITool[];
  tool_choice?: unknown;
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
 */
function getThinkingConfig(tier: string, modelId: string): { type: string; budget_tokens?: number; effort?: string } | undefined {
  if (supportsAdaptiveThinking(modelId) && (tier === "COMPLEX" || tier === "REASONING")) {
    return { type: "adaptive" };
  }
  if (tier === "MEDIUM") {
    return { type: "enabled", budget_tokens: 4096 };
  }
  return undefined;
}

/** Convert OpenAI tools to Anthropic tools format */
function convertToolsToAnthropic(tools: OpenAITool[]): Array<{ name: string; description?: string; input_schema: Record<string, unknown> }> {
  return tools.map(t => ({
    name: t.function.name,
    ...(t.function.description ? { description: t.function.description } : {}),
    input_schema: t.function.parameters ?? { type: "object", properties: {} },
  }));
}

/** Convert OpenAI tool_choice to Anthropic tool_choice format */
function convertToolChoiceToAnthropic(toolChoice: unknown): { type: string; name?: string } | undefined {
  if (toolChoice === "none") return { type: "none" };
  if (toolChoice === "auto" || toolChoice === undefined) return { type: "auto" };
  if (toolChoice === "required") return { type: "any" };
  if (typeof toolChoice === "object" && toolChoice !== null) {
    const tc = toolChoice as { type?: string; function?: { name: string } };
    if (tc.function?.name) return { type: "tool", name: tc.function.name };
  }
  return { type: "auto" };
}

/**
 * Convert OpenAI messages array to Anthropic messages format.
 * Handles system extraction, tool_calls, tool results, and content merging.
 */
function convertMessagesToAnthropic(
  openaiMessages: ChatMessage[]
): { system: string; messages: Array<{ role: string; content: unknown }> } {
  let systemContent = "";
  const messages: Array<{ role: string; content: unknown }> = [];

  for (let i = 0; i < openaiMessages.length; i++) {
    const msg = openaiMessages[i];

    // Extract system/developer messages
    if (msg.role === "system" || msg.role === "developer") {
      const text = typeof msg.content === "string"
        ? msg.content
        : (msg.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
      systemContent += (systemContent ? "\n" : "") + text;
      continue;
    }

    // Tool role -> tool_result content block (wrapped in user message)
    if (msg.role === "tool") {
      const toolResult = {
        type: "tool_result" as const,
        tool_use_id: msg.tool_call_id ?? "",
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? ""),
      };
      // Merge with previous user message if it only has tool_results
      const last = messages[messages.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content) &&
          (last.content as any[]).every((b: any) => b.type === "tool_result")) {
        (last.content as any[]).push(toolResult);
      } else {
        messages.push({ role: "user", content: [toolResult] });
      }
      continue;
    }

    // Assistant with tool_calls -> content blocks with tool_use
    if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
      const contentBlocks: Array<Record<string, unknown>> = [];
      // Include text content first
      if (msg.content) {
        const text = typeof msg.content === "string" ? msg.content
          : msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
        if (text) contentBlocks.push({ type: "text", text });
      }
      // Add tool_use blocks
      for (const tc of msg.tool_calls) {
        let input: unknown = {};
        try { input = JSON.parse(tc.function.arguments); } catch { input = {}; }
        contentBlocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
      }
      messages.push({ role: "assistant", content: contentBlocks });
      continue;
    }

    // Regular user/assistant messages
    const text = typeof msg.content === "string"
      ? msg.content
      : (msg.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
    messages.push({ role: msg.role === "assistant" ? "assistant" : "user", content: text || "" });
  }

  return { system: systemContent, messages };
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
  const { system: systemContent, messages } = convertMessagesToAnthropic(req.messages);

  const isOAuth = auth.token!.startsWith("sk-ant-oat");
  const thinkingConfig = getThinkingConfig(tier, modelName);
  const maxTokens = req.max_tokens ?? 4096;

  const body: Record<string, unknown> = {
    model: modelName,
    messages,
    max_tokens: (thinkingConfig?.type === "enabled" && thinkingConfig.budget_tokens) ? maxTokens + thinkingConfig.budget_tokens : maxTokens,
    stream: stream,
  };

  // Add tools if present
  if (req.tools && req.tools.length > 0) {
    body.tools = convertToolsToAnthropic(req.tools);
    if (req.tool_choice !== undefined) {
      body.tool_choice = convertToolChoiceToAnthropic(req.tool_choice);
    }
  }

  // System prompt
  if (isOAuth) {
    const systemBlocks: Array<{ type: string; text: string; cache_control?: { type: string } }> = [
      {
        type: "text",
        text: "You are Claude Code, Anthropic\'s official CLI for Claude.",
        cache_control: { type: "ephemeral" },
      },
    ];
    if (systemContent) {
      systemBlocks.push({ type: "text", text: systemContent, cache_control: { type: "ephemeral" } });
    }
    body.system = systemBlocks;
  } else if (systemContent) {
    body.system = systemContent;
  }

  if (thinkingConfig) {
    if (thinkingConfig.type === "adaptive") {
      body.thinking = { type: "adaptive" };
    } else {
      body.thinking = { type: "enabled", budget_tokens: thinkingConfig.budget_tokens };
    }
  }

  if (req.temperature !== undefined && !thinkingConfig) {
    body.temperature = req.temperature;
  }

  const url = `${config.baseUrl}/v1/messages`;
  logger.info(`-> Anthropic: ${modelName} (tier=${tier}, thinking=${thinkingConfig?.type ?? "off"}, stream=${stream}, tools=${req.tools?.length ?? 0})`);

  const authHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    "accept": "application/json",
  };

  if (isOAuth) {
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
    const data = await response.json() as {
      content: Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown }>;
      usage?: { input_tokens: number; output_tokens: number };
      model: string;
      stop_reason?: string;
    };

    const textContent = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");

    // Convert tool_use blocks to OpenAI tool_calls
    const toolUseBlocks = data.content.filter((b) => b.type === "tool_use");
    const toolCalls: OpenAIToolCall[] = toolUseBlocks.map((b, idx) => ({
      id: b.id ?? `call_${Date.now()}_${idx}`,
      type: "function" as const,
      function: { name: b.name ?? "", arguments: JSON.stringify(b.input ?? {}) },
    }));

    const finishReason = data.stop_reason === "tool_use" ? "tool_calls"
      : data.stop_reason === "end_turn" ? "stop"
      : (data.stop_reason ?? "stop");

    const message: Record<string, unknown> = {
      role: "assistant",
      content: textContent || (toolCalls.length > 0 ? null : ""),
    };
    if (toolCalls.length > 0) message.tool_calls = toolCalls;

    const openaiResponse = {
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: `clawrouter/${modelName}`,
      choices: [{ index: 0, message, finish_reason: finishReason }],
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
  // Track tool_use streaming state
  let currentBlockType: string | null = null;
  let currentToolIndex = -1;
  let stopReason: string | null = null;

  const makeChunk = (delta: Record<string, unknown>, finish: string | null = null) => ({
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: `clawrouter/${modelName}`,
    choices: [{ index: 0, delta, finish_reason: finish }],
  });

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
            const block = event.content_block;
            if (block?.type === "thinking") {
              insideThinking = true;
              currentBlockType = "thinking";
            } else if (block?.type === "tool_use") {
              insideThinking = false;
              currentBlockType = "tool_use";
              currentToolIndex++;
              // Emit first tool_calls chunk with id and function name
              const chunk = makeChunk({
                tool_calls: [{
                  index: currentToolIndex,
                  id: block.id,
                  type: "function",
                  function: { name: block.name, arguments: "" },
                }],
              });
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            } else {
              insideThinking = false;
              currentBlockType = block?.type ?? "text";
            }
            continue;
          }

          if (event.type === "content_block_stop") {
            insideThinking = false;
            currentBlockType = null;
            continue;
          }

          if (event.type === "content_block_delta") {
            if (insideThinking) continue;

            // Handle tool_use argument streaming
            if (currentBlockType === "tool_use" && event.delta?.type === "input_json_delta") {
              const chunk = makeChunk({
                tool_calls: [{
                  index: currentToolIndex,
                  function: { arguments: event.delta.partial_json ?? "" },
                }],
              });
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
              continue;
            }

            // Regular text delta
            const text = event.delta?.text;
            if (text) {
              res.write(`data: ${JSON.stringify(makeChunk({ content: text }))}\n\n`);
            }
          }

          if (event.type === "message_delta") {
            stopReason = event.delta?.stop_reason ?? null;
          }

          if (event.type === "message_stop") {
            const finish = stopReason === "tool_use" ? "tool_calls" : "stop";
            res.write(`data: ${JSON.stringify(makeChunk({}, finish))}\n\n`);
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
  logger.info(`-> ${provider}: ${modelName} (tier=${tier}, stream=${stream})`);

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