#!/usr/bin/env bash
# Installs the Hugging Face sidecar (Chronos-Bolt + FinBERT, CPU only) into
# /opt/scenario-venv and marks it ready once a real call works. Started in
# the background by remote-deploy.sh; safe to re-run.
set -uo pipefail
APP_DIR=/opt/scenario
DATA=$APP_DIR/data
VENV=/opt/scenario-venv
echo "== $(date -u +%FT%TZ) installing models =="
command -v python3 >/dev/null || apt-get install -y -qq python3 >/dev/null
python3 -m venv "$VENV" 2>/dev/null || { apt-get install -y -qq python3-venv >/dev/null && python3 -m venv "$VENV"; } || { echo "no venv"; exit 1; }
"$VENV/bin/pip" install -q --upgrade pip
"$VENV/bin/pip" install -q -r "$APP_DIR/models/requirements.txt" || { echo "pip install failed"; exit 1; }
mkdir -p "$DATA/hf"
OUT=$(echo '{"mode":"check"}' | HF_HOME="$DATA/hf" timeout 900 "$VENV/bin/python" "$APP_DIR/models/sidecar.py" 2>/tmp/scenario-models.err)
if echo "$OUT" | grep -q '"forecast"'; then
  printf '{"forecast":"amazon/chronos-bolt-small","sentiment":"ProsusAI/finbert","at":"%s"}\n' "$(date -u +%FT%TZ)" > "$DATA/models-ready"
  echo "models ready: $OUT"
else
  rm -f "$DATA/models-ready"
  echo "check failed: $OUT $(tail -3 /tmp/scenario-models.err)"
fi
