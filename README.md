# Jot

Text it once. Find it any time. Send a thought, link or photo from Telegram,
a text message, the iPhone share sheet or the web app; it lands in a private,
searchable feed. Say "remind me ... at 5pm" and Jot reminds you.

Live at https://jot.cashflowus.com (branch `jot`).

## What's in it

- **Capture**: web app composer, a personal capture link (`POST /in/<token>`,
  used by iPhone Shortcuts), a Telegram bot, and SMS/MMS through one shared
  Twilio number (people link their phone by texting `LINK 123456`).
- **Sorting**: `#tags`, link previews (title and picture, with private
  addresses refused), pictures, pinning.
- **Finding**: search by words, tags and dates; chat channels answer
  `find <words>`, `last`, `undo`, `help`.
- **Reminders**: plain English in the person's time zone ("in 20 minutes",
  "tomorrow morning", "on Friday at 3:30pm", "Nov 3"). Sent once by
  notification, Telegram, text and/or email.
- **AI** (owner, administrators and people the owner turns it on for):
  auto-tagging and "Ask your notes", on the owner's Claude plan through
  `claude -p` on the server.
- **Access**: open sign-up, invite-only, or a one-time Stripe purchase that
  creates the account. The owner switches it in Admin.
- **Admin**: usage, people, invitations, admin role, AI access, keys for
  Telegram, Twilio and Stripe (stored server-side only, never shown back).

## Run it

```
node server.js            # http://localhost:3404
node deploy/selftest.js   # offline test: fake Claude, fake Twilio and Stripe
```

No dependencies: Node 22 and the files here. Settings come from `JT_*`
environment variables (see `lib/config.js`); on the server they live in
`/etc/jot.env`, written by `deploy/remote-deploy.sh`.

## Outside services (all optional)

| Service | Where | Webhook |
| --- | --- | --- |
| Telegram | @BotFather, `/newbot`, paste the token in Admin | none (long polling) |
| Twilio | buy a number, paste SID, auth token and number in Admin | `https://jot.cashflowus.com/sms/twilio` (POST) |
| Stripe | paste the secret key and webhook signing secret in Admin | `https://jot.cashflowus.com/stripe/webhook`, event `checkout.session.completed` |

## Deploy

Pushing to `jot` runs `.github/workflows/deploy.yml`: syntax check, self-test,
then SSH to the VPS, `deploy/remote-deploy.sh` (systemd service `jot` on port
3404, Traefik route and certificate from `deploy/k8s/jot.yaml`). The log is
committed back as `deploy/last-run.log`.
