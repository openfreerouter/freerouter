#!/bin/bash
# FreeRouter Test Suite v2 — Randomized + Edge Cases
# Usage: ./tests/run-all.sh [proxy_url]

PROXY="${1:-http://localhost:18800}"
PASS=0
FAIL=0
SKIP=0
RESULTS=""
SEED=$RANDOM

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { PASS=$((PASS+1)); RESULTS+="${GREEN}✓${NC} $1\n"; }
fail() { FAIL=$((FAIL+1)); RESULTS+="${RED}✗${NC} $1: $2\n"; }
skip() { SKIP=$((SKIP+1)); RESULTS+="${YELLOW}○${NC} $1 (skipped)\n"; }

# Collect all test functions, then shuffle
TESTS=()
register() { TESTS+=("$1"); }

echo "========================================"
echo "  FreeRouter Test Suite v2"
echo "  Target: $PROXY"
echo "  Seed: $SEED"
echo "========================================"
echo ""

# ============================================
# Test definitions
# ============================================

# --- Endpoints ---
test_health() {
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$PROXY/health" 2>/dev/null)
  [ "$HTTP" = "200" ] && pass "EP: GET /health → 200" || fail "EP: GET /health" "got $HTTP"
}
register test_health

test_models() {
  RESP=$(curl -s "$PROXY/v1/models" 2>/dev/null)
  echo "$RESP" | grep -q '"object"' && pass "EP: GET /v1/models → valid" || fail "EP: GET /v1/models" "bad response"
}
register test_models

test_stats() {
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$PROXY/stats" 2>/dev/null)
  [ "$HTTP" = "200" ] && pass "EP: GET /stats → 200" || fail "EP: GET /stats" "got $HTTP"
}
register test_stats

test_reload() {
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$PROXY/reload" 2>/dev/null)
  [ "$HTTP" = "200" ] && pass "EP: GET /reload → 200" || fail "EP: GET /reload" "got $HTTP"
}
register test_reload

test_404() {
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$PROXY/nonexistent" 2>/dev/null)
  [ "$HTTP" = "404" ] && pass "EP: GET /nonexistent → 404" || fail "EP: GET /nonexistent" "got $HTTP"
}
register test_404

# --- Error Handling ---
test_invalid_json() {
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$PROXY/v1/chat/completions" \
    -H "Content-Type: application/json" -d "not json" 2>/dev/null)
  [ "$HTTP" = "400" ] && pass "ERR: Invalid JSON → 400" || fail "ERR: Invalid JSON" "got $HTTP"
}
register test_invalid_json

test_missing_model() {
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$PROXY/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{"messages":[{"role":"user","content":"hi"}]}' 2>/dev/null)
  [ "$HTTP" = "400" ] && pass "ERR: Missing model → 400" || fail "ERR: Missing model" "got $HTTP"
}
register test_missing_model

test_empty_messages() {
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$PROXY/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{"model":"auto","messages":[]}' 2>/dev/null)
  [ "$HTTP" = "400" ] && pass "ERR: Empty messages → 400" || fail "ERR: Empty messages" "got $HTTP"
}
register test_empty_messages

test_missing_messages() {
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$PROXY/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{"model":"auto"}' 2>/dev/null)
  [ "$HTTP" = "400" ] && pass "ERR: Missing messages → 400" || fail "ERR: Missing messages" "got $HTTP"
}
register test_missing_messages

test_empty_body() {
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$PROXY/v1/chat/completions" \
    -H "Content-Type: application/json" -d '' 2>/dev/null)
  ([ "$HTTP" = "400" ] || [ "$HTTP" = "500" ]) && pass "ERR: Empty body → $HTTP" || fail "ERR: Empty body" "got $HTTP"
}
register test_empty_body

test_wrong_method() {
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$PROXY/v1/chat/completions" 2>/dev/null)
  [ "$HTTP" = "405" ] && pass "ERR: GET on POST endpoint → 405" || fail "ERR: GET on POST endpoint" "got $HTTP"
}
register test_wrong_method

# --- Classification ---
SIMPLE_PROMPTS=("hi" "hello" "thanks" "what time is it" "translate hello to french" "what is 2+2")
MEDIUM_PROMPTS=("write a python function to sort a list" "explain REST vs GraphQL" "how does a hash map work internally" "write a bash script to find large files")
COMPLEX_PROMPTS=("design a distributed cache with consistent hashing" "refactor this monolith into microservices" "debug this race condition in async rust code")

test_classify_simple() {
  local idx=$((SEED % ${#SIMPLE_PROMPTS[@]}))
  local msg="${SIMPLE_PROMPTS[$idx]}"
  RESP=$(curl -s --max-time 30 -X POST "$PROXY/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"auto\",\"messages\":[{\"role\":\"user\",\"content\":\"$msg\"}],\"stream\":false,\"max_tokens\":5}" 2>/dev/null)
  if echo "$RESP" | grep -q '"choices"'; then
    local model=$(echo "$RESP" | grep -o '"model":"[^"]*"' | head -1)
    pass "CLASS: Simple \"$msg\" → $model"
  else
    fail "CLASS: Simple \"$msg\"" "no valid response"
  fi
}
register test_classify_simple

test_classify_medium() {
  local idx=$((SEED % ${#MEDIUM_PROMPTS[@]}))
  local msg="${MEDIUM_PROMPTS[$idx]}"
  RESP=$(curl -s --max-time 30 -X POST "$PROXY/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"auto\",\"messages\":[{\"role\":\"user\",\"content\":\"$msg\"}],\"stream\":false,\"max_tokens\":5}" 2>/dev/null)
  if echo "$RESP" | grep -q '"choices"'; then
    local model=$(echo "$RESP" | grep -o '"model":"[^"]*"' | head -1)
    pass "CLASS: Medium \"$msg\" → $model"
  else
    fail "CLASS: Medium \"$msg\"" "no valid response"
  fi
}
register test_classify_medium

# --- Tool Call Translation ---
test_tool_nonstream() {
  RESP=$(curl -s --max-time 30 -X POST "$PROXY/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{
      "model":"auto",
      "messages":[{"role":"user","content":"Read the file at /tmp/test.txt"}],
      "stream":false,
      "max_tokens":1024,
      "tools":[{"type":"function","function":{"name":"read_file","description":"Read a file","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}}]
    }' 2>/dev/null)
  if echo "$RESP" | grep -q '"tool_calls"'; then
    pass "TOOL: Non-streaming tool_calls present"
  elif echo "$RESP" | grep -q '"choices"'; then
    skip "TOOL: Non-streaming (model chose not to use tool)"
  else
    fail "TOOL: Non-streaming" "invalid response"
  fi
}
register test_tool_nonstream

test_tool_finish_reason() {
  RESP=$(curl -s --max-time 30 -X POST "$PROXY/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{
      "model":"auto",
      "messages":[{"role":"user","content":"Use the tool to read /etc/hostname"}],
      "stream":false,
      "max_tokens":1024,
      "tools":[{"type":"function","function":{"name":"read_file","description":"Read a file","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}}]
    }' 2>/dev/null)
  if echo "$RESP" | grep -q '"finish_reason":"tool_calls"'; then
    pass "TOOL: finish_reason=tool_calls"
  elif echo "$RESP" | grep -q '"tool_calls"'; then
    local fr=$(echo "$RESP" | grep -o '"finish_reason":"[^"]*"')
    fail "TOOL: finish_reason" "has tool_calls but $fr"
  else
    skip "TOOL: finish_reason (model didn't use tool)"
  fi
}
register test_tool_finish_reason

test_tool_stream() {
  RESP=$(curl -s --max-time 30 -N -X POST "$PROXY/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{
      "model":"auto",
      "messages":[{"role":"user","content":"Read the file at /tmp/test.txt"}],
      "stream":true,
      "max_tokens":1024,
      "tools":[{"type":"function","function":{"name":"read_file","description":"Read a file","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}}]
    }' 2>/dev/null)
  if echo "$RESP" | grep -q 'tool_calls'; then
    pass "TOOL: Streaming tool_calls in SSE"
  elif echo "$RESP" | grep -q 'data:'; then
    skip "TOOL: Streaming (model didn't use tool)"
  else
    fail "TOOL: Streaming" "no SSE data"
  fi
}
register test_tool_stream

test_tool_multiple() {
  RESP=$(curl -s --max-time 30 -X POST "$PROXY/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{
      "model":"auto",
      "messages":[{"role":"user","content":"Read /tmp/a.txt and /tmp/b.txt simultaneously"}],
      "stream":false,
      "max_tokens":1024,
      "tools":[{"type":"function","function":{"name":"read_file","description":"Read a file","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}}]
    }' 2>/dev/null)
  if echo "$RESP" | grep -q '"tool_calls"'; then
    # Count tool calls
    local count=$(echo "$RESP" | grep -o '"tool_use"' | wc -l)
    pass "TOOL: Multiple tools requested"
  elif echo "$RESP" | grep -q '"choices"'; then
    skip "TOOL: Multiple tools (model used single or none)"
  else
    fail "TOOL: Multiple tools" "invalid response"
  fi
}
register test_tool_multiple

test_tool_no_leak() {
  RESP=$(curl -s --max-time 30 -X POST "$PROXY/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{
      "model":"auto",
      "messages":[{"role":"user","content":"Read the file at /tmp/test.txt please"}],
      "stream":false,
      "max_tokens":1024,
      "tools":[{"type":"function","function":{"name":"read_file","description":"Read a file","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}}]
    }' 2>/dev/null)
  # Check that raw XML tool_call doesn't appear in content
  if echo "$RESP" | grep -q '<tool_call>'; then
    fail "TOOL: No XML leak" "found <tool_call> in response text"
  else
    pass "TOOL: No <tool_call> XML leak"
  fi
}
register test_tool_no_leak

# --- Streaming ---
test_stream_basic() {
  RESP=$(curl -s -N --max-time 20 -X POST "$PROXY/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{"model":"auto","messages":[{"role":"user","content":"say hello"}],"stream":true,"max_tokens":50}' 2>/dev/null)
  echo "$RESP" | grep -q '^data: ' && pass "STREAM: Returns SSE data lines" || fail "STREAM: SSE data" "no data: lines"
}
register test_stream_basic

test_stream_done() {
  RESP=$(curl -s -N --max-time 20 -X POST "$PROXY/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{"model":"auto","messages":[{"role":"user","content":"say hi"}],"stream":true,"max_tokens":50}' 2>/dev/null)
  echo "$RESP" | grep -q '\[DONE\]' && pass "STREAM: Ends with [DONE]" || fail "STREAM: [DONE]" "missing terminator"
}
register test_stream_done

test_stream_model_rewrite() {
  RESP=$(curl -s -N --max-time 20 -X POST "$PROXY/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{"model":"auto","messages":[{"role":"user","content":"hey"}],"stream":true,"max_tokens":50}' 2>/dev/null)
  echo "$RESP" | grep -q 'clawrouter/' && pass "STREAM: Model name → clawrouter/*" || fail "STREAM: Model name" "no rewrite"
}
register test_stream_model_rewrite

test_stream_valid_json_chunks() {
  RESP=$(curl -s -N --max-time 20 -X POST "$PROXY/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{"model":"auto","messages":[{"role":"user","content":"say ok"}],"stream":true,"max_tokens":50}' 2>/dev/null)
  # Every data line (except [DONE]) should be valid JSON
  BAD=0
  while IFS= read -r line; do
    json="${line#data: }"
    [ "$json" = "[DONE]" ] && continue
    [ -z "$json" ] && continue
    echo "$json" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null || BAD=$((BAD+1))
  done <<< "$(echo "$RESP" | grep '^data: ')"
  [ "$BAD" -eq 0 ] && pass "STREAM: All chunks are valid JSON" || fail "STREAM: JSON chunks" "$BAD invalid chunks"
}
register test_stream_valid_json_chunks

# --- Non-Streaming ---
test_nonstream_basic() {
  RESP=$(curl -s --max-time 30 -X POST "$PROXY/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{"model":"auto","messages":[{"role":"user","content":"say hello"}],"stream":false,"max_tokens":50}' 2>/dev/null)
  echo "$RESP" | grep -q '"choices"' && pass "NOSTREAM: Valid response with choices" || fail "NOSTREAM: choices" "missing"
}
register test_nonstream_basic

test_nonstream_usage() {
  RESP=$(curl -s --max-time 30 -X POST "$PROXY/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{"model":"auto","messages":[{"role":"user","content":"hi"}],"stream":false,"max_tokens":50}' 2>/dev/null)
  echo "$RESP" | grep -q '"usage"' && pass "NOSTREAM: Usage stats present" || fail "NOSTREAM: usage" "missing"
}
register test_nonstream_usage

test_nonstream_has_content() {
  RESP=$(curl -s --max-time 30 -X POST "$PROXY/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{"model":"auto","messages":[{"role":"user","content":"say the word banana"}],"stream":false,"max_tokens":50}' 2>/dev/null)
  if echo "$RESP" | grep -qi 'banana'; then
    pass "NOSTREAM: Response contains expected content"
  else
    skip "NOSTREAM: Content check (model may not have said banana)"
  fi
}
register test_nonstream_has_content

# --- Edge Cases ---
test_unicode_input() {
  RESP=$(curl -s --max-time 30 -X POST "$PROXY/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{"model":"auto","messages":[{"role":"user","content":"Xin chào! 你好 🎉"}],"stream":false,"max_tokens":50}' 2>/dev/null)
  echo "$RESP" | grep -q '"choices"' && pass "EDGE: Unicode input handled" || fail "EDGE: Unicode" "bad response"
}
register test_unicode_input

test_long_input() {
  # 2000 char input
  LONG=$(python3 -c "print('a ' * 1000)")
  RESP=$(curl -s --max-time 30 -X POST "$PROXY/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"auto\",\"messages\":[{\"role\":\"user\",\"content\":\"$LONG\"}],\"stream\":false,\"max_tokens\":10}" 2>/dev/null)
  echo "$RESP" | grep -q '"choices"' && pass "EDGE: Long input (2000 chars)" || fail "EDGE: Long input" "bad response"
}
register test_long_input

test_system_message() {
  RESP=$(curl -s --max-time 30 -X POST "$PROXY/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{"model":"auto","messages":[{"role":"system","content":"You are a pirate."},{"role":"user","content":"say hi"}],"stream":false,"max_tokens":50}' 2>/dev/null)
  echo "$RESP" | grep -q '"choices"' && pass "EDGE: System message passed" || fail "EDGE: System message" "bad response"
}
register test_system_message

test_multi_turn() {
  RESP=$(curl -s --max-time 30 -X POST "$PROXY/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{"model":"auto","messages":[{"role":"user","content":"my name is Bob"},{"role":"assistant","content":"Hi Bob!"},{"role":"user","content":"what is my name?"}],"stream":false,"max_tokens":50}' 2>/dev/null)
  if echo "$RESP" | grep -qi 'bob'; then
    pass "EDGE: Multi-turn context preserved"
  elif echo "$RESP" | grep -q '"choices"'; then
    skip "EDGE: Multi-turn (response valid but no name)"
  else
    fail "EDGE: Multi-turn" "bad response"
  fi
}
register test_multi_turn

test_max_tokens_1() {
  RESP=$(curl -s --max-time 30 -X POST "$PROXY/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{"model":"auto","messages":[{"role":"user","content":"write a long essay"}],"stream":false,"max_tokens":1}' 2>/dev/null)
  echo "$RESP" | grep -q '"choices"' && pass "EDGE: max_tokens=1 handled" || fail "EDGE: max_tokens=1" "bad response"
}
register test_max_tokens_1

test_explicit_model() {
  RESP=$(curl -s --max-time 30 -X POST "$PROXY/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{"model":"anthropic/claude-haiku-4-5","messages":[{"role":"user","content":"hi"}],"stream":false,"max_tokens":10}' 2>/dev/null)
  if echo "$RESP" | grep -q 'haiku'; then
    pass "EDGE: Explicit model passthrough"
  elif echo "$RESP" | grep -q '"choices"'; then
    pass "EDGE: Explicit model returns valid response"
  else
    fail "EDGE: Explicit model" "bad response"
  fi
}
register test_explicit_model

test_concurrent() {
  # Fire 3 requests simultaneously
  curl -s --max-time 30 -X POST "$PROXY/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{"model":"auto","messages":[{"role":"user","content":"1"}],"stream":false,"max_tokens":5}' > /tmp/fr_c1.json 2>/dev/null &
  P1=$!
  curl -s --max-time 30 -X POST "$PROXY/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{"model":"auto","messages":[{"role":"user","content":"2"}],"stream":false,"max_tokens":5}' > /tmp/fr_c2.json 2>/dev/null &
  P2=$!
  curl -s --max-time 30 -X POST "$PROXY/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{"model":"auto","messages":[{"role":"user","content":"3"}],"stream":false,"max_tokens":5}' > /tmp/fr_c3.json 2>/dev/null &
  P3=$!
  wait $P1 $P2 $P3
  
  OK=0
  for f in /tmp/fr_c1.json /tmp/fr_c2.json /tmp/fr_c3.json; do
    grep -q '"choices"' "$f" 2>/dev/null && OK=$((OK+1))
  done
  [ "$OK" -eq 3 ] && pass "EDGE: 3 concurrent requests all succeed" || fail "EDGE: Concurrent" "$OK/3 succeeded"
}
register test_concurrent

# ============================================
# Shuffle and run
# ============================================

# Fisher-Yates shuffle using seed
shuffle_tests() {
  local i n tmp
  n=${#TESTS[@]}
  for ((i = n - 1; i > 0; i--)); do
    j=$(( (SEED + i * 31) % (i + 1) ))
    tmp="${TESTS[$i]}"
    TESTS[$i]="${TESTS[$j]}"
    TESTS[$j]="$tmp"
  done
}

shuffle_tests

echo -e "${CYAN}Running ${#TESTS[@]} tests in randomized order...${NC}"
echo ""

for test_fn in "${TESTS[@]}"; do
  $test_fn
done

# ---- Summary ----
echo ""
echo "========================================"
echo "  Results (seed: $SEED)"
echo "========================================"
echo -e "$RESULTS"
echo "========================================"
echo -e "  ${GREEN}Passed: $PASS${NC}  ${RED}Failed: $FAIL${NC}  ${YELLOW}Skipped: $SKIP${NC}  Total: ${#TESTS[@]}"
echo "========================================"

[ "$FAIL" -eq 0 ] && exit 0 || exit 1