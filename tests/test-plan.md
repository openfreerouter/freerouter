# FreeRouter Test Plan

Run after every change: `./tests/run-all.sh`

## Test Categories

### 1. Classification (Tier Routing)
Verify the classifier assigns correct tiers.

| # | Input | Expected Tier | Notes |
|---|-------|---------------|-------|
| 1.1 | "hi" | SIMPLE | Basic greeting |
| 1.2 | "what's 2+2" | SIMPLE | Trivial factual |
| 1.3 | "translate hello to french" | SIMPLE | Simple translation |
| 1.4 | "write a python function to sort a list" | MEDIUM | Standard coding |
| 1.5 | "explain the difference between REST and GraphQL" | MEDIUM | Technical explanation |
| 1.6 | "refactor this 200-line function into clean modules" | COMPLEX | Architecture |
| 1.7 | "debug this race condition in my async code" | COMPLEX | Deep debugging |
| 1.8 | "design a distributed system for real-time trading" | REASONING | Complex architecture |
| 1.9 | "prove that P != NP" | REASONING | Deep reasoning |

### 2. Tool Call Translation (OpenAI ↔ Anthropic)
Verify tools are passed through and responses translated correctly.

| # | Test | Expected |
|---|------|----------|
| 2.1 | Send request with `tools` array | Anthropic receives tools as `input_schema` format |
| 2.2 | Model returns `tool_use` block (non-streaming) | Response has `tool_calls` in OpenAI format |
| 2.3 | Model returns `tool_use` block (streaming) | SSE chunks have `delta.tool_calls` |
| 2.4 | Multi-turn: send tool result back | Anthropic receives `tool_result` in user message |
| 2.5 | Mixed response: text + tool_use | Both content and tool_calls present |
| 2.6 | Multiple tool calls in one response | All tool_calls translated with correct indices |
| 2.7 | `finish_reason` is `"tool_calls"` when model uses tools | Not `"stop"` |

### 3. Streaming
| # | Test | Expected |
|---|------|----------|
| 3.1 | Simple streaming response | Valid SSE with `data:` lines, ends with `[DONE]` |
| 3.2 | Thinking blocks filtered | No thinking content leaks to output |
| 3.3 | Model name rewritten | `model` field shows `clawrouter/X` |
| 3.4 | Tool calls streamed correctly | `delta.tool_calls` with incremental arguments |

### 4. Non-Streaming
| # | Test | Expected |
|---|------|----------|
| 4.1 | Simple non-streaming response | Valid JSON, OpenAI chat completion format |
| 4.2 | Tool calls in response | `message.tool_calls` array present |
| 4.3 | Usage stats passed through | `prompt_tokens`, `completion_tokens` present |

### 5. Thinking Parameters
| # | Test | Expected |
|---|------|----------|
| 5.1 | SIMPLE tier | No thinking config sent |
| 5.2 | MEDIUM tier | `thinking: {type: "enabled", budget_tokens: 4096}` |
| 5.3 | COMPLEX tier + Opus | `thinking: {type: "adaptive"}` |
| 5.4 | REASONING tier + Opus | `thinking: {type: "adaptive"}` |

### 6. Fallback Logic
| # | Test | Expected |
|---|------|----------|
| 6.1 | Primary model 500 error | Retries with fallback model |
| 6.2 | Primary model timeout | Falls back gracefully |
| 6.3 | All models fail | Returns error to client |

### 7. Auth
| # | Test | Expected |
|---|------|----------|
| 7.1 | OAuth token used | Bearer auth + beta headers + Claude Code identity |
| 7.2 | API key used | x-api-key header |
| 7.3 | `/reload` endpoint | Reloads auth without restart |

### 8. Endpoints
| # | Test | Expected |
|---|------|----------|
| 8.1 | `GET /health` | 200 OK |
| 8.2 | `GET /v1/models` | List of available models |
| 8.3 | `GET /stats` | Request statistics |
| 8.4 | `POST /v1/chat/completions` | Routes and responds |

### 9. Error Handling
| # | Test | Expected |
|---|------|----------|
| 9.1 | Missing model field | 400 with clear error |
| 9.2 | Empty messages array | 400 with clear error |
| 9.3 | Invalid JSON body | 400 with clear error |
| 9.4 | Upstream timeout | 504 or fallback |
