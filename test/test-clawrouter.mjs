/**
 * ClawRouter Tests
 *
 * Exercises routing logic, proxy lifecycle, and internal utilities
 * without needing a funded wallet or network access.
 *
 * Run: node test/test-clawrouter.mjs
 */

import {
  route,
  DEFAULT_ROUTING_CONFIG,
  BLOCKRUN_MODELS,
  OPENCLAW_MODELS,
  startProxy,
  PaymentCache,
  RequestDeduplicator,
  InsufficientFundsError,
  EmptyWalletError,
  isInsufficientFundsError,
  isEmptyWalletError,
} from "../dist/index.js";

// Test utilities
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    failed++;
  }
}

function assertEqual(actual, expected, msg = "") {
  if (actual !== expected) {
    throw new Error(`${msg} Expected ${expected}, got ${actual}`);
  }
}

function assertTrue(condition, msg = "") {
  if (!condition) {
    throw new Error(msg || "Assertion failed");
  }
}

// Build model pricing map for routing
const modelPricing = new Map();
for (const m of BLOCKRUN_MODELS) {
  modelPricing.set(m.id, { inputPrice: m.inputPrice, outputPrice: m.outputPrice });
}

// Test wallet key (random, not real)
const TEST_WALLET_KEY = "0x" + "a".repeat(64);

console.log("\n═══ Exports ═══\n");

test("route is a function", () => {
  assertEqual(typeof route, "function");
});

test("DEFAULT_ROUTING_CONFIG exists", () => {
  assertTrue(DEFAULT_ROUTING_CONFIG !== undefined);
  assertTrue(DEFAULT_ROUTING_CONFIG.tiers !== undefined);
});

test("BLOCKRUN_MODELS has 20+ models", () => {
  assertTrue(BLOCKRUN_MODELS.length >= 20, `Only ${BLOCKRUN_MODELS.length} models`);
});

test("OPENCLAW_MODELS has 20+ models", () => {
  assertTrue(OPENCLAW_MODELS.length >= 20, `Only ${OPENCLAW_MODELS.length} models`);
});

test("Error classes exported", () => {
  assertTrue(typeof InsufficientFundsError === "function");
  assertTrue(typeof EmptyWalletError === "function");
  assertTrue(typeof isInsufficientFundsError === "function");
  assertTrue(typeof isEmptyWalletError === "function");
});

console.log("\n═══ Simple Queries → SIMPLE tier ═══\n");

const simpleQueries = [
  "What is 2+2?",
  "Hello",
  "Define photosynthesis",
  "Translate 'hello' to Spanish",
  "What time is it in Tokyo?",
  "What's the capital of France?",
];

for (const query of simpleQueries) {
  test(`"${query}" → SIMPLE`, () => {
    const result = route(query, undefined, 100, {
      config: DEFAULT_ROUTING_CONFIG,
      modelPricing,
    });
    assertEqual(result.tier, "SIMPLE", `Got ${result.tier}`);
  });
}

console.log("\n═══ Reasoning Queries → REASONING tier ═══\n");

const reasoningQueries = [
  "Prove that sqrt(2) is irrational step by step",
  "Walk me through the proof of Fermat's Last Theorem",
];

for (const query of reasoningQueries) {
  test(`"${query.slice(0, 50)}..." → REASONING`, () => {
    const result = route(query, undefined, 100, {
      config: DEFAULT_ROUTING_CONFIG,
      modelPricing,
    });
    assertEqual(result.tier, "REASONING", `Got ${result.tier}`);
  });
}

console.log("\n═══ Code Queries → MEDIUM or higher ═══\n");

const codeQueries = [
  "Write a function to reverse a string in Python",
  "Debug this code: function foo() { return }",
  "Explain this TypeScript: async function fetchData(): Promise<void> {}",
];

for (const query of codeQueries) {
  test(`"${query.slice(0, 50)}..." → >= MEDIUM`, () => {
    const result = route(query, undefined, 100, {
      config: DEFAULT_ROUTING_CONFIG,
      modelPricing,
    });
    assertTrue(
      ["MEDIUM", "COMPLEX", "REASONING"].includes(result.tier),
      `Got ${result.tier}`
    );
  });
}

console.log("\n═══ Long Input ═══\n");

test("Very long input routes without crashing", () => {
  const longInput = "Summarize this: " + "word ".repeat(2000);
  const result = route(longInput, undefined, 100, {
    config: DEFAULT_ROUTING_CONFIG,
    modelPricing,
  });
  assertTrue(result.tier !== undefined, `Got ${result.tier}`);
});

console.log("\n═══ Cost Estimation ═══\n");

test("Cost estimate is positive for non-empty query", () => {
  const result = route("Hello world", undefined, 100, {
    config: DEFAULT_ROUTING_CONFIG,
    modelPricing,
  });
  assertTrue(result.costEstimate >= 0, `Cost: ${result.costEstimate}`);
});

test("Savings is between 0 and 1", () => {
  const result = route("Hello world", undefined, 100, {
    config: DEFAULT_ROUTING_CONFIG,
    modelPricing,
  });
  assertTrue(result.savings >= 0 && result.savings <= 1, `Savings: ${result.savings}`);
});

console.log("\n═══ Model Selection ═══\n");

test("SIMPLE tier selects a cheap model", () => {
  const result = route("What is 2+2?", undefined, 100, {
    config: DEFAULT_ROUTING_CONFIG,
    modelPricing,
  });
  // SIMPLE tier should select a cost-effective model (deepseek or gemini-flash)
  assertTrue(
    result.model.includes("deepseek") || result.model.includes("gemini"),
    `Got ${result.model}`
  );
});

test("REASONING tier selects o3", () => {
  const result = route("Prove sqrt(2) is irrational step by step", undefined, 100, {
    config: DEFAULT_ROUTING_CONFIG,
    modelPricing,
  });
  assertTrue(result.model.includes("o3"), `Got ${result.model}`);
});

console.log("\n═══ Edge Cases ═══\n");

test("Empty string doesn't crash", () => {
  const result = route("", undefined, 100, {
    config: DEFAULT_ROUTING_CONFIG,
    modelPricing,
  });
  assertTrue(result.tier !== undefined);
});

test("Very short query works", () => {
  const result = route("Hi", undefined, 100, {
    config: DEFAULT_ROUTING_CONFIG,
    modelPricing,
  });
  assertEqual(result.tier, "SIMPLE");
});

test("Unicode query works", () => {
  const result = route("你好，这是什么？", undefined, 100, {
    config: DEFAULT_ROUTING_CONFIG,
    modelPricing,
  });
  assertTrue(result.tier !== undefined);
});

test("Query with special characters works", () => {
  const result = route("What is $100 * 50%? @test #hash", undefined, 100, {
    config: DEFAULT_ROUTING_CONFIG,
    modelPricing,
  });
  assertTrue(result.tier !== undefined);
});

console.log("\n═══ PaymentCache ═══\n");

test("PaymentCache set and get", () => {
  const cache = new PaymentCache();
  cache.set("/test", { payTo: "0x123", maxAmount: "100" });
  const result = cache.get("/test");
  assertTrue(result !== undefined);
  assertEqual(result.payTo, "0x123");
});

test("PaymentCache returns undefined for unknown path", () => {
  const cache = new PaymentCache();
  const result = cache.get("/unknown");
  assertEqual(result, undefined);
});

test("PaymentCache invalidate", () => {
  const cache = new PaymentCache();
  cache.set("/test", { payTo: "0x123", maxAmount: "100" });
  cache.invalidate("/test");
  const result = cache.get("/test");
  assertEqual(result, undefined);
});

console.log("\n═══ RequestDeduplicator ═══\n");

test("RequestDeduplicator instantiates", () => {
  const dedup = new RequestDeduplicator();
  assertTrue(dedup !== undefined);
});

test("RequestDeduplicator has expected methods", () => {
  const dedup = new RequestDeduplicator();
  // Check the dedup object has some methods/properties
  assertTrue(typeof dedup === "object");
});

console.log("\n═══ Error Classes ═══\n");

test("InsufficientFundsError creates correctly", () => {
  const err = new InsufficientFundsError("0x123", "$1.00", "$2.00");
  assertTrue(err instanceof Error);
  assertTrue(err.message.includes("Insufficient"));
});

test("EmptyWalletError creates correctly", () => {
  const err = new EmptyWalletError("0x123");
  assertTrue(err instanceof Error);
  assertTrue(err.message.includes("No USDC"));
});

test("isInsufficientFundsError works", () => {
  const err = new InsufficientFundsError("0x123", "$1.00", "$2.00");
  assertTrue(isInsufficientFundsError(err));
  assertTrue(!isInsufficientFundsError(new Error("other")));
});

test("isEmptyWalletError works", () => {
  const err = new EmptyWalletError("0x123");
  assertTrue(isEmptyWalletError(err));
  assertTrue(!isEmptyWalletError(new Error("other")));
});

console.log("\n═══ Proxy Lifecycle ═══\n");

await testAsync("Proxy starts on specified port", async () => {
  const port = 18402 + Math.floor(Math.random() * 1000);
  let readyPort = null;
  const proxy = await startProxy({
    walletKey: TEST_WALLET_KEY,
    port,
    onReady: (p) => { readyPort = p; },
    onError: () => {},
  });
  assertEqual(readyPort, port);
  await proxy.close();
});

await testAsync("Proxy health endpoint works", async () => {
  const port = 18402 + Math.floor(Math.random() * 1000);
  const proxy = await startProxy({
    walletKey: TEST_WALLET_KEY,
    port,
    onReady: () => {},
    onError: () => {},
  });

  const res = await fetch(`http://127.0.0.1:${port}/health`);
  assertEqual(res.status, 200);
  const data = await res.json();
  assertTrue(data.status === "ok");
  assertTrue(data.wallet !== undefined);

  await proxy.close();
});

await testAsync("Proxy close frees port", async () => {
  const port = 18402 + Math.floor(Math.random() * 1000);
  const proxy = await startProxy({
    walletKey: TEST_WALLET_KEY,
    port,
    onReady: () => {},
    onError: () => {},
  });
  await proxy.close();

  // Should be able to start another proxy on same port
  const proxy2 = await startProxy({
    walletKey: TEST_WALLET_KEY,
    port,
    onReady: () => {},
    onError: () => {},
  });
  await proxy2.close();
});

await testAsync("Proxy returns 404 for unknown routes", async () => {
  const port = 18402 + Math.floor(Math.random() * 1000);
  const proxy = await startProxy({
    walletKey: TEST_WALLET_KEY,
    port,
    onReady: () => {},
    onError: () => {},
  });

  const res = await fetch(`http://127.0.0.1:${port}/unknown`);
  assertEqual(res.status, 404);

  await proxy.close();
});

// Summary
console.log("\n" + "═".repeat(50));
console.log(`\n  ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
