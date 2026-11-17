#!/usr/bin/env bash
# Runs the flow research on the runner. The vendor token and the data stay on the runner and in the app database; the log gets aggregates only.
set -uo pipefail
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"
export UW_TOKEN=$($KC -n selfagentbot get secret selfagentbot-credentials -o jsonpath='{.data.UNUSUAL_WHALES_API_TOKEN}' | base64 -d | tr -d '\r\n ')
python3 -m venv /tmp/rv >/dev/null 2>&1 && . /tmp/rv/bin/activate
pip -q install numpy scikit-learn optuna 2>&1 | tail -2
python3 -c "import numpy, sklearn, optuna; print('numpy', numpy.__version__, 'sklearn', sklearn.__version__, 'optuna', optuna.__version__)" 2>&1 | tail -1
python3 flow_research.py 2>&1 | grep -v -i "bearer" | cut -c1-900
