/**
 * ClawRouter — Direct API Edition
 * Forked from BlockRunAI/ClawRouter (MIT License).
 *
 * Smart 14-dimension weighted routing WITHOUT x402/BlockRun/wallet.
 * Routes to YOUR configured providers using YOUR API keys.
 *
 * Usage:
 *   import { route, DEFAULT_ROUTING_CONFIG, buildPricingMap } from "./index.js";
 *
 *   const decision = route("Prove sqrt(2) is irrational", undefined, 4096, {
 *     config: DEFAULT_ROUTING_CONFIG,
 *     modelPricing: buildPricingMap(),
 *   });
 *
 *   console.log(decision);
 *   // { model: "anthropic/claude-opus-4-6", tier: "REASONING", confidence: 0.97, ... }
 */

// Router
export { route, DEFAULT_ROUTING_CONFIG } from "./router/index.js";
export { getFallbackChain, getFallbackChainFiltered, calculateModelCost } from "./router/selector.js";
export { classifyByRules } from "./router/rules.js";

// Types
export type {
  RoutingDecision,
  RoutingConfig,
  Tier,
  TierConfig,
  ScoringConfig,
  ScoringResult,
} from "./router/types.js";
export type { ModelPricing } from "./router/selector.js";

// Models
export { MODELS, buildPricingMap, getContextWindow, isReasoningModel, isAgenticModel } from "./models.js";
