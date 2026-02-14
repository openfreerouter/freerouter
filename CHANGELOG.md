# Changelog

## [1.0.0] — 2026-02-14

### 🚀 First Full Release — Proxy Server + Smart Routing

The first complete release of FreeRouter: a self-hosted, OpenAI-compatible proxy that classifies requests by complexity and routes them to the best model using your own API keys.

### Added

- **Proxy server** (`src/server.ts`) — zero-dependency HTTP server exposing OpenAI-compatible `/v1/chat/completions` endpoint
- **Provider translation** (`src/provider.ts`) — translates between Anthropic Messages API and OpenAI format:
  - `content_block` / `tool_use` → OpenAI `tool_calls` / `function` format
  - Streaming `input_json_delta` → streamed `arguments` chunks
  - Thinking block filtering (no XML/thinking leak to clients)
  - Non-streaming tool call support with proper `finish_reason: "tool_calls"`
- **Auth module** (`src/auth.ts`) — reads OpenClaw's `auth-profiles.json` for API keys
  - Supports Anthropic OAuth tokens (`sk-ant-oat*`) with Claude Code identity headers
  - Supports standard API keys for any provider
- **Logger** (`src/logger.ts`) — minimal, zero-dep request logging with configurable levels
- **Model definitions** (`src/models.ts`) — model catalog with pricing for cost estimation
- **14-dimension weighted classifier** (`src/router/`) — scores requests across:
  - Token count, code presence, reasoning markers, technical terms, creative markers
  - Simple indicators, multi-step patterns, question complexity, imperative verbs
  - Constraint count, output format, reference complexity, negation, domain specificity
  - Agentic task detection (auto-switches to agentic tier configs)
- **Tier-based routing**:
  - SIMPLE → Kimi K2.5 (near-zero cost)
  - MEDIUM → Claude Sonnet 4.5 (balanced)
  - COMPLEX → Claude Opus 4.6 (powerful)
  - REASONING → Claude Opus 4.6 (max thinking)
- **Fallback chains** — automatic retry with fallback model on failure
- **Adaptive thinking** — auto-configures thinking per model:
  - Sonnet: `{ type: "enabled", budget_tokens: 4096 }`
  - Opus: `{ type: "adaptive" }`
- **Context-aware classification** — includes last 3 conversation messages in scoring
- **Multilingual keyword support** — English, Chinese, Japanese, Russian, German
- **Test suites** — 70/70 tests passing:
  - `tests/test-proxy.sh` — 33 core tests (health, validation, routing, streaming, tools, concurrency)
  - `tests/test-proxy-extended.sh` — 37 extended tests (unicode, edge cases, stress, alternate endpoints)
- **Management endpoints**: `/health`, `/stats`, `/reload`, `/v1/models`
- **CORS support** for browser-based clients
- **Zero external dependencies** — only TypeScript + @types/node as dev deps

### Architecture

```
Client (OpenAI format) → FreeRouter (:18800) → 14-dim Classifier → Route to best model
                                                                     ├── Simple → Kimi K2.5
                                                                     ├── Medium → Sonnet 4.5
                                                                     ├── Complex → Opus 4.6
                                                                     └── Reasoning → Opus 4.6
```

### Credits

Forked from [BlockRunAI/ClawRouter](https://github.com/BlockRunAI/ClawRouter) (MIT License). Routing engine preserved; x402 payment protocol removed entirely.
