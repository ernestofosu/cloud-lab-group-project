#!/usr/bin/env bash
# ============================================================================
# GT Library API smoke test
# ============================================================================
# Exercises every route as admin / lecturer / student and reports pass/fail.
#
#   bash backend/scripts/smoke-test.sh                   # http://127.0.0.1:3000
#   BASE_URL=http://13.60.13.49:3000 bash backend/scripts/smoke-test.sh
#
# Requires: curl, node (for JSON field extraction). Safe to re-run — the test
# users it registers are reused on later runs, and it deletes what it creates.
# ============================================================================
set -uo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
API="$BASE_URL/api"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@athenaeum.edu.gh}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-${ADMIN_SEED_PASSWORD:-Admin@12345}}"

# Suffix keeps re-runs from colliding on the unique email constraint.
RUN_ID="${RUN_ID:-smoke}"
STUDENT_EMAIL="student-$RUN_ID@smoke.test"
LECTURER_EMAIL="lecturer-$RUN_ID@smoke.test"
STUDENT_PASS='Passw0rd!'
LECTURER_PASS='Passw0rd!'

BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT

PASS=0
FAIL=0
declare -a FAILED

if [ -t 1 ]; then GREEN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; OFF=$'\033[0m'
else GREEN=''; RED=''; DIM=''; OFF=''; fi

# req METHOD PATH TOKEN BODY EXPECTED_PREFIX
req() {
  local method="$1" path="$2" token="$3" body="${4:-}" expect="${5:-2}"
  local args=(-s -o "$BODY_FILE" -w '%{http_code}' -X "$method" "$API$path" --max-time 20)
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json' -d "$body")

  local code
  code=$(curl "${args[@]}" 2>/dev/null) || code="000"

  if [[ "$code" == $expect* ]]; then
    PASS=$((PASS + 1))
    printf '  %sok%s   %-6s %-42s %s\n' "$GREEN" "$OFF" "$method" "$path" "$code"
  else
    FAIL=$((FAIL + 1))
    local err
    err=$(head -c 200 "$BODY_FILE" | tr -d '\n')
    printf '  %sFAIL%s %-6s %-42s %s  %s%s%s\n' "$RED" "$OFF" "$method" "$path" "$code" "$DIM" "$err" "$OFF"
    FAILED+=("$method $path -> got $code, wanted ${expect}xx : $err")
  fi
}

# jsonfield FIELD  — read a top-level field from the last response body
jsonfield() {
  node -e '
    const fs = require("fs");
    try {
      const o = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const v = process.argv[2].split(".").reduce((a, k) => (a == null ? a : a[k]), o);
      process.stdout.write(v == null ? "" : String(v));
    } catch (e) { process.stdout.write(""); }
  ' "$BODY_FILE" "$1"
}

login() {
  curl -s -o "$BODY_FILE" -X POST "$API/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" --max-time 20 >/dev/null
  jsonfield token
}

echo "=============================================="
echo " GT Library smoke test → $API"
echo "=============================================="

echo
echo "=== PUBLIC ==="
req GET  /health                             "" "" 200
req GET  /stats                              "" "" 200
req GET  /categories                         "" "" 200
req GET  /books                              "" "" 200
req GET  "/books?q=x&sort=newest&page=1"      "" "" 200
req GET  /announcements                      "" "" 200
req POST /contact "" '{"name":"Smoke","email":"smoke@test.com","message":"hello"}' 201
req GET  /nope                                "" "" 404

echo
echo "=== REGISTRATION ==="
# 201 on the first run, 409 (duplicate email) on later runs — both are correct.
req POST /auth/register "" "{\"first_name\":\"Stu\",\"last_name\":\"Dent\",\"email\":\"$STUDENT_EMAIL\",\"password\":\"$STUDENT_PASS\",\"password_confirm\":\"$STUDENT_PASS\",\"role\":\"student\"}" 2
req POST /auth/register "" "{\"first_name\":\"Lec\",\"last_name\":\"Turer\",\"email\":\"$LECTURER_EMAIL\",\"password\":\"$LECTURER_PASS\",\"password_confirm\":\"$LECTURER_PASS\",\"role\":\"lecturer\"}" 2
req POST /auth/register "" '{"first_name":"X","email":"bad","password":"1"}' 4

AT=$(login "$ADMIN_EMAIL" "$ADMIN_PASSWORD")
ST=$(login "$STUDENT_EMAIL" "$STUDENT_PASS")
LT=$(login "$LECTURER_EMAIL" "$LECTURER_PASS")

echo
echo "tokens: admin=${#AT} student=${#ST} lecturer=${#LT}"
if [ ${#AT} -lt 10 ]; then
  echo "${RED}Admin login failed — cannot continue.${OFF}"
  echo "Check ADMIN_PASSWORD (defaults to the ADMIN_SEED_PASSWORD used on first boot)."
  exit 1
fi

echo
echo "=== AUTH / SESSION ==="
req GET  /auth/me            "$AT" "" 200
req GET  /auth/me            "$ST" "" 200
req GET  /users/me           "$ST" "" 200
req GET  /auth/me            ""    "" 401
req GET  /auth/me            "not-a-real-token" "" 401
req POST /auth/forgot-password "" '{"email":"nobody@test.com"}' 501
req POST /auth/reset-password  "" '{"token":"x","password":"Passw0rd!"}' 501

echo
echo "=== PROFILE ==="
req PUT  /users/profile "$ST" '{"first_name":"Stu","last_name":"Dent","phone":"0200000000"}' 200
req PUT  /auth/profile  "$ST" '{"first_name":"Stu","last_name":"Dent","department":"CS"}' 200
req PUT  /users/profile "$ST" '{}' 400

echo
echo "=== ADMIN ==="
req GET  /stats/admin        "$AT" "" 200
req GET  /admin/users        "$AT" "" 200
req GET  /admin/books        "$AT" "" 200
req GET  /admin/logs         "$AT" "" 200
req GET  /admin/messages     "$AT" "" 200
req GET  "/admin/messages?status=unread" "$AT" "" 200
req GET  /stats/admin        "$ST" "" 403   # RBAC: student must not reach admin stats
req GET  /admin/users        "$LT" "" 403   # RBAC: lecturer must not reach admin users

echo
echo "=== CATEGORIES (create → update → delete) ==="
req POST /categories "$AT" '{"name":"Smoke Zoology","description":"animals"}' 201
CAT_ID=$(jsonfield category_id); [ -z "$CAT_ID" ] && CAT_ID=$(jsonfield id)
req POST /categories "$AT" '{"description":"no name"}' 400
if [ -n "$CAT_ID" ]; then
  req PUT    "/categories/$CAT_ID" "$AT" '{"name":"Smoke Zoology 2","description":"updated"}' 200
  req DELETE "/categories/$CAT_ID" "$AT" "" 200
  req DELETE "/categories/$CAT_ID" "$AT" "" 404   # already gone
else
  echo "  ${DIM}skipped category update/delete — no category_id returned${OFF}"
fi

echo
echo "=== ANNOUNCEMENTS (create → delete) ==="
req POST /announcements "$AT" '{"title":"Smoke test","body":"Body text","audience":"all"}' 201
ANN_ID=$(jsonfield announcement_id); [ -z "$ANN_ID" ] && ANN_ID=$(jsonfield id)
req POST /announcements "$AT" '{"title":"Bad","body":"x","audience":"martians"}' 400
req GET  /announcements "$ST" "" 200
if [ -n "$ANN_ID" ]; then
  req DELETE "/announcements/$ANN_ID" "$AT" "" 200
  req DELETE "/announcements/$ANN_ID" "$AT" "" 404
else
  echo "  ${DIM}skipped announcement delete — no announcement_id returned${OFF}"
fi

echo
echo "=== LECTURER ==="
req GET /stats/lecturer  "$LT" "" 200
req GET "/books?mine=1"  "$LT" "" 200
req GET /stats/lecturer  "$ST" "" 403

echo
echo "=== STUDENT ==="
req GET /stats/student                "$ST" "" 200
req GET /bookmarks                    "$ST" "" 200
req GET /notifications                "$ST" "" 200
req GET /notifications/unread-count   "$ST" "" 200
req PUT /notifications/read           "$ST" "" 200
req GET /books/downloads/history      "$ST" "" 200
req GET /reviews/1                    ""    "" 2

echo
echo "=== BOOK MUTATIONS (must not silently no-op) ==="
# A lecturer editing a book they do not own must be refused, and a missing book
# must 404 — the old stubs returned 200 for both without touching the database.
req PUT    /books/999999 "$LT" '{"title":"Nope"}' 4
req DELETE /books/999999 "$LT" "" 4
req PUT    /books/999999 "$ST" '{"title":"Nope"}' 403

echo
echo "=============================================="
printf ' PASS=%s  FAIL=%s  (total %s)\n' "$PASS" "$FAIL" "$((PASS + FAIL))"
echo "=============================================="

if [ "$FAIL" -gt 0 ]; then
  echo
  echo "FAILURES:"
  for f in "${FAILED[@]}"; do echo "  - $f"; done
  exit 1
fi
echo "${GREEN}All assertions passed.${OFF}"
