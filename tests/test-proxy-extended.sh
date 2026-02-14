#!/bin/bash
# ClawRouter Extended Test Suite ??? diverse edge cases and stress tests
set -uo pipefail
BASE="http://127.0.0.1:18800"
PASS=0; FAIL=0; TOTAL=0
pass() { ((PASS++)); ((TOTAL++)); echo "  ??? $1"; }
fail() { ((FAIL++)); ((TOTAL++)); echo "  ??? $1 ${2:+??? $2}"; }
section() { echo ""; echo "????????? $1 ?????????"; }

# Helper: non-streaming request, check for valid response
chat() {
  curl -s --max-time 60 -XPOST "$BASE/v1/chat/completions" \
    -H 'Content-Type: application/json' -d "$1"
}
chat_stream() {
  curl -sN --max-time 60 -XPOST "$BASE/v1/chat/completions" \
    -H 'Content-Type: application/json' -d "$1"
}
check_ok() {
  local desc="$1" body="$2"
  local R=$(chat "$body")
  echo "$R"|jq -e '.choices[0].message' &>/dev/null && pass "$desc" || fail "$desc" "$(echo "$R"|head -c200)"
}
check_stream_ok() {
  local desc="$1" body="$2"
  local S=$(chat_stream "$body")
  echo "$S"|grep -q '\[DONE\]' && pass "$desc" || fail "$desc"
}

section "DIVERSE PROMPTS ??? Non-streaming"

# 1-5: Various complexities
check_ok "Simple greeting" \
  '{"model":"auto","messages":[{"role":"user","content":"Hi there!"}],"max_tokens":10}'
check_ok "Factual question" \
  '{"model":"auto","messages":[{"role":"user","content":"What is the capital of France?"}],"max_tokens":20}'
check_ok "Translation" \
  '{"model":"auto","messages":[{"role":"user","content":"Translate hello to Japanese"}],"max_tokens":20}'
check_ok "Code generation" \
  '{"model":"auto","messages":[{"role":"user","content":"Write a fibonacci function in Rust"}],"max_tokens":200}'
check_ok "Multi-turn conversation" \
  '{"model":"auto","messages":[{"role":"user","content":"What is 5+3?"},{"role":"assistant","content":"8"},{"role":"user","content":"Multiply that by 2"}],"max_tokens":20}'

section "DIVERSE PROMPTS ??? Streaming"

# 6-8
check_stream_ok "Stream: simple" \
  '{"model":"auto","messages":[{"role":"user","content":"Say hello"}],"stream":true,"max_tokens":10}'
check_stream_ok "Stream: code" \
  '{"model":"auto","messages":[{"role":"user","content":"Write hello world in Go"}],"stream":true,"max_tokens":100}'
check_stream_ok "Stream: multi-turn" \
  '{"model":"auto","messages":[{"role":"user","content":"Name a color"},{"role":"assistant","content":"Blue"},{"role":"user","content":"Name another"}],"stream":true,"max_tokens":20}'

section "UNICODE & SPECIAL CHARACTERS"

# 9-12
check_ok "Chinese" \
  '{"model":"auto","messages":[{"role":"user","content":"??????????????????"}],"max_tokens":20}'
check_ok "Japanese" \
  '{"model":"auto","messages":[{"role":"user","content":"????????????????????????????????????"}],"max_tokens":20}'
check_ok "Emoji heavy" \
  '{"model":"auto","messages":[{"role":"user","content":"???????????? What do these emojis mean?"}],"max_tokens":50}'
check_ok "Mixed scripts" \
  '{"model":"auto","messages":[{"role":"user","content":"Say ???????????? and ?????????? and ??????"}],"max_tokens":30}'

section "EDGE CASES"

# 13: Very short content
check_ok "Single char content" \
  '{"model":"auto","messages":[{"role":"user","content":"?"}],"max_tokens":10}'

# 14: Newlines in content
check_ok "Newlines in content" \
  '{"model":"auto","messages":[{"role":"user","content":"Line 1\nLine 2\nLine 3\nSummarize"}],"max_tokens":30}'

# 15: Temperature=0
check_ok "Temperature=0" \
  '{"model":"auto","messages":[{"role":"user","content":"Say hello"}],"max_tokens":10,"temperature":0}'

# 16: Temperature=2 (out of range for Anthropic ??? should error)
H=$(curl -so/dev/null -w"%{http_code}" --max-time 30 -XPOST "$BASE/v1/chat/completions" \
  -H'Content-Type: application/json' \
  -d '{"model":"auto","messages":[{"role":"user","content":"Say hello"}],"max_tokens":10,"temperature":2}')
[ "$H" = "502" ] && pass "Temperature=2 ??? 502 (out of range)" || fail "Temperature=2" "Got $H"

# 17: max_tokens=1
R=$(chat '{"model":"auto","messages":[{"role":"user","content":"hello"}],"max_tokens":1}')
echo "$R"|jq -e '.choices[0]' &>/dev/null && pass "max_tokens=1" || fail "max_tokens=1" "$(echo "$R"|head -c200)"

# 18: Multiple system messages
check_ok "Multiple system msgs" \
  '{"model":"auto","messages":[{"role":"system","content":"Be brief."},{"role":"system","content":"Respond in uppercase."},{"role":"user","content":"hi"}],"max_tokens":20}'

# 19: developer role
check_ok "Developer role msg" \
  '{"model":"auto","messages":[{"role":"developer","content":"Be concise"},{"role":"user","content":"What is 2+2?"}],"max_tokens":10}'

# 20: Content as array (multimodal format)
check_ok "Content array format" \
  '{"model":"auto","messages":[{"role":"user","content":[{"type":"text","text":"Say hi"}]}],"max_tokens":10}'

section "TOOL SCENARIOS"

# 21: Multiple tools defined
R=$(chat '{"model":"auto","messages":[{"role":"user","content":"What is the weather in Tokyo and get the time?"}],"tools":[{"type":"function","function":{"name":"get_weather","description":"Get weather","parameters":{"type":"object","properties":{"city":{"type":"string"}}}}},{"type":"function","function":{"name":"get_time","description":"Get time","parameters":{"type":"object","properties":{"tz":{"type":"string"}}}}}],"tool_choice":"auto","max_tokens":200}')
echo "$R"|jq -e '.choices[0].message' &>/dev/null && pass "Multiple tools defined" || fail "Multiple tools"

# 22: tool_choice=none (should not use tools)
R=$(chat '{"model":"auto","messages":[{"role":"user","content":"Weather in Paris?"}],"tools":[{"type":"function","function":{"name":"get_weather","description":"Get weather","parameters":{"type":"object","properties":{"city":{"type":"string"}}}}}],"tool_choice":"none","max_tokens":100}')
TC=$(echo "$R"|jq -r '.choices[0].message.tool_calls // empty' 2>/dev/null)
if [ "$TC" = "" ] || [ "$TC" = "null" ]; then
  pass "tool_choice=none: no tools used"
else
  fail "tool_choice=none" "Tools were used: $TC"
fi

# 23: Complex tool result chain
check_ok "Tool result with JSON" \
  '{"model":"auto","messages":[{"role":"user","content":"Summarize the data"},{"role":"assistant","content":null,"tool_calls":[{"id":"c1","type":"function","function":{"name":"get_data","arguments":"{}"}}]},{"role":"tool","tool_call_id":"c1","content":"{\"users\":100,\"revenue\":5000,\"growth\":\"15%\"}"}],"tools":[{"type":"function","function":{"name":"get_data","description":"Get data","parameters":{"type":"object","properties":{}}}}],"max_tokens":100}'

# 24: Streaming with tools
S=$(chat_stream '{"model":"auto","messages":[{"role":"user","content":"Get weather in London. Use get_weather."}],"tools":[{"type":"function","function":{"name":"get_weather","description":"Get weather","parameters":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}}],"tool_choice":"auto","stream":true,"max_tokens":200}')
echo "$S"|grep -q '\[DONE\]' && pass "Stream with tools completes" || fail "Stream with tools"

section "ERROR HANDLING"

# 25: Unknown provider
H=$(curl -so/dev/null -w"%{http_code}" --max-time 15 -XPOST "$BASE/v1/chat/completions" \
  -H'Content-Type: application/json' \
  -d '{"model":"fakeprovider/fake-model","messages":[{"role":"user","content":"hi"}],"max_tokens":5}')
[ "$H" = "502" ] && pass "Unknown provider ??? 502" || fail "Unknown provider" "Got $H"

# 26: POST to GET endpoint
H=$(curl -so/dev/null -w"%{http_code}" -XPOST "$BASE/v1/models")
[ "$H" = "404" ] && pass "POST /v1/models ??? 404" || fail "POST /models" "$H"

# 27: GET to POST endpoint
H=$(curl -so/dev/null -w"%{http_code}" "$BASE/v1/chat/completions")
[ "$H" = "404" ] && pass "GET /v1/chat/completions ??? 404" || fail "GET /chat" "$H"

# 28: Empty body
H=$(curl -so/dev/null -w"%{http_code}" -XPOST "$BASE/v1/chat/completions" -H'Content-Type: application/json' -d '')
[ "$H" = "400" ] && pass "Empty body ??? 400" || fail "Empty body" "$H"

section "RESPONSE QUALITY"

# 29: Check X-ClawRouter headers present
HD=$(curl -sD- -o/dev/null --max-time 60 -XPOST "$BASE/v1/chat/completions" \
  -H'Content-Type: application/json' \
  -d '{"model":"auto","messages":[{"role":"user","content":"hi"}],"max_tokens":5}' 2>/dev/null)
echo "$HD"|grep -qi 'x-clawrouter-model' && pass "X-ClawRouter-Model header" || fail "Model header"
echo "$HD"|grep -qi 'x-clawrouter-tier' && pass "X-ClawRouter-Tier header" || fail "Tier header"
echo "$HD"|grep -qi 'x-clawrouter-reasoning' && pass "X-ClawRouter-Reasoning header" || fail "Reasoning header"

# 32: Response model is always prefixed
R=$(chat '{"model":"auto","messages":[{"role":"user","content":"hi"}],"max_tokens":5}')
M=$(echo "$R"|jq -r '.model' 2>/dev/null)
echo "$M"|grep -q '^clawrouter/' && pass "Model always prefixed" || fail "Model prefix" "$M"

# 33: object field correct
OBJ=$(echo "$R"|jq -r '.object' 2>/dev/null)
[ "$OBJ" = "chat.completion" ] && pass "object=chat.completion" || fail "object" "$OBJ"

section "CONCURRENT STRESS"

# 34: 5 concurrent requests
for i in $(seq 1 5); do
  chat "{\"model\":\"auto\",\"messages\":[{\"role\":\"user\",\"content\":\"Count: $i\"}],\"max_tokens\":5}" \
    > "/tmp/cr-stress-$i.json" &
done
wait
OK=0
for i in $(seq 1 5); do
  jq -e '.choices[0].message.content' "/tmp/cr-stress-$i.json" &>/dev/null && ((OK++))
done
[ "$OK" -eq 5 ] && pass "5 concurrent requests all OK" || fail "Concurrent stress" "$OK/5 ok"

# 35: Mixed stream + non-stream concurrent
chat '{"model":"auto","messages":[{"role":"user","content":"A"}],"max_tokens":5}' > /tmp/cr-mix-1.json &
chat_stream '{"model":"auto","messages":[{"role":"user","content":"B"}],"stream":true,"max_tokens":5}' > /tmp/cr-mix-2.txt &
chat '{"model":"auto","messages":[{"role":"user","content":"C"}],"max_tokens":5}' > /tmp/cr-mix-3.json &
wait
MIX_OK=true
jq -e '.choices[0]' /tmp/cr-mix-1.json &>/dev/null || MIX_OK=false
grep -q '\[DONE\]' /tmp/cr-mix-2.txt || MIX_OK=false
jq -e '.choices[0]' /tmp/cr-mix-3.json &>/dev/null || MIX_OK=false
$MIX_OK && pass "Mixed stream+non-stream concurrent" || fail "Mixed concurrent"

section "ALTERNATE ENDPOINTS"

# 36: /chat/completions (without /v1 prefix)
R=$(curl -s --max-time 60 -XPOST "$BASE/chat/completions" -H'Content-Type: application/json' \
  -d '{"model":"auto","messages":[{"role":"user","content":"hi"}],"max_tokens":5}')
echo "$R"|jq -e '.choices[0]' &>/dev/null && pass "/chat/completions (no /v1)" || fail "/chat/completions"

# 37: /models (without /v1 prefix)
R=$(curl -s "$BASE/models")
echo "$R"|jq -e '.data' &>/dev/null && pass "/models (no /v1)" || fail "/models"

echo ""
echo "?????????????????????????????????????????????????????????????????????????????????????????????????????????????????????"
echo "Results: $PASS passed, $FAIL failed (total $TOTAL)"
echo "?????????????????????????????????????????????????????????????????????????????????????????????????????????????????????"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
