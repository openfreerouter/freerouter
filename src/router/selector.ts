/**
 * Tier → Model Selection
 * Forked from ClawRouter (MIT License). No payment dependencies.
 *
 * Maps a classification tier to the best model from configured providers.
 * Builds RoutingDecision metadata with cost estimates and savings.
 */

import type { Tier, TierConfig, RoutingDecision } from "./types.js";

export type ModelPricing = {
  inputPrice: number; // per 1M tokens
  outputPrice: number; // per 1M tokens
};

/**
 * Select the primary model for a tier and build the RoutingDecision.
 */
export function selectModel(
  tier: Tier,
  confidence: number,
  method: "rules" | "llm",
  reasoning: string,
  tierConfigs: Record<Tier, TierConfig>,
  modelPricing: Map<string, ModelPricing>,
  estimatedInputTokens: number,
  maxOutputTokens: number,
): RoutingDecision {
  const tierConfig = tierConfigs[tier];
  const model = tierConfig.primary;
  const pricing = modelPricing.get(model);

  const inputPrice = pricing?.inputPrice ?? 0;
  const outputPrice = pricing?.outputPrice ?? 0;
  const inputCost = (estimatedInputTokens / 1_000_000) * inputPrice;
  const outputCost = (maxOutputTokens / 1_000_000) * outputPrice;
  const costEstimate = inputCost + outputCost;

  // Baseline: what the most expensive configured model would cost
  const opusPricing = modelPricing.get("anthropic/claude-opus-4-6");
  const opusInputPrice = opusPricing?.inputPrice ?? 15;
  const opusOutputPrice = opusPricing?.outputPrice ?? 75;
  const baselineInput = (estimatedInputTokens / 1_000_000) * opusInputPrice;
  const baselineOutput = (maxOutputTokens / 1_000_000) * opusOutputPrice;
  const baselineCost = baselineInput + baselineOutput;

  const savings = baselineCost > 0 ? Math.max(0, (baselineCost - costEstimate) / baselineCost) : 0;

  return {
    model,
    tier,
    confidence,
    method,
    reasoning,
    costEstimate,
    baselineCost,
    savings,
  };
}

/**
 * Get the ordered fallback chain for a tier: [primary, ...fallbacks].
 */
export function getFallbackChain(tier: Tier, tierConfigs: Record<Tier, TierConfig>): string[] {
  const config = tierConfigs[tier];
  return [config.primary, ...config.fallback];
}

/**
 * Calculate cost for a specific model.
 */
export function calculateModelCost(
  model: string,
  modelPricing: Map<string, ModelPricing>,
  estimatedInputTokens: number,
  maxOutputTokens: number,
): { costEstimate: number; baselineCost: number; savings: number } {
  const pricing = modelPricing.get(model);

  const inputPrice = pricing?.inputPrice ?? 0;
  const outputPrice = pricing?.outputPrice ?? 0;
  const inputCost = (estimatedInputTokens / 1_000_000) * inputPrice;
  const outputCost = (maxOutputTokens / 1_000_000) * outputPrice;
  const costEstimate = inputCost + outputCost;

  const opusPricing = modelPricing.get("anthropic/claude-opus-4-6");
  const opusInputPrice = opusPricing?.inputPrice ?? 15;
  const opusOutputPrice = opusPricing?.outputPrice ?? 75;
  const baselineInput = (estimatedInputTokens / 1_000_000) * opusInputPrice;
  const baselineOutput = (maxOutputTokens / 1_000_000) * opusOutputPrice;
  const baselineCost = baselineInput + baselineOutput;

  const savings = baselineCost > 0 ? Math.max(0, (baselineCost - costEstimate) / baselineCost) : 0;

  return { costEstimate, baselineCost, savings };
}

/**
 * Get the fallback chain filtered by context length.
 */
export function getFallbackChainFiltered(
  tier: Tier,
  tierConfigs: Record<Tier, TierConfig>,
  estimatedTotalTokens: number,
  getContextWindow: (modelId: string) => number | undefined,
): string[] {
  const fullChain = getFallbackChain(tier, tierConfigs);

  const filtered = fullChain.filter((modelId) => {
    const contextWindow = getContextWindow(modelId);
    if (contextWindow === undefined) return true;
    return contextWindow >= estimatedTotalTokens * 1.1;
  });

  if (filtered.length === 0) return fullChain;
  return filtered;
}
