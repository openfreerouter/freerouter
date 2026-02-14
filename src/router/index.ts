/**
 * Smart Router Entry Point
 * Forked from ClawRouter (MIT License). No payment dependencies.
 *
 * Classifies requests and routes to the best model from YOUR configured providers.
 * 100% local — rules-based scoring handles all requests in <1ms.
 */

import type { Tier, RoutingDecision, RoutingConfig } from "./types.js";
import { classifyByRules } from "./rules.js";
import { selectModel, type ModelPricing } from "./selector.js";

export type RouterOptions = {
  config: RoutingConfig;
  modelPricing: Map<string, ModelPricing>;
};

/**
 * Route a request to the best model for the task.
 *
 * 1. Check overrides (large context, structured output)
 * 2. Run rule-based classifier (14 weighted dimensions, <1ms)
 * 3. If ambiguous, default to configurable tier
 * 4. Select model for tier
 * 5. Return RoutingDecision with metadata
 */
export function route(
  prompt: string,
  systemPrompt: string | undefined,
  maxOutputTokens: number,
  options: RouterOptions,
): RoutingDecision {
  const { config, modelPricing } = options;

  // Separate token counts: user prompt for complexity, total for context limits
  // WHY: System prompts (AGENTS.md, SOUL.md) inflate token count — a "hello" with
  // 10K system prompt shouldn't route to Opus. But total tokens still matter for context.
  const estimatedUserTokens = Math.ceil(prompt.length / 4);
  const estimatedTotalTokens = Math.ceil((`${systemPrompt ?? ""} ${prompt}`).length / 4);

  // --- Rule-based classification ---
  const ruleResult = classifyByRules(prompt, systemPrompt, estimatedUserTokens, config.scoring);

  // Determine if agentic tiers should be used
  const agenticScore = ruleResult.agenticScore ?? 0;
  const isAutoAgentic = agenticScore >= 0.69;
  const isExplicitAgentic = config.overrides.agenticMode ?? false;
  const useAgenticTiers = (isAutoAgentic || isExplicitAgentic) && config.agenticTiers != null;
  const tierConfigs = useAgenticTiers ? config.agenticTiers! : config.tiers;

  // --- Override: large context → force COMPLEX ---
  if (estimatedTotalTokens > config.overrides.maxTokensForceComplex) {
    return selectModel(
      "COMPLEX",
      0.95,
      "rules",
      `Input exceeds ${config.overrides.maxTokensForceComplex} tokens${useAgenticTiers ? " | agentic" : ""}`,
      tierConfigs,
      modelPricing,
      estimatedTotalTokens,
      maxOutputTokens,
    );
  }

  // Structured output detection
  // Only check user prompt for structured output request (system prompts often mention "json")
  const hasStructuredOutput = /json|structured|schema/i.test(prompt);

  let tier: Tier;
  let confidence: number;
  const method: "rules" | "llm" = "rules";
  let reasoning = `score=${ruleResult.score.toFixed(2)} | ${ruleResult.signals.join(", ")}`;

  if (ruleResult.tier !== null) {
    tier = ruleResult.tier;
    confidence = ruleResult.confidence;
  } else {
    tier = config.overrides.ambiguousDefaultTier;
    confidence = 0.5;
    reasoning += ` | ambiguous -> default: ${tier}`;
  }

  // Apply structured output minimum tier
  if (hasStructuredOutput) {
    const tierRank: Record<Tier, number> = { SIMPLE: 0, MEDIUM: 1, COMPLEX: 2, REASONING: 3 };
    const minTier = config.overrides.structuredOutputMinTier;
    if (tierRank[tier] < tierRank[minTier]) {
      reasoning += ` | upgraded to ${minTier} (structured output)`;
      tier = minTier;
    }
  }

  if (isAutoAgentic) {
    reasoning += " | auto-agentic";
  } else if (isExplicitAgentic) {
    reasoning += " | agentic";
  }

  return selectModel(
    tier,
    confidence,
    method,
    reasoning,
    tierConfigs,
    modelPricing,
    estimatedTotalTokens,
    maxOutputTokens,
  );
}

export { getFallbackChain, getFallbackChainFiltered, calculateModelCost } from "./selector.js";
export { DEFAULT_ROUTING_CONFIG } from "./config.js";
export type { RoutingDecision, Tier, RoutingConfig } from "./types.js";
export type { ModelPricing } from "./selector.js";
