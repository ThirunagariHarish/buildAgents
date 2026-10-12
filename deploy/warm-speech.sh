#!/usr/bin/env bash
# Downloads and tries the Whisper model once (in the background), so the first
# real recording doesn't wait for a model download.
set -uo pipefail
DATA=/opt/scenario/data
VENV=/opt/scenario-venv
F=$(mktemp /tmp/sc-warm-XXXX.pcm)
head -c 32000 /dev/zero > "$F"
OUT=$(printf '{"mode":"transcribe","path":"%s"}' "$F" | HF_HOME="$DATA/hf" timeout 1200 "$VENV/bin/python" /opt/scenario/models/sidecar.py 2>/tmp/scenario-speech.err)
rm -f "$F"
if echo "$OUT" | grep -q '"model"'; then echo "$OUT" > "$DATA/speech-ready"; echo "speech ready: $OUT"; else echo "speech warmup failed: $(tail -2 /tmp/scenario-speech.err)"; fi
