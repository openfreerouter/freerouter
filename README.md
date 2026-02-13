# FreeRouter — Smart Model Routing for OpenClaw

> **Forked from [BlockRunAI/ClawRouter](https://github.com/BlockRunAI/ClawRouter).** FreeRouter strips the x402 payment protocol and gives you the same powerful 14-dimension routing engine — free, open, using your own API keys.

## How Is This Different from ClawRouter?

| | ClawRouter (BlockRunAI) | FreeRouter |
|---|---|---|
| **Routing engine** | ✅ 14-dimension classifier | ✅ Same engine, same scoring |
| **Payment layer** | x402 protocol — crypto micropayments per API call | ❌ **Removed entirely** |
| **Wallet integration** | Bitcoin/Lightning wallet required | ❌ **Removed** |
| **API keys** | Managed through payment system | ✅ **Your own keys** — reads from OpenClaw's auth or env vars |
| **Token metering** | Billed per-token via x402 | ❌ **Removed** — you pay providers directly |
| **Multi-provider** | Single provider | ✅ **Anthropic + Kimi + any OpenAI-compatible** |
| **Thinking injection** | Not included | ✅ **Auto-configures** thinking per model (Sonnet budget, Opus adaptive) |
| **Fallback logic** | Not included | ✅ **Auto-retries** with fallback model on failure |
| **Context-aware routing** | Current message only | ✅ **Last 3 messages** included in classification |
| **OpenClaw integration** | Generic | ✅ **Native** — reads auth-profiles.json, works as drop-in provider |

**In short:** Same brain, no paywall. You bring your own API keys, you control everything.

---

## What Is This?

FreeRouter is a transparent proxy that sits between OpenClaw and your AI providers. Instead of sending every message to one expensive model, it **classifies each message by complexity** and routes it to the right model automatically.

OpenClaw sees one model (`freerouter/auto`). Behind the scenes, FreeRouter picks the best backend:

```
User → OpenClaw Gateway → FreeRouter (:18800) → Classifier → Kimi K2.5 / Sonnet 4.5 / Opus 4.6
```

## Why?

- "Hello" doesn't need Opus. Kimi handles it for ~0 cost.
- "Debug this race condition in my async pipeline" does need Opus.
- You save 60-80% on API costs without sacrificing quality where it matters.

## Tier System

| Tier | When | Model | Thinking | Fallback |
|------|------|-------|----------|----------|
| SIMPLE | Greetings, factual questions, translations | Kimi K2.5 | none | Haiku 4.5 |
| MEDIUM | Code help, conversation, tool use | Sonnet 4.5 | enabled (budget: 4096) | Opus 4.6 |
| COMPLEX | Architecture, debugging, deep analysis | Opus 4.6 | adaptive | Sonnet 4.5 |
| REASONING | Multi-step logic, math proofs, system design | Opus 4.6 | adaptive | Sonnet 4.5 |

**Bias toward upgrading.** If in doubt, it picks the higher tier. Overpay over under-deliver.

## The 14-Dimension Classifier

Each message is scored on 14 dimensions (0.0–1.0):

1. **tokenCount** — message length
2. **vocabularyComplexity** — rare/technical words
3. **syntaxComplexity** — nested clauses, conditionals
4. **domainSpecificity** — specialized field knowledge needed
5. **ambiguity** — how open-ended the request is
6. **contextDependency** — needs prior conversation context
7. **reasoningDepth** — logical steps required
8. **creativityLevel** — original generation needed
9. **emotionalComplexity** — nuance in tone/sentiment
10. **multimodality** — references to images/files/links
11. **instructionComplexity** — multi-step instructions
12. **knowledgeRecency** — needs recent/current information
13. **codeComplexity** — programming difficulty
14. **mathematicalComplexity** — formal math/proofs

Scores are weighted and combined into a single complexity score. Tier boundaries:
- `< 0.0` → SIMPLE (basically: short + simple vocabulary = cheap model)
- `< 0.03` → MEDIUM
- `< 0.15` → COMPLEX
- `≥ 0.15` → REASONING

### Context-Aware

The classifier doesn't just look at the current message — it includes the **last 3 conversation messages** (truncated to 500 chars each). So if someone says "check this for me" after a long technical discussion, it inherits the complexity from context instead of being classified as SIMPLE.

## What Was Stripped from ClawRouter

These components from BlockRunAI's original were **removed entirely**:

- **x402 payment protocol** — crypto micropayments per API call
- **Wallet management** — Bitcoin/Lightning wallet integration
- **Payment verification middleware** — transaction validation before routing
- **Token metering for billing** — per-token usage tracking for payment
- **Payment-related dependencies** — all crypto/wallet npm packages

## What Was Added

- `server.ts` — OpenAI-compatible HTTP proxy (zero external dependencies)
- `provider.ts` — Multi-provider forwarding (Anthropic Messages API + Kimi/OpenAI) with SSE format translation
- `auth.ts` — Reads OpenClaw's existing auth-profiles.json (no separate key management)
- Fallback logic — if primary model fails, automatically retries with tier's fallback model
- Context-aware classification — includes recent conversation history in scoring
- Thinking parameter injection — automatically sets correct thinking config per model

## Source Code

```
freerouter/
├── src/
│   ├── server.ts        # HTTP server, OpenAI-compatible API
│   ├── provider.ts      # Forwards to Anthropic/Kimi, translates SSE formats
│   ├── auth.ts          # Reads OpenClaw's auth-profiles.json for API keys
│   ├── logger.ts        # Request logging
│   └── router/
│       ├── index.ts      # Main classifier logic (14 dimensions)
│       ├── config.ts     # Tier mappings, model configs, scoring weights
│       └── rules.ts      # Keyword-based overrides (e.g., "step by step" → REASONING)
├── dist/                # Compiled JS (run `tsc` to build)
├── tsconfig.json
└── package.json
```

## Setup Instructions

### 1. Get the Code

```bash
git clone https://github.com/YOUR_USER/freerouter.git
cd freerouter
```

### 2. Install Dependencies & Build

```bash
npm install    # just typescript + @types/node
npx tsc        # compiles to dist/
```

### 3. Configure Your Models

Edit `src/router/config.ts` — set your tier→model mappings:

```typescript
export const TIER_MODELS = {
  SIMPLE:    { model: 'kimi-for-coding', provider: 'kimi',      fallback: 'claude-haiku-4-5-20250315' },
  MEDIUM:    { model: 'claude-sonnet-4-5-20250514', provider: 'anthropic', fallback: 'claude-opus-4-0-20250115' },
  COMPLEX:   { model: 'claude-opus-4-0-20250115',   provider: 'anthropic', fallback: 'claude-sonnet-4-5-20250514' },
  REASONING: { model: 'claude-opus-4-0-20250115',   provider: 'anthropic', fallback: 'claude-sonnet-4-5-20250514' },
};
```

### 4. Configure Auth

FreeRouter reads from OpenClaw's `auth-profiles.json` automatically. Your existing API keys just work.

**For Anthropic with OAuth tokens** (from `openclaw configure`):
```typescript
// In provider.ts — the auth recipe:
// apiKey: null (don't send X-Api-Key)
// authToken: token (sends as Bearer)
// System prompt MUST start with: "You are Claude Code, Anthropic's official CLI for Claude."
// Required headers:
//   anthropic-beta: claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14
//   user-agent: claude-cli/2.1.2
//   anthropic-dangerous-direct-browser-access: true
```

**For regular Anthropic API keys** (`sk-ant-api03-*`): just set as `apiKey`, no special headers needed.

**For Kimi**: standard OpenAI-compatible, needs `User-Agent: KimiCLI/0.77` header.

### 5. Start the Proxy

```bash
node dist/src/server.js
# Listening on http://localhost:18800
```

### 6. Wire Into OpenClaw

Add to your `openclaw.json` under `providers`:

```json
{
  "providers": {
    "freerouter": {
      "baseUrl": "http://localhost:18800",
      "api": "openai-completions",
      "models": [
        { "id": "auto" }
      ]
    }
  }
}
```

Set as default model in `agents.defaults`:

```json
{
  "agents": {
    "defaults": {
      "model": "freerouter/auto",
      "models": [
        { "provider": "freerouter", "model": "auto" }
      ]
    }
  }
}
```

Restart gateway once. Done.

### 7. Verify

```bash
curl http://localhost:18800/health          # {"status":"ok"}
curl http://localhost:18800/v1/models       # lists available models
curl http://localhost:18800/stats           # request statistics
curl http://localhost:18800/reload          # reload auth keys without restart
```

## Thinking Parameters (Important!)

FreeRouter injects the correct thinking config per Anthropic model. **Get this wrong and you'll get errors.**

| Model | Thinking Config | Notes |
|-------|----------------|-------|
| Sonnet 4.5 | `{ type: "enabled", budget_tokens: 4096 }` | Must specify budget |
| Opus 4.6 | `{ type: "adaptive" }` | Model decides thinking depth (Anthropic recommended) |
| Haiku 4.5 | none | Doesn't support thinking |
| Kimi | none | Not Anthropic |

**Never use `{ type: "enabled" }` without `budget_tokens` for Sonnet** — it errors.
**Never set a budget for `adaptive`** — it's mutually exclusive.

## Proxy Architecture

The proxy speaks **OpenAI format** on both ends (to OpenClaw and from Kimi), but translates to **Anthropic Messages API** for Claude models:

```
OpenClaw (OpenAI format) → FreeRouter → classify message
  → if Kimi: forward as OpenAI /chat/completions, stream back directly
  → if Anthropic: translate to Messages API, inject thinking, stream SSE,
    translate back to OpenAI format
```

## Tuning Tips

- **Tier boundaries** in `config.ts` — lower = more messages upgrade to higher tier
- **Scoring weights** — increase `codeComplexity` weight if your use case is mostly coding
- **Keywords in `rules.ts`** — add domain-specific triggers (e.g., "kubernetes" → MEDIUM minimum)
- **Fallback order** — set based on your budget. Cheap fallbacks save money, expensive ones save quality.
- **Context window** — default 3 messages. Increase for more context-aware routing, decrease to save classifier tokens.

## Lessons Learned

1. **Anthropic OAuth tokens (`sk-ant-oat01-*`) need Claude Code identity headers** — without the system prompt prefix and beta flags, auth fails
2. **Anthropic baseUrl must NOT include `/v1`** — OpenClaw auto-appends it. Double `/v1` = 404.
3. **Kimi model ID is `kimi-for-coding`** — not `kimi-k2` or `k2p5` (those return 400)
4. **`openai-completions`** is the correct OpenClaw API format (not `openai-chat`)
5. **Proxy changes don't need gateway restart** — just recompile + restart the proxy process
6. **Gateway restart only for `openclaw.json` changes** — and never stack restarts

## Cost Impact

| Without FreeRouter | With FreeRouter | Savings |
|---|---|---|
| All Opus: ~$50/day | Mixed routing: ~$10-15/day | 60-80% |

Most messages are simple (greetings, short questions, acknowledgments). Those go to Kimi at near-zero cost. Only genuinely complex work hits Opus.

---

*Forked from [BlockRunAI/ClawRouter](https://github.com/BlockRunAI/ClawRouter) — same routing brain, no payment layer, your own API keys.*
