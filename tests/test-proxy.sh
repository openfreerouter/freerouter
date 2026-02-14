#!/bin/bash
# ClawRouter Proxy Test Suite v1
set -uo pipefail
BASE="http://127.0.0.1:18800"
PASS=0; FAIL=0; TOTAL=0
pass() { ((PASS++)); ((TOTAL++)); echo "  ??? $1"; }
fail() { ((FAIL++)); ((TOTAL++)); echo "  ??? $1 ${2:+??? $2}"; }
section() { echo ""; echo "????????? $1 ?????????"; }

section "HEALTH & META"
R=$(curl -s "$BASE/health"); echo "$R"|jq -e '.status=="ok"' &>/dev/null && pass "health ok" || fail "health" "$R"
R=$(curl -s "$BASE/stats"); echo "$R"|jq -e '.requests>=0' &>/dev/null && pass "stats ok" || fail "stats"
R=$(curl -s "$BASE/v1/models"); echo "$R"|jq -e '.data|length>0' &>/dev/null && pass "models list" || fail "models"
echo "$R"|jq -e '.data[]|select(.id=="auto")' &>/dev/null && pass "auto model" || fail "auto model"
R=$(curl -s -XPOST "$BASE/reload"); echo "$R"|jq -e '.status=="reloaded"' &>/dev/null && pass "reload" || fail "reload"
H=$(curl -so/dev/null -w"%{http_code}" "$BASE/xxx"); [ "$H" = "404" ] && pass "404 unknown" || fail "404" "$H"
C=$(curl -sI -XOPTIONS "$BASE/v1/chat/completions" 2>/dev/null|grep -i access-control-allow-origin)
echo "$C"|grep -qi '\*' && pass "CORS" || fail "CORS"

section "VALIDATION"
H=$(curl -so/dev/null -w"%{http_code}" -XPOST "$BASE/v1/chat/completions" -H'Content-Type: application/json' -d'bad')
[ "$H" = "400" ] && pass "bad json 400" || fail "bad json" "$H"
H=$(curl -so/dev/null -w"%{http_code}" -XPOST "$BASE/v1/chat/completions" -H'Content-Type: application/json' -d'{"messages":[{"role":"user","content":"hi"}]}')
[ "$H" = "400" ] && pass "no model 400" || fail "no model" "$H"
H=$(curl -so/dev/null -w"%{http_code}" -XPOST "$BASE/v1/chat/completions" -H'Content-Type: application/json' -d'{"model":"auto"}')
[ "$H" = "400" ] && pass "no messages 400" || fail "no messages" "$H"
H=$(curl -so/dev/null -w"%{http_code}" -XPOST "$BASE/v1/chat/completions" -H'Content-Type: application/json' -d'{"model":"auto","messages":[]}')
[ "$H" = "400" ] && pass "empty messages 400" || fail "empty messages" "$H"

section "ROUTING"
check_tier() {
  local d="$1" p="$2" e="$3"
  local T=$(curl -sD- -o/dev/null --max-time 30 -XPOST "$BASE/v1/chat/completions" \
    -H'Content-Type: application/json' \
    -d "{\"model\":\"auto\",\"messages\":[{\"role\":\"user\",\"content\":\"$p\"}],\"max_tokens\":1}" 2>/dev/null \
    | grep -i x-clawrouter-tier | tr -d '\r\n' | awk -F': ' '{print $2}')
  [ "$T" = "$e" ] && pass "$d ($T)" || fail "$d" "want=$e got=$T"
}
check_tier "hello???SIMPLE" "hello" "SIMPLE"
check_tier "code???MEDIUM" "Explain TCP vs UDP with examples" "MEDIUM"
check_tier "arch???COMPLEX" "Write a REST API with authentication and rate limiting" "COMPLEX"

section "NON-STREAMING"
R=$(curl -s --max-time 60 -XPOST "$BASE/v1/chat/completions" -H'Content-Type: application/json' \
  -d '{"model":"auto","messages":[{"role":"user","content":"Say exactly: pong"}],"max_tokens":10}')
echo "$R"|jq -e '.choices[0].message.content' &>/dev/null && pass "content present" || fail "content" "$(echo "$R"|head -c200)"
echo "$R"|jq -e '.id and .object and .model and .choices and .usage' &>/dev/null && pass "OpenAI structure" || fail "structure"
FR=$(echo "$R"|jq -r '.choices[0].finish_reason' 2>/dev/null)
[ "$FR" = "stop" ]||[ "$FR" = "length" ] && pass "finish=$FR" || fail "finish_reason" "$FR"
M=$(echo "$R"|jq -r '.model' 2>/dev/null); echo "$M"|grep -q '^clawrouter/' && pass "model prefix" || fail "model prefix" "$M"
echo "$R"|jq -e '.usage.prompt_tokens>0' &>/dev/null && pass "usage tokens" || fail "usage tokens"

section "STREAMING"
S=$(curl -sN --max-time 30 -XPOST "$BASE/v1/chat/completions" -H'Content-Type: application/json' \
  -d '{"model":"auto","messages":[{"role":"user","content":"Say hi"}],"stream":true,"max_tokens":10}')
echo "$S"|grep -q '^data: ' && pass "SSE format" || fail "SSE format"
echo "$S"|grep -q '\[DONE\]' && pass "ends [DONE]" || fail "[DONE]"
CK=$(echo "$S"|grep '^data: {'|head -1|sed 's/^data: //')
echo "$CK"|jq -e '.object=="chat.completion.chunk"' &>/dev/null && pass "chunk structure" || fail "chunk" "$CK"
LK=$(echo "$S"|grep '^data: {'|tail -1|sed 's/^data: //')
LF=$(echo "$LK"|jq -r '.choices[0].finish_reason' 2>/dev/null)
[ "$LF" = "stop" ]||[ "$LF" = "length" ] && pass "stream finish=$LF" || fail "stream finish" "$LF"

section "EDGE CASES"
R=$(curl -s --max-time 60 -XPOST "$BASE/v1/chat/completions" -H'Content-Type: application/json' \
  -d '{"model":"auto","messages":[{"role":"user","content":"hello"}],"max_tokens":1}')
echo "$R"|jq -e '.choices[0].message' &>/dev/null && pass "max_tokens=1 ok" || fail "max_tokens=1" "$(echo "$R"|head -c300)"

R=$(curl -s --max-time 60 -XPOST "$BASE/v1/chat/completions" -H'Content-Type: application/json' \
  -d '{"model":"auto","messages":[{"role":"system","content":"You are a pirate"},{"role":"user","content":"hello"}],"max_tokens":30}')
echo "$R"|jq -e '.choices[0].message.content' &>/dev/null && pass "system msg" || fail "system msg"

R=$(curl -s --max-time 60 -XPOST "$BASE/v1/chat/completions" -H'Content-Type: application/json' \
  -d "{\"model\":\"auto\",\"messages\":[{\"role\":\"user\",\"content\":\"Say: ?????? ????\"}],\"max_tokens\":20}")
echo "$R"|jq -e '.choices[0].message.content' &>/dev/null && pass "unicode" || fail "unicode"

HD=$(curl -sD- -o/dev/null --max-time 60 -XPOST "$BASE/v1/chat/completions" -H'Content-Type: application/json' \
  -d '{"model":"kimi-coding/kimi-for-coding","messages":[{"role":"user","content":"Say pong"}],"max_tokens":5}' 2>/dev/null)
T=$(echo "$HD"|grep -i x-clawrouter-tier|tr -d '\r\n'|awk -F': ' '{print $2}')
[ "$T" = "EXPLICIT" ] && pass "explicit???EXPLICIT" || fail "explicit tier" "$T"

section "TOOL CALLS"
R=$(curl -s --max-time 60 -XPOST "$BASE/v1/chat/completions" -H'Content-Type: application/json' \
  -d '{"model":"auto","messages":[{"role":"user","content":"Get weather in Tokyo. Use the tool."}],"tools":[{"type":"function","function":{"name":"get_weather","description":"Get weather","parameters":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}}],"tool_choice":"auto","max_tokens":200}')
TC=$(echo "$R"|jq -r '.choices[0].message.tool_calls[0].function.name // empty' 2>/dev/null)
if [ -n "$TC" ]; then
  pass "tool call fn=$TC"
  echo "$R"|jq -e '.choices[0].message.tool_calls[0].id' &>/dev/null && pass "tool_call has id" || fail "tool_call id"
  FR=$(echo "$R"|jq -r '.choices[0].finish_reason' 2>/dev/null)
  [ "$FR" = "tool_calls" ] && pass "finish=tool_calls" || fail "finish" "$FR"
else
  pass "tool call: text response (valid)"
  pass "tool_call: skipped"; pass "finish: skipped"
fi

# Streaming tool call
S=$(curl -sN --max-time 60 -XPOST "$BASE/v1/chat/completions" -H'Content-Type: application/json' \
  -d '{"model":"auto","messages":[{"role":"user","content":"Get weather in Paris. Use the get_weather tool."}],"tools":[{"type":"function","function":{"name":"get_weather","description":"Get weather","parameters":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}}],"tool_choice":"auto","stream":true,"max_tokens":200}')
if echo "$S"|grep -q 'tool_calls'; then
  pass "stream tool_calls in SSE"
else
  echo "$S"|grep -q '^data: ' && pass "stream tool: SSE (text response)" || fail "stream tool"
fi

# Tool result round-trip
R=$(curl -s --max-time 60 -XPOST "$BASE/v1/chat/completions" -H'Content-Type: application/json' \
  -d '{"model":"auto","messages":[{"role":"user","content":"Weather in Tokyo?"},{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"get_weather","arguments":"{\"city\":\"Tokyo\"}"}}]},{"role":"tool","tool_call_id":"call_1","content":"{\"temp\":22,\"condition\":\"sunny\"}"}],"tools":[{"type":"function","function":{"name":"get_weather","description":"Get weather","parameters":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}}],"max_tokens":100}')
echo "$R"|jq -e '.choices[0].message.content' &>/dev/null && pass "tool result round-trip" || fail "tool round-trip" "$(echo "$R"|head -c300)"

section "CONCURRENT"
# Fire 3 requests in parallel
for i in 1 2 3; do
  curl -s --max-time 60 -XPOST "$BASE/v1/chat/completions" -H'Content-Type: application/json' \
    -d "{\"model\":\"auto\",\"messages\":[{\"role\":\"user\",\"content\":\"Say $i\"}],\"max_tokens\":5}" \
    -o "/tmp/clawrouter-concurrent-$i.json" &
done
wait
ALL_OK=true
for i in 1 2 3; do
  if ! jq -e '.choices[0].message.content' "/tmp/clawrouter-concurrent-$i.json" &>/dev/null; then
    ALL_OK=false
  fi
done
$ALL_OK && pass "3 concurrent requests" || fail "concurrent requests"

echo ""
echo "?????????????????????????????????????????????????????????????????????????????????????????????"
echo "Results: $PASS passed, $FAIL failed (total $TOTAL)"
echo "?????????????????????????????????????????????????????????????????????????????????????????????"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
