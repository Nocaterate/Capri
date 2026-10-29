#!/usr/bin/env bash
# Connects Hermes Agent (inside WSL) with Capri (on Windows).
#  - turns on Hermes's API server, so Capri can use Hermes as her brain
#  - adds Capri's tool server to Hermes, so Hermes can use Capri's desktop powers
# Usage: setup-capri.sh --api-key KEY --mcp-token TOKEN [--mcp-port 43823]
#          [--brain gemini|custom --brain-model NAME --brain-url URL --brain-key KEY]   (give Hermes an AI model)
# Safe to run again: it updates its own entries and leaves everything else alone.
set -u

API_KEY="" ; MCP_TOKEN="" ; MCP_PORT="43823"
BRAIN="" ; BRAIN_MODEL="" ; BRAIN_URL="" ; BRAIN_KEY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --api-key) API_KEY="$2"; shift 2 ;;
    --mcp-token) MCP_TOKEN="$2"; shift 2 ;;
    --mcp-port) MCP_PORT="$2"; shift 2 ;;
    --brain) BRAIN="$2"; shift 2 ;;
    --brain-model) BRAIN_MODEL="$2"; shift 2 ;;
    --brain-url) BRAIN_URL="$2"; shift 2 ;;
    --brain-key) BRAIN_KEY="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 64 ;;
  esac
done
[ -n "$API_KEY" ] && [ -n "$MCP_TOKEN" ] || { echo "Missing --api-key or --mcp-token."; exit 64; }

export PATH="$HOME/.local/bin:$PATH"
HERMES_DIR="$HOME/.hermes"
[ -d "$HERMES_DIR" ] || { echo "NOT_INSTALLED: Hermes isn't installed in WSL yet."; exit 3; }

# 0) repair the `hermes` command if the installer didn't finish making it
if ! command -v hermes >/dev/null 2>&1; then
  BIN=""
  for c in "$HERMES_DIR"/hermes-agent/venv/bin/hermes "$HERMES_DIR"/hermes-agent/.venv/bin/hermes "$HERMES_DIR"/venv/bin/hermes "$HERMES_DIR"/.venv/bin/hermes; do
    [ -x "$c" ] && { BIN="$c"; break; }
  done
  [ -n "$BIN" ] || BIN="$(find "$HERMES_DIR" -maxdepth 5 -path '*bin/hermes' -type f -perm -u+x 2>/dev/null | head -n 1)"
  if [ -z "$BIN" ]; then
    echo "NOT_INSTALLED: Hermes's files are there but its program is missing. Run the Hermes installer again in Ubuntu."
    exit 3
  fi
  mkdir -p "$HOME/.local/bin"
  ln -sf "$BIN" "$HOME/.local/bin/hermes"
  echo "Repaired the hermes command"
fi
grep -q '.local/bin' "$HOME/.bashrc" 2>/dev/null || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"

# 1) find Capri from inside WSL: localhost (mirrored networking) or the Windows host (NAT networking)
CAPRI_HOST=""
GATEWAY_IP="$(ip route show default 2>/dev/null | awk '{print $3; exit}')"
for h in 127.0.0.1 $GATEWAY_IP; do
  if curl -s -m 3 "http://$h:$MCP_PORT/health" 2>/dev/null | grep -q capri; then CAPRI_HOST="$h"; break; fi
done
if [ -z "$CAPRI_HOST" ]; then
  echo "NO_CAPRI: WSL can't reach Capri on port $MCP_PORT. Keep Capri running, and turn on WSL mirrored networking."
  exit 4
fi
echo "Found Capri at $CAPRI_HOST:$MCP_PORT"

# 2) Hermes API server (for Capri's brain)
ENV_FILE="$HERMES_DIR/.env"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
set_env() {
  if grep -q "^$1=" "$ENV_FILE"; then
    python3 - "$ENV_FILE" "$1" "$2" <<'PY'
import sys
path, key, val = sys.argv[1:4]
lines = open(path).read().splitlines()
lines = [f"{key}={val}" if l.startswith(key + "=") else l for l in lines]
open(path, "w").write("\n".join(lines) + "\n")
PY
  else
    printf '\n%s=%s\n' "$1" "$2" >> "$ENV_FILE"
  fi
}
set_env API_SERVER_ENABLED true
set_env API_SERVER_KEY "$API_KEY"
echo "Turned on the Hermes API server (port 8642)"
[ "$BRAIN" = "gemini" ] && set_env GOOGLE_API_KEY "$BRAIN_KEY"

# 3) Capri's tool server in config.yaml (text edit, so your comments and formatting stay)
CONFIG="$HERMES_DIR/config.yaml"
touch "$CONFIG"
cp "$CONFIG" "$CONFIG.bak-capri"
python3 - "$CONFIG" "http://$CAPRI_HOST:$MCP_PORT/mcp" "$MCP_TOKEN" "$BRAIN" "$BRAIN_MODEL" "$BRAIN_URL" "$BRAIN_KEY" <<'PY'
import re, sys
path, url, token, brain, bmodel, burl, bkey = sys.argv[1:8]
text = open(path).read()
lines = text.splitlines()

def indent(l): return len(l) - len(l.lstrip(" "))
def meaningful(l): return l.strip() and not l.strip().startswith("#")

def block(ci):
    p, q, r = " " * ci, " " * (ci + 2), " " * (ci + 4)
    return [f"{p}capri:", f'{q}url: "{url}"', f"{q}headers:", f'{r}Authorization: "Bearer {token}"',
            f"{q}timeout: 60", f"{q}connect_timeout: 15", f"{q}enabled: true"]

i = next((k for k, l in enumerate(lines) if re.match(r"^mcp_servers\s*:", l)), None)
if i is None:
    if lines and lines[-1].strip():
        lines.append("")
    lines += ["mcp_servers:"] + block(2)
else:
    rest = re.sub(r"\s+#.*$", "", lines[i].split(":", 1)[1]).strip()
    if rest in ("", "{}", "[]", "null", "~"):
        lines[i] = "mcp_servers:"
    else:
        print("MANUAL: mcp_servers is written in a one-line style; add Capri by hand (see README).")
        sys.exit(5)
    # section = lines after i until the next top-level key
    end = len(lines)
    for k in range(i + 1, len(lines)):
        if meaningful(lines[k]) and indent(lines[k]) == 0:
            end = k
            break
    kids = [k for k in range(i + 1, end) if meaningful(lines[k])]
    ci = indent(lines[kids[0]]) if kids else 2
    # drop an older capri entry
    start = next((k for k in kids if indent(lines[k]) == ci and lines[k].strip().startswith("capri:")), None)
    if start is not None:
        stop = end
        for k in range(start + 1, end):
            if meaningful(lines[k]) and indent(lines[k]) <= ci:
                stop = k
                break
        del lines[start:stop]
    lines[i + 1:i + 1] = block(ci)

# Hermes's own AI model (only when Capri was asked to set it)
if brain:
    q = lambda v: '"' + str(v).replace('\\', '\\\\').replace('"', '\\"') + '"'
    if brain == "gemini":
        mblock = ["model:", f"  default: {q(bmodel)}", "  provider: gemini", "  base_url: https://generativelanguage.googleapis.com/v1beta"]
    else:
        mblock = ["model:", f"  default: {q(bmodel)}", "  provider: custom", f"  base_url: {q(burl)}", f"  api_key: {q(bkey)}"]
    j = next((k for k, l in enumerate(lines) if re.match(r"^model\s*:", l)), None)
    if j is None:
        lines = mblock + lines
    else:
        stop = len(lines)
        for k in range(j + 1, len(lines)):
            if meaningful(lines[k]) and indent(lines[k]) == 0:
                stop = k
                break
        lines[j:stop] = mblock

open(path, "w").write("\n".join(lines) + "\n")
try:
    import yaml
    data = yaml.safe_load(open(path))
    assert data["mcp_servers"]["capri"]["url"] == url
    if brain: assert data["model"]["default"] == bmodel
except ImportError:
    pass
except Exception as e:
    print(f"BAD_YAML: {e}")
    sys.exit(6)
PY
status=$?
if [ $status -ne 0 ]; then
  cp "$CONFIG.bak-capri" "$CONFIG"
  echo "Left config.yaml unchanged."
  exit $status
fi
echo "Added Capri's tools to Hermes (they show up as mcp_capri_*)"
[ -n "$BRAIN" ] && echo "Gave Hermes an AI model: $BRAIN_MODEL"
chmod 600 "$CONFIG"
echo "OK"
