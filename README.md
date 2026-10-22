# Reinvent

Every half hour, one everyday product and three ways to reinvent it.

- **The Scout** picks a real product, reads reviews, forums, patents and past
  redesigns, and writes a sourced dossier with a photo.
- **Three inventors** work one after another, each with a different method,
  and each checks the web for existing products and patents before committing:
  - Mara, the Engineer: TRIZ and first principles.
  - Kenji, the Human-Centered Designer: the real use journey.
  - Ines, the Systems Futurist: lifecycle, ecosystem, biomimicry.
  Each one draws a concept sketch.
- **Make it**: for any design, the sourcing analyst researches the bill of
  materials, unit cost at 1k and 10k, tooling, landed cost, price and margins,
  where in China it is made, suppliers and certifications.
- **Talk to the studio** about a product; a suggestion becomes a new round
  where the inventors redesign it with your feedback.

The feed scrolls like Instagram: the original, then a slide per reinvention.
Save the ones you like. Add it to your home screen to use it like an app.

Runs on the server's Claude Code login (`claude -p`), one job at a time, with
no SDKs and no dependencies. Only the owner and people they allow can use
Claude features; everyone signed in can scroll and save.

## Run locally

```
RV_DATA_DIR=./data RV_PORT=3403 node server.js
node deploy/selftest.js     # end-to-end with a stand-in for claude
```

## Deploy

Pushing the `reinvent` branch runs `.github/workflows/deploy.yml`, which syncs
`/opt/reinvent` on the VPS and runs `deploy/remote-deploy.sh` (systemd service
`reinvent` on port 3403, route `deploy/k8s/reinvent.yaml`). The output is
committed back as `deploy/last-run.log`.
