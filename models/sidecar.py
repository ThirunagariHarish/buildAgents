"""Hugging Face models for Run Scenario, run once per call (load, answer, exit).

stdin:  {"mode": "forecast", "series": [[...closes], ...], "horizon": 30}
        {"mode": "sentiment", "texts": ["...", ...]}
        {"mode": "check"}
stdout: one JSON object.

forecast  -> amazon/chronos-bolt-small: probabilistic forecast (quantiles) of each series.
sentiment -> ProsusAI/finbert: P(positive) - P(negative) for each text.
"""
import json
import os
import sys

os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

FORECAST_MODEL = os.environ.get("SC_FORECAST_MODEL", "amazon/chronos-bolt-small")
SENTIMENT_MODEL = os.environ.get("SC_SENTIMENT_MODEL", "ProsusAI/finbert")
LEVELS = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95]


def forecast(req):
    import torch
    from chronos import BaseChronosPipeline

    torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
    pipe = BaseChronosPipeline.from_pretrained(FORECAST_MODEL, device_map="cpu", torch_dtype=torch.float32)
    horizon = max(1, min(int(req.get("horizon", 30)), 64))
    out = []
    for s in req["series"]:
        ctx = torch.tensor([float(x) for x in s[-1024:]], dtype=torch.float32)
        # Positional first argument: chronos 1.x calls it `context`, 2.x `inputs`.
        q, _ = pipe.predict_quantiles([ctx], prediction_length=horizon, quantile_levels=LEVELS)
        q = q[0]
        q = q.tolist() if hasattr(q, "tolist") else q  # [horizon][levels]
        if q and not isinstance(q[0], list):  # some versions drop the levels axis for a single series
            raise ValueError("unexpected forecast shape")
        out.append({
            "horizon": horizon,
            "levels": LEVELS,
            "final": q[-1],
            "median_path": [row[LEVELS.index(0.5)] for row in q],
            "low_path": [row[LEVELS.index(0.1)] for row in q],
            "high_path": [row[LEVELS.index(0.9)] for row in q],
        })
    return {"model": FORECAST_MODEL, "forecasts": out}


def sentiment(req):
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
    tok = AutoTokenizer.from_pretrained(SENTIMENT_MODEL)
    model = AutoModelForSequenceClassification.from_pretrained(SENTIMENT_MODEL).eval()
    labels = {i: l.lower() for i, l in model.config.id2label.items()}
    texts = [str(t)[:1000] for t in req["texts"]]
    scores = []
    with torch.no_grad():
        for i in range(0, len(texts), 32):
            batch = tok(texts[i:i + 32], padding=True, truncation=True, max_length=128, return_tensors="pt")
            probs = torch.softmax(model(**batch).logits, dim=-1).tolist()
            for p in probs:
                d = {labels[j]: v for j, v in enumerate(p)}
                scores.append(round(d.get("positive", 0) - d.get("negative", 0), 4))
    return {"model": SENTIMENT_MODEL, "scores": scores}


def main():
    req = json.loads(sys.stdin.read() or "{}")
    mode = req.get("mode")
    if mode == "forecast":
        res = forecast(req)
    elif mode == "sentiment":
        res = sentiment(req)
    elif mode == "check":
        res = {"forecast": forecast({"series": [[100 + i * 0.1 for i in range(300)]], "horizon": 5})["model"],
               "sentiment": sentiment({"texts": ["Revenue beat expectations", "The company missed and cut guidance"]})}
    else:
        res = {"error": f"unknown mode {mode}"}
    sys.stdout.write(json.dumps(res))


if __name__ == "__main__":
    main()
