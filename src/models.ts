/**
 * Model Definitions — Direct API (No BlockRun/x402)
 *
 * Maps YOUR provider models with pricing for the cost calculator.
 * These match the models configured in your openclaw.json.
 *
 * Pricing is in USD per 1M tokens.
 * Add/remove models as you add providers to openclaw.json.
 */

export type ModelDef = {
  /** OpenClaw model ID: "provider/model-id" */
  id: string;
  name: string;
  inputPrice: number;   // $/1M input tokens
  outputPrice: number;  // $/1M output tokens
  contextWindow: number;
  maxOutput: number;
  reasoning?: boolean;
  vision?: boolean;
  agentic?: boolean;
};

// ─── YOUR CONFIGURED MODELS ───

export const MODELS: ModelDef[] = [
  // ═══ Anthropic (configured, API key active) ═══
  {
    id: "anthropic/claude-opus-4-6",
    name: "Claude Opus 4",
    inputPrice: 15,
    outputPrice: 75,
    contextWindow: 200_000,
    maxOutput: 32_000,
    reasoning: true,
    vision: true,
    agentic: true,
  },

  // ═══ Kimi/Moonshot (configured, API key active) ═══
  {
    id: "kimi-coding/kimi-for-coding",
    name: "Kimi K2.5",
    inputPrice: 0.5,
    outputPrice: 2.4,
    contextWindow: 262_144,
    maxOutput: 4_096,
    reasoning: true,
    vision: true,
    agentic: true,
  },

  // ═══ OpenAI (API key available — add to openclaw.json) ═══
  {
    id: "openai/gpt-4o",
    name: "GPT-4o",
    inputPrice: 2.5,
    outputPrice: 10,
    contextWindow: 128_000,
    maxOutput: 16_384,
    vision: true,
    agentic: true,
  },
  {
    id: "openai/gpt-4o-mini",
    name: "GPT-4o Mini",
    inputPrice: 0.15,
    outputPrice: 0.6,
    contextWindow: 128_000,
    maxOutput: 16_384,
  },
  {
    id: "openai/o3",
    name: "o3",
    inputPrice: 2.0,
    outputPrice: 8.0,
    contextWindow: 200_000,
    maxOutput: 100_000,
    reasoning: true,
  },
  {
    id: "openai/o3-mini",
    name: "o3-mini",
    inputPrice: 1.1,
    outputPrice: 4.4,
    contextWindow: 128_000,
    maxOutput: 65_536,
    reasoning: true,
  },

  // ═══ Google (service account available — add to openclaw.json) ═══
  {
    id: "google/gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    inputPrice: 1.25,
    outputPrice: 10,
    contextWindow: 1_050_000,
    maxOutput: 65_536,
    reasoning: true,
    vision: true,
  },
  {
    id: "google/gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    inputPrice: 0.15,
    outputPrice: 0.6,
    contextWindow: 1_000_000,
    maxOutput: 65_536,
  },
];

/**
 * Build the pricing map used by the router.
 */
export function buildPricingMap(): Map<string, { inputPrice: number; outputPrice: number }> {
  const map = new Map<string, { inputPrice: number; outputPrice: number }>();
  for (const m of MODELS) {
    map.set(m.id, { inputPrice: m.inputPrice, outputPrice: m.outputPrice });
  }
  return map;
}

/**
 * Get context window for a model ID.
 */
export function getContextWindow(modelId: string): number | undefined {
  return MODELS.find((m) => m.id === modelId)?.contextWindow;
}

/**
 * Check if a model supports reasoning.
 */
export function isReasoningModel(modelId: string): boolean {
  return MODELS.find((m) => m.id === modelId)?.reasoning ?? false;
}

/**
 * Check if a model is optimized for agentic workflows.
 */
export function isAgenticModel(modelId: string): boolean {
  return MODELS.find((m) => m.id === modelId)?.agentic ?? false;
}
