# RCS through SimplyRCS, with SMS fallback on Signalmash

This repository is the GHL 10DLC app plus RCS. Two providers run side by side:

| Provider | Carries | Used for |
|---|---|---|
| SimplyRCS (`simplyrcs.signalmash.com`) | RCS only | Branded messages to phones that support RCS |
| Signalmash (`api.signalmash.com`) | SMS and MMS | Everything else, and every fallback, exactly as in the 10DLC app |

## How a message is routed

1. The organization must have an **RCS agent** that is `live` (`rcs_agents` table). Without one, every message is SMS. Exception: while the agent is still in testing, phones that **accepted a test-device invite** get RCS (no capability check, since the provider refuses checks until a sender is live). That is how RCS is verified before launch.
2. The recipient's phone is checked once (`GET /v1/contacts/{id}/rcs-check`) and the answer is cached for 7 days (`rcs_capabilities`). A failed check never blocks the message; it goes as SMS.
3. RCS-capable phone: `POST /v1/messages/send` with `protocolType: RCS_RICH` and an `Idempotency-Key` of `msg:<message id>`.
4. If SimplyRCS **definitively rejects** the message (HTTP 4xx), it is sent as SMS in the same call and the reason is stored in `messages.fallback_reason`. An **uncertain** outcome (network error, HTTP 502) is rethrown and the queue retries with the same idempotency key, so nothing is ever sent twice.
5. `messages.delivery_channel` records what actually carried the message; `type` is `rcs`, `sms` or `mms`.

The decision and the send are pure functions in `packages/server/src/services/rcs-routing.service.ts` (tests in `test/rcs-routing.test.ts`). `MessageService.send` and `dispatchQueuedMessage` call them.

## The agent lifecycle

`draft → submitted → ready_for_testing → in_testing → pending_launch → live` (`rejected` and `suspended` are terminal until edited or restored). The merchant fills the profile on the **RCS Agent** page; `submit` creates the sender on SimplyRCS (`POST /v1/channels/{channelId}/rcs/senders`) and submits its sender id (`POST /v1/sender-ids/{id}/submit`). Review is done by SimplyRCS staff and Google/Infobip, not by an API call. `refresh` reads the provider status; `launch` promotes a tested agent. Test devices are invited with `POST .../test-devices`.

### Using an agent that already exists on the account

The dev account already has agents. **RCS Agent → Already have an agent? → Use this agent** (`POST /rcs/agent/link`, choices from `GET /rcs/agent/available`) adopts one: its profile, sender id and test devices are pulled from SimplyRCS and nothing is created on the provider. Statuses map as `READY_FOR_TESTING → ready_for_testing`, `LAUNCHED_PARTIAL_SUCCESS → pending_launch`, `LIVE/LAUNCHED → live`.

## Inbound and status webhooks

`POST /api/webhooks/simplyrcs` verifies `X-Signature` (lowercase hex HMAC-SHA256 over the raw body, keyed with the endpoint secret). Events handled: `message.received`, `button.clicked` (becomes an inbound message carrying the button text), `message.status`, `message.delivered`, `message.read`, `message.failed`. They go through the existing incoming-events queue into the CRM inbox, so STOP/START/HELP and dead-letter handling are unchanged.

Register the endpoint from the admin portal (**Runtime Settings → Register webhook**). SimplyRCS returns the signing secret once; the portal stores it in `simplyrcs_webhook_secret`.

## Configuration

Runtime settings (admin portal) override the environment:

| Setting | Env | Purpose |
|---|---|---|
| `simplyrcs_api_url` | `SIMPLYRCS_API_URL` | Defaults to `https://simplyrcs.signalmash.com` (production). The key issued in October 2026 only works on the development environment `https://simplyrcs.dev.codeflexlabs.net`; set that URL with it. |
| `simplyrcs_api_key` | `SIMPLYRCS_API_KEY` | Workspace API key (Developer Portal → API Keys), sent as `Authorization: Bearer` |
| `simplyrcs_webhook_secret` | `SIMPLYRCS_WEBHOOK_SECRET` | Set by "Register webhook" |

Billing: RCS is one billable unit per message, priced with `rcsRate` in `wallet-billing.service.ts`. **It is set equal to the SMS rate until pricing is decided.**

## Local development without a SimplyRCS account

`packages/server/scripts/mock-simplyrcs.mjs` is a sandbox that mirrors the endpoints the app uses and plays the provider: agents go live after a delay (`MOCK_RCS_APPROVAL_SECONDS`, or `POST /sandbox/approve-agent`), phones whose last digit is **even** are RCS-capable, receipts arrive as signed webhooks, and `POST /sandbox/reply` / `POST /sandbox/tap` simulate the customer.

```
# .env
SIMPLYRCS_API_URL=http://127.0.0.1:4020
SIMPLYRCS_API_KEY=mock
SIMPLYRCS_WEBHOOK_SECRET=mock-secret

SIMPLYRCS_API_KEY=mock MOCK_RCS_WEBHOOK_URL=http://127.0.0.1:3001/api/webhooks/simplyrcs \
MOCK_RCS_WEBHOOK_SECRET=mock-secret node scripts/mock-simplyrcs.mjs
```

## Schema

Migration `20261007120000_rcs_agents_and_routing` (idempotent, like the others): enum values `simplyrcs`, `rcs`, `read`; new enums `DeliveryChannel`, `RcsAgentStatus`; new columns on `messages` (`rcs_message_id`, `rcs_conversation_id`, `delivery_channel`, `fallback_reason`, `rcs_content`, `read_at`); new tables `rcs_agents`, `rcs_capabilities`. Locally, `prisma db push` is the documented procedure; the migration is for `prisma migrate deploy` in production.

## Still needed to go live

- A **production** SimplyRCS key (the current key is for the development environment, which has an active RCS channel and agents in testing).
- An agent launched (`live`) by SimplyRCS/Google. Until then only approved test devices receive RCS; add Ayush's phone as a test device on the linked agent to verify delivery.
- A public URL for `POST /api/webhooks/simplyrcs`, registered from the admin portal (receipts and replies do not arrive without it).
- RCS pricing, and whether RCS Multimedia (carousels, bots) is a separate tier.
- New GHL marketplace registrations for this app (dev and public).
