# Tenant Enquiry Automation

Portfolio rewrite of a real estate tenant-enquiry n8n workflow as owned code, built
piece by piece to learn Claude Code, Skills, and MCP servers.

## What it does

Inbound tenant email → LLM extracts tenant details → WhatsApp message sent via
Twilio → tenant chats/asks questions or requests a viewing → requested slot checked
against a Google Sheet of availability → on confirmation, agent (me) is notified and
Google Calendar is updated → questions the LLM can't answer confidently escalate to
me directly instead of guessing.

## Build order

- [x] 1. Project skeleton + CLAUDE.md
- [x] 2. Google Sheets MCP server — viewing slot lookup
- [x] 3. Twilio WhatsApp send
- [x] 4. LLM extraction from email, built as both a Claude Code Skill (manual/interactive
      use) and `extractTenantDetails()` (the runtime path, called by the Gmail poller)
- [x] 5. Email trigger — polls Gmail every `GMAIL_POLL_INTERVAL_MS` (default 60s) for
      unread `subject:"Listing Enquiry" OR subject:"Contact Request"`, rather than
      push/webhook, since this isn't deployed with a public endpoint
- [x] 6. Conversation handling + FAQ answering — tenant WhatsApp replies are polled
      from Twilio's Messages API (same no-public-endpoint reasoning as piece 5,
      rather than an inbound webhook) and routed by conversation state in SQLite
- [x] 7. Viewing confirmation → Google Calendar write + agent notification
- [x] 8. Escalation logic + logging

All 8 pieces are built. Remaining work is filling in real credentials (Twilio,
Gmail OAuth, Calendar sharing, Anthropic API key) and live end-to-end testing —
see the Commands section below.

## Stack

- **Node.js + TypeScript** — chosen over Python for natural fit with the several
  external API payload shapes in play (Twilio, Gmail, Sheets, Calendar), the more
  mature MCP TypeScript SDK, and type safety across those shapes.
- **Polling, not webhooks**, for both Gmail (piece 5) and Twilio inbound WhatsApp
  (piece 6) — this project has no public endpoint to receive push notifications.
- **`node:sqlite`** (built-in, not a dependency) for conversation state and event
  logging — avoids a native-module build on Windows; ambient types live in
  `src/types/node-sqlite.d.ts` since the installed `@types/node` version predates
  the module's shipped types.
- Package manager: npm.

## Conventions

- Every service module (`src/services/*.ts`) calls `dotenv.config({ quiet: true })`
  at the top — `quiet: true` is required, not just tidy, since dotenv's stdout
  banner would corrupt the MCP stdio JSON-RPC channel when run under the Sheets
  MCP server.
- Business logic that both the MCP server and the runtime need (e.g. Sheets access)
  lives in `src/services/*.ts`; MCP server files under `src/mcp/` are thin wrappers
  that just register tools.
- Escalation and event logging always go through `src/services/escalation.ts` and
  `src/services/logger.ts` rather than ad hoc `sendWhatsAppMessage`/SQL calls, so
  every low-confidence handoff and conversation event is traceable in one place.
- Low-confidence handling: both extraction (piece 4) and FAQ answering (piece 6)
  return a `confidence` score; anything below `CONFIDENCE_THRESHOLD` (in
  `src/config.ts`, default 0.7, env-overridable) escalates instead of guessing.
- WhatsApp message bodies use numbered lines (`1. `, `2. `, ...) for lists, never
  asterisk-prefixed lines — WhatsApp renders leading `*` as bold markup, not a
  bullet.

## Commands

- `npm run build` — type-check and compile to `dist/`
- `npm run dev` — run the runtime (Gmail + Twilio pollers) with `tsx watch`
- `npm start` — run the compiled runtime from `dist/`
- `npm run gmail:authorize` — one-time local OAuth flow to obtain
  `GOOGLE_OAUTH_REFRESH_TOKEN`; requires `GOOGLE_OAUTH_CLIENT_ID` /
  `GOOGLE_OAUTH_CLIENT_SECRET` already set in `.env`

### Manual prerequisites before this runs against real accounts

1. Twilio: real `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_WHATSAPP_NUMBER`
   (the WhatsApp Sandbox is fine to start).
2. Gmail: create an OAuth Client ID (Desktop app type) in Google Cloud Console,
   enable the Gmail API, set `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`,
   then run `npm run gmail:authorize`.
3. Calendar: enable the Calendar API on the same GCP project, share the target
   Google Calendar with the service account's email (from
   `credentials-service-account.json`) granting "Make changes to events", then set
   `GOOGLE_CALENDAR_ID`.
4. `ANTHROPIC_API_KEY` populated (used by extraction and FAQ answering).
5. `data/property-faq.json` currently holds placeholder property data — replace
   with real property details before relying on FAQ answers.
