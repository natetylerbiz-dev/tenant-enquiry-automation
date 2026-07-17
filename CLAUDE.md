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
- [x] 2. Google Sheets MCP server: viewing slot lookup
- [x] 3. Twilio WhatsApp send
- [x] 4. LLM extraction from email, built as both a Claude Code Skill (manual/interactive
      use) and `extractTenantDetails()` (the runtime path, called by the Gmail poller)
- [x] 5. Email trigger: polls Gmail every `GMAIL_POLL_INTERVAL_MS` (default 60s) for
      unread `subject:"Listing Enquiry" OR subject:"Contact Request"`, rather than
      push/webhook, since this isn't deployed with a public endpoint
- [x] 6. Conversation handling + FAQ answering: tenant WhatsApp replies are polled
      from Twilio's Messages API (same no-public-endpoint reasoning as piece 5,
      rather than an inbound webhook) and routed by conversation state in SQLite
- [x] 7. Viewing confirmation → Google Calendar write + agent notification
- [x] 8. Escalation logic + logging

All 8 pieces are built, credentialed, and have been live-tested end to end over
real WhatsApp/Gmail/Calendar (enquiry → slot offer → FAQ → booking → agent
notification). Remaining gaps are content, not code; see Setup status below.

## Stack

- **Node.js + TypeScript**: chosen over Python for natural fit with the several
  external API payload shapes in play (Twilio, Gmail, Sheets, Calendar), the more
  mature MCP TypeScript SDK, and type safety across those shapes.
- **Polling, not webhooks**, for both Gmail (piece 5) and Twilio inbound WhatsApp
  (piece 6): this project has no public endpoint to receive push notifications.
- **`node:sqlite`** (built-in, not a dependency) for conversation state and event
  logging: avoids a native-module build on Windows; ambient types live in
  `src/types/node-sqlite.d.ts` since the installed `@types/node` version predates
  the module's shipped types.
- Package manager: npm.

## Conventions

- Every service module (`src/services/*.ts`) calls `dotenv.config({ quiet: true })`
  at the top: `quiet: true` is required, not just tidy, since dotenv's stdout
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
  asterisk-prefixed lines; WhatsApp renders leading `*` as bold markup, not a
  bullet.
- All external API calls (Anthropic, Twilio, Google) that feed the poll loops go
  through `withTimeout()` (`src/services/timeout.ts`, 60s) at the message-handler
  level, plus a tight 30s client-level timeout on the Anthropic SDK specifically,
  since the SDK default is 10 minutes, which would silently block the poller forever
  on a hung request with no error and no reply ever sent. `withTimeout` attaches
  a no-op `.catch()` to the raced-away promise so a late rejection can't surface
  as an unhandled rejection (Node can otherwise treat that as fatal).
- `src/index.ts` has top-level `unhandledRejection`/`uncaughtException` handlers
  as a last-resort safety net; both pollers already catch and log per-message,
  so anything reaching these slipped past every other guard.
- Real enquiry emails describe properties in their own marketing wording (web
  refs, full listing titles), not this project's internal property names.
  `extractTenantDetails()` is given the live list of known property names
  (`listKnownProperties()` in `sheets.ts`) and told to match exactly or leave the
  field empty. An empty match escalates rather than creating a tenant record
  keyed on a property name that won't match the Sheet.
- Phone numbers from extracted emails aren't E.164 (e.g. `"081 234 5678"`) and
  Twilio WhatsApp requires E.164. `normalizePhoneNumber()` (`src/services/phone.ts`)
  converts before the number becomes the tenant's DB key/send target, defaulting
  to the `+27` South African country code, matching this business's context.
- `sheets.ts` keeps two separate Google auth scopes: read-only for the pollers'
  normal reads (least privilege), and a write-scoped client used only by
  `markSlotBooked()`, called after a successful calendar booking to prevent two
  tenants double-booking the same slot.
- `bookViewing()` treats the Calendar write as the source of truth for "is this
  booked": if it throws, nothing else happens. Everything after that
  (Sheet write-back, tenant/agent notifications) is best-effort and independently
  wrapped, so a WhatsApp send failure can't leave a real booking with no DB
  record or no agent notification; a tenant-notification failure specifically
  triggers an escalation.
- The FAQ system prompt treats the tenant's message as untrusted input: grounded
  to answer only from the provided property/tenant-info data, explicitly told not
  to follow instructions embedded in the tenant's message (fake "system" messages,
  claimed authorization for discounts, etc.).
- One-time setup scripts under `scripts/` (Twilio Content Template, Sandbox no-op
  webhook, Properties sheet tab) check for an existing resource by name before
  creating, so accidentally re-running one doesn't create a duplicate. Twilio's
  Content API and Studio Flow API wire formats are snake_case (`friendly_name`,
  `"twilio/text"`) despite the Node SDK's camelCase TypeScript types, so those
  fields need `as any` to bypass the (incorrect) types; verified against Twilio's
  actual API docs, not guessed.

## Commands

- `npm run build`: type-check and compile to `dist/`
- `npm run dev`: run the runtime (Gmail + Twilio pollers) with `tsx watch`
- `npm start`: run the compiled runtime from `dist/`
- `npm run gmail:authorize`: one-time local OAuth flow to obtain
  `GOOGLE_OAUTH_REFRESH_TOKEN`; requires `GOOGLE_OAUTH_CLIENT_ID` /
  `GOOGLE_OAUTH_CLIENT_SECRET` already set in `.env`
- `npm run sheet:setup-properties` (one-time): adds a "Properties" tab to the
  viewing-slots spreadsheet (header row + one placeholder example row) for agents
  to fill in per-property details. Requires the service account to have **Editor**
  (not just Viewer) access to the spreadsheet; no-ops if the tab already exists.
- `npx tsx scripts/create-slots-template.ts` (one-time): creates the Twilio
  Content Template used for the viewing-slots offer message; prints the SID to
  put in `TWILIO_SLOTS_TEMPLATE_SID`. Checks for an existing template by name
  first (see Conventions).
- `npx tsx scripts/create-noop-webhook.ts` (one-time, Sandbox-only): creates a
  Twilio Studio Flow that silently absorbs inbound messages, so the Sandbox's
  built-in "You said: ..." auto-reply doesn't fire. Prints a webhook URL that
  still has to be pasted manually into Console → Messaging → Try it out → Send a
  WhatsApp message → Sandbox Settings → "When a message comes in". That field
  isn't configurable via any Twilio API, confirmed by its absence from the SDK
  entirely, not just undocumented.

### FAQ knowledge base

FAQ answering (`src/services/faq.ts`) combines two sources:

- `data/tenant-info.md`: cross-property policy info, extracted/summarized from the
  agency's two lease templates (OF = Tenant Placement Only, RM = Managed). Loaded
  in full and cached (`cache_control`) since it's identical on every call.
- The **"Properties" tab** of the viewing-slots Google Sheet: per-property
  structured facts (area, bedrooms, bathrooms, pet-friendly, parking, rent,
  deposit, admin fee, lease type OF/RM, description, notes), fetched live via
  `getPropertyDetails()` in `src/services/sheets.ts`. This replaced an earlier
  `data/property-faq.json` file, now deleted. The Sheet is the single source of
  truth for per-property facts so agents can self-serve edits without touching
  code. The "Property" column must match the Slots tab's property names exactly.
- Lease type (OF/RM) determines who a tenant should contact/pay; the FAQ prompt
  is instructed not to guess this if it's missing for a property.

### Setup status

All of Twilio, Gmail OAuth, Calendar, and the Anthropic API key are credentialed
and working in the current `.env`. This section is what's still genuinely
outstanding, not a from-scratch checklist:

1. **Properties sheet has 5 rows, all fabricated placeholder data**
   (clearly labeled "FABRICATED PLACEHOLDER DATA" in the Notes column). Real
   figures (rent, deposit, bedrooms, etc.) need to replace these before this is
   used with real prospective tenants.
2. **`data/tenant-info.md` still has a couple of `[bracketed]` gaps** (smoking
   policy isn't addressed in the source lease template) to confirm and fill in.
3. **The WhatsApp Sandbox is a testing environment, not production.** Moving to
   a real WhatsApp Business number means: re-running `create-slots-template.ts`'s
   underlying template through Twilio's WhatsApp template approval (Sandbox
   doesn't require Meta/WhatsApp approval to use Content Templates; a real
   number does for business-initiated messages outside a 24h session window),
   and the Sandbox-specific no-op webhook setup no longer applies.
4. **No process supervision.** `npm start`/`npm run dev` isn't restarted
   automatically if it crashes. That's a deployment decision (pm2, systemd,
   Windows Task Scheduler, etc.) left to whoever hosts this, not baked in.
