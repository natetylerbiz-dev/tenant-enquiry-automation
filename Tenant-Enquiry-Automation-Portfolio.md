# Tenant Enquiry Automation — Portfolio Case Study

> **Note on the data in this repo:** the lease-terms document
> ([data/tenant-info.md](data/tenant-info.md)) and a company name that was
> hardcoded in one place in the source
> ([src/services/faq.ts](src/services/faq.ts)) originally came from my
> current employer's real lease templates and real business name. Both have
> been replaced with clearly fictional placeholder content (same structure
> and section headings, different agency name and figures) so this repo can
> be shared publicly without exposing my employer's confidential business
> terms — the same treatment already applied to the Properties sheet's
> fabricated placeholder rows. The architecture, the code behavior, the git
> history, and every debugging/judgment example in section 3 below are all
> real and untouched by this substitution.

## 1. What this is and why I built it

This project automates the front end of a real estate tenant enquiry: an
inbound email lead gets contacted on WhatsApp, can ask questions about the
property and lease, and can book a viewing slot — all without an agent
manually managing that back-and-forth. It's a rebuild of a workflow I
originally had running in n8n (a visual workflow-automation tool) as a
prototype.

I rebuilt it as owned code, specified and directed end-to-end using Claude
Code, for a specific reason: I wanted to develop real, hands-on fluency with
Claude Code, Anthropic's Agent Skills, and MCP (Model Context Protocol)
servers — not just read about them. I'm not a software engineer. I didn't
write the TypeScript by hand and can't defend syntax line by line. What I did
do is design the system end to end: I broke the build into 8 sequenced
pieces, specified the behavior and edge cases for each one, ran it against
real Gmail/WhatsApp/Google Calendar accounts, read the actual model outputs
for real test messages, found cases where the behavior was wrong, and
directed the fixes — the way a product owner or technical lead works with an
engineering team, except the "team" here was Claude Code.

The build order and status are tracked in [CLAUDE.md](CLAUDE.md) at the
project root — all 8 planned pieces are built and have been live-tested
end to end over real accounts (not just theoretically wired together).

## 2. Architecture — how it actually works

The flow, as implemented in [src/index.ts](src/index.ts) and the modules it
wires together:

**1. Inbound email → extraction.** A Gmail poller
([src/services/gmailPoller.ts](src/services/gmailPoller.ts)) checks for
unread mail matching `subject:"Listing Enquiry" OR subject:"Contact Request"`
every `GMAIL_POLL_INTERVAL_MS` (default 60 seconds — see
[.env.example](.env.example)). It's a poller, not a webhook, because this
project doesn't run behind a public endpoint — a deliberate, documented
trade-off, not an oversight.

Each unread email is passed to `extractTenantDetails()`
([src/services/extraction.ts](src/services/extraction.ts)), which calls the
Anthropic API (currently `claude-sonnet-5`) with a forced tool call
(`record_tenant_details`) to pull out name, phone, email, the property being
asked about, a short message summary, and a 0–1 confidence score. The
property field is matched against the live list of property names actually
in the Google Sheet (`listKnownProperties()`), not whatever wording the
source email uses — portal-style enquiry emails describe listings in their
own marketing copy, not this project's internal property names, so an exact
match is required and an unmatched property is treated as a failure to
extract rather than a guess.

**2. Confidence gate and phone validation.** If confidence comes back below
`CONFIDENCE_THRESHOLD` (config in
[src/config.ts](src/config.ts), default `0.7`, overridable via env), or the
property didn't match, or the phone number is missing, or the phone number
doesn't pass an E.164 shape check, the enquiry is escalated to me directly
instead of proceeding — see
[src/services/conversation.ts](src/services/conversation.ts) `handleNewEnquiry()`.
Every one of those is a distinct, separately-logged escalation reason
(`low-confidence-extraction`, `unmatched-property-in-extraction`,
`missing-phone-in-extraction`, `invalid-phone-in-extraction`).

**3. WhatsApp send.** Phone numbers extracted from real emails come out in
local format (e.g. `"082 123 4567"`), and Twilio's WhatsApp API requires
E.164 (`+27...`). `normalizePhoneNumber()`
([src/services/phone.ts](src/services/phone.ts)) converts before the number
ever becomes a database key or send target, defaulting to the `+27` South
African country code to match this business's actual market. The tenant is
sent the available viewing slots for their property, pulled live from a
Google Sheet via `getAvailableSlots()`
([src/services/sheets.ts](src/services/sheets.ts)) — either through an
approved Twilio Content Template (`TWILIO_SLOTS_TEMPLATE_SID`) with a
friendly, human-readable slot list, or a plain-text fallback if no template
is configured.

**4. Tenant replies, FAQ answering, and slot booking.** Because there's also
no public endpoint for Twilio to push inbound WhatsApp messages to, replies
are polled from Twilio's Messages API
([src/services/twilioPoller.ts](src/services/twilioPoller.ts), default every
3 seconds — `TWILIO_POLL_INTERVAL_MS`). Conversation state per tenant
(`new` / `awaiting_slot_selection` / `booked` / `escalated`) lives in a local
SQLite database (`node:sqlite`, built into Node — chosen specifically to
avoid a native-module build step on Windows; see
[src/state/db.ts](src/state/db.ts)), and every event is logged to an
`events` table via [src/services/logger.ts](src/services/logger.ts).

Depending on state and message content, a reply routes to:
- **Slot selection** — the tenant can reply with a list number, or with a
  day name ("Saturday works") matched against the actual offered slots
  (`findSlotsMentioned()` in conversation.ts).
- **FAQ answering** — `answerFaqQuestion()`
  ([src/services/faq.ts](src/services/faq.ts)) calls `claude-haiku-4-5`
  with a forced tool call, grounded in two data sources: a static
  cross-property policy document
  ([data/tenant-info.md](data/tenant-info.md) — see the note at the top of
  this document regarding its content) and live per-property facts (rent, deposit,
  bedrooms, pet policy, etc.) read from a "Properties" tab in the same
  Google Sheet via `getPropertyDetails()`. The model returns `onTopic`,
  `answer`, and `confidence` — explained further in section 3.
- **Booking** — a confirmed slot calls `createViewingEvent()`
  ([src/services/calendar.ts](src/services/calendar.ts)) to write a Google
  Calendar event, which is treated as the single source of truth for "is
  this booked." Only if that succeeds does the system mark the Sheet slot
  as `Booked` (`markSlotBooked()`, to prevent a second tenant double-booking
  the same slot) and send tenant/agent confirmation messages — each of
  those three follow-on steps is independently wrapped so one failing
  (e.g. a WhatsApp send failing) can't silently leave the booking
  half-recorded.

**5. MCP server.** [src/mcp/sheets-server.ts](src/mcp/sheets-server.ts) is a
small MCP server exposing `get_available_slots` as a tool, callable from
inside a Claude Code / MCP client session — separate from, but backed by the
same `sheets.ts` module as, the runtime pollers. This piece specifically was
built to get hands-on directing the build of an MCP server, not just
using one someone else built.

**6. Skill.** [.claude/skills/extract-tenant-enquiry/SKILL.md](.claude/skills/extract-tenant-enquiry/SKILL.md)
is an Agent Skill that lets me paste a raw enquiry email into a Claude Code
conversation and get the same structured extraction the live system
performs automatically, for manual/ad hoc use — it explicitly documents that
it mirrors the schema used by the real `extractTenantDetails()` function.

**7. Escalation, always through one path.** Every low-confidence or failure
case — from either extraction or FAQ answering, plus phone validation
failures, undeliverable WhatsApp sends, and unknown senders — routes through
one function, `escalate()`
([src/services/escalation.ts](src/services/escalation.ts)), which logs the
event and messages me on WhatsApp with the tenant's number, the reason code,
and context. This was a deliberate architectural rule (documented in
CLAUDE.md), not something I noticed missing after the fact — the intent was
that every handoff is traceable in one place rather than scattered across ad
hoc `sendWhatsAppMessage()` calls.

## 3. Specific examples of judgment and debugging (from real git history)

These are pulled directly from actual commits, not reconstructed from
memory — the numbers, thresholds, and file names below are as committed.

**a) A prompt fix I validated by testing against the real model, not by
inspection.**
Commit `42aee8b` ("Make FAQ escalation stricter: no self-answered
deflections, no discretionary numbers") describes a concrete failure I
found by actually running real questions through the live Haiku model: a
tenant asking for a non-standard lease length scored **0.85 confidence**,
with the model writing its own "go ask the agent" reply instead of
triggering the real escalation path — meaning the agent was never actually
notified even though the reply sounded appropriately deferential. A second
case, an exact early-cancellation penalty calculation, also scored **0.85**
despite the system prompt already telling the model to escalate exact
penalty calculations. The fix replaced a vague "use your judgment on
confidence" instruction with 5 explicit, enumerated categories that must
always score confidence low (0.3 or under), including an explicit rule that
the model must not write its own "contact the agent" deflection — it must
drop confidence and let the real `escalate()` function run. After the
change, I re-ran the same test cases: the lease-length question, an
uncovered question, and the penalty calculation all scored **0.2–0.4** and
correctly escalated, while plain factual lookups (deposit amount, parking,
bedroom count) stayed confident and unaffected. This is the kind of bug you
can only catch by actually running the model against real inputs and
reading what it does — not by reading the prompt and assuming it will
behave as written.

**b) A closely related guardrail, also live-tested with a real adversarial
set.**
Commit `c4e0078` ("Add on-topic guardrail so FAQ answering can't be used as
a general chatbot") addressed a gap I identified: nothing stopped a tenant
from using the WhatsApp number to get the model to answer trivia, write
content, or do arbitrary tasks, because confidence alone doesn't catch that
— a model can answer "what's the capital of France?" with full confidence.
I had the FAQ tool schema gain a required `onTopic` boolean, and the code
path (`handleFaqQuestion` in conversation.ts) checks it before confidence:
if false, the tenant gets a fixed, code-owned redirect message rather than
anything the model itself generated, since the model's output isn't trusted
once the tenant's own message is what's steering it. I specified a concrete
test: 7 off-topic prompts (a poem request, a trivia question, a coding
request, jokes, a direct prompt-injection attempt, a math problem, and a
translation request) plus 3 legitimate property questions, run against the
real Haiku model. All 7 off-topic prompts were correctly flagged
`onTopic=false`; all 3 legitimate questions were still answered normally
with high confidence.

**c) A real production-shaped bug root-caused from a live incident, not
hypothesized in advance.**
Commit `b817301` documents a genuine data-loss bug found through live
testing: the Twilio poller originally used an advancing "watermark"
(only fetch messages sent after the last successful poll) to avoid
reprocessing the same message twice. But Twilio's Messages List API has
indexing lag — a message isn't necessarily queryable via `dateSentAfter`
the instant it's sent. With an advancing watermark, once the watermark
passed a message's timestamp, that message was permanently excluded from
every future poll even though it existed the whole time. That
characterization — "a real, observed message loss, not a hypothetical" —
is a direct quote, but it's from the code comment in
[src/services/twilioPoller.ts](src/services/twilioPoller.ts) explaining the
fix, not from the `b817301` commit message itself; the commit message
describes the same root cause but in different words ("Twilio's Messages
List API has enough indexing lag that an advancing watermark can
permanently skip a message sent just before it passes"). The fix (visible
today in twilioPoller.ts) replaced the advancing watermark with a fixed
30-second rolling lookback window (`LOOKBACK_MS`) plus a `seenSids` set
(capped at `MAX_SEEN_SIDS = 1000`) to dedupe messages that show up in more
than one overlapping window — a fixed window can't have the same
permanent-skip failure mode, since every message stays inside the query
range for the full lookback period regardless of indexing delay.

**d) A bug fix that existed on disk before it existed on the branch the
app was actually running — a lesson about the worktree workflow itself.**
Commit `4f34bc1` ("Match offered viewing slots by weekday, not just list
number," committed 2026-07-02 23:41:10) fixed a real behavioral gap: a
tenant replying with a day name ("I'd like to view on Saturday") instead
of the offered list number fell straight through to generic FAQ
answering, which had no idea what slots had been offered, producing an
unhelpful "send me your preferred time" reply even when that exact day's
slot was already on the list sent minutes earlier. The fix added a
weekday-matching check (`findSlotsMentioned()`, now in
[src/services/conversation.ts](src/services/conversation.ts)) ahead of the
FAQ fallback.

What makes this one worth calling out separately is where the fix
actually lived for a while. This project's Claude Code sessions used a git
worktree — a second working copy of the repo, checked out at
`.claude/worktrees/composed-honking-brook` on its own branch
(`worktree-composed-honking-brook`), with changes periodically fast-forward
merged back into `master`. Per the repo's own reflog, `4f34bc1` was
committed to that worktree branch at 23:41:10, but `master` — the branch
actually checked out in the main project directory, i.e. the one any
locally running `npm run dev`/`npm start` process would be using — stayed
on the prior commit (`55274cc`, from 21:01:16 the day before) until the
next fast-forward merge landed at 00:08:45, roughly 87 minutes later. For
that window, the fix existed as a real commit in the repository, but not
on the branch the running app was actually built from. The lesson: in a
worktree-based Claude Code workflow, "there's a commit for this" isn't the
same question as "is this live in the copy I'm actually testing" — I
learned to check which branch is checked out where before trusting that a
just-committed fix is the one currently running. (This is reconstructed
from git's reflog and branch history, not from a saved memory of the
incident — the reflog output is the source of truth here, not my
recollection of testing it live. Note for anyone checking this
independently: reflogs are local-only and were also expired as part of a
later history scrub done before this repo was made public, so that
specific reflog output no longer exists in this repo to re-check — the
commit timestamps and branch topology that support this account do still
hold up and are independently verifiable.)

**e) A proactive design decision, explicitly not a bug fix — and distinct
from item (d) above despite touching the same code.**
Commit `529ccc8` ("Include day and month in every tenant/agent-facing slot
message," committed 2026-07-03 00:25:39, ~44 minutes after `4f34bc1`) is a
different event from item (d), and it's worth being precise about the
difference: `4f34bc1` fixed an actual failure (a tenant's "Saturday" reply
not being recognized as matching anything, falling through to a useless
FAQ answer). This commit did not fix a failure — it anticipated one. Its
own commit message states the reasoning directly: `formatSlotForTemplate`
rendered a slot as only `"Saturday at 2:30pm"`, with no day-of-month or
month, so "two slots on the same weekday in different weeks (e.g. two
Saturdays two weeks apart) were indistinguishable in the offer message
itself, and a tenant asking for 'Saturday' couldn't be disambiguated on
wording alone either." The fix changes the format to
`"Saturday, 4 July at 2:30pm"` everywhere a slot appears — the slot offer,
the multi-match disambiguation list from item (d)'s `findSlotsMentioned()`,
the tenant's booking confirmation, and the agent's booking notification.

Critically, the commit message is explicit that this was verified by
simulation, not by observing a real collision: "Verified against the real
Sheet's date format (M/D/YYYY, e.g. '7/4/2026') and a simulated
two-Saturdays-two-weeks-apart case — both render distinctly and
correctly." The live viewing-slots Sheet didn't (and as of this writing
still doesn't) have two same-weekday slots in different weeks at once —
this was spec'd and fixed ahead of that scenario ever occurring in real
data, not in response to it. I'm calling this out specifically because
items (d) and (e) are easy to conflate — same file, same "Saturday"
example, 44 minutes apart — and I want to be able to state clearly in an
interview which one was a live bug and which one was foresight.

**f) A concrete, documented trade-off: polling instead of webhooks.**
This isn't a bug fix but a deliberate architecture decision, stated plainly
in CLAUDE.md rather than left implicit: both Gmail (piece 5) and inbound
Twilio WhatsApp (piece 6) use polling, not webhooks/push notifications,
specifically because this project isn't deployed behind a public endpoint.
That's a real constraint of running this locally as a portfolio/learning
project rather than a hosted service, and it's the reason both pollers
needed the reliability hardening in (c) and elsewhere — a webhook-based
design wouldn't have had a "watermark vs. lookback window" problem at all
in the same way. I also specified (and it's implemented) a heartbeat log on
both pollers, precisely because — as the commit for `b817301` states — a
genuinely stuck polling loop and a quiet period with no new messages look
identical in the logs without one.

**g) A model-routing cost/latency decision, not a default.**
Commit `4441311` switched tenant-enquiry extraction from Opus to Sonnet, and
`b817301` switched FAQ answering to Haiku. These aren't arbitrary — the
reasoning documented in the commits and preserved in code comments
(`faq.ts`) is that FAQ answering is a short, narrowly-scoped, grounded
lookup against a forced tool schema, not open-ended reasoning, making it a
good fit for the fastest/lightest model given the tenant-facing latency
budget, whereas extraction is a heavier, more free-form parsing task that
still benefits from a stronger model than Haiku but doesn't need Opus. This
reflects a real judgment call about matching model capability to task
difficulty and latency requirements — something I specified based on
understanding what each step actually requires, not a default I left
untouched.

## 4. Current status: what's real, what's a demo limitation

**What's genuinely tested, live, end to end:** Per CLAUDE.md, all 8 pieces
have been live-tested over real Gmail, WhatsApp (via Twilio), and Google
Calendar accounts — the full loop of enquiry → slot offer → FAQ question →
booking → agent notification has actually run, not just been wired together
and assumed to work. The debugging examples above (sections 3a and 3b) were
found and verified by running real messages through the real, deployed
model calls — not by reading code.

**What's explicitly a Sandbox/demo limitation, not production:**
- **Twilio WhatsApp Sandbox, not a live WhatsApp Business number.** The
  Sandbox lets Content Templates be used without Meta/WhatsApp's business
  template approval process; a real number requires that approval for
  business-initiated messages sent outside a 24-hour session window. Moving
  to a real number means re-submitting the existing template
  (`scripts/create-slots-template.ts`) through that approval process.
- **Sandbox-specific webhook workaround.** `scripts/create-noop-webhook.ts`
  creates a Twilio Studio Flow that silently absorbs inbound Sandbox
  messages so Twilio's built-in "You said: ..." auto-reply doesn't
  interfere with testing. This is Sandbox-only cruft — it wouldn't exist or
  matter on a real number.
- **Test-only env toggles exist and are documented as such.**
  `TEST_TENANT_PHONE_OVERRIDE`, `TEST_SKIP_AGENT_BOOKING_NOTIFICATION`, and
  `TEST_REDIRECT_ESCALATION_TO_TENANT` (see `.env.example` and commits
  `c0b67e9`, `ba46abb`) exist specifically because testing solo means one
  WhatsApp number has to play both "tenant" and "agent," which would
  otherwise make agent notifications and escalations indistinguishable from
  tenant-facing messages in the same thread. These are explicit, named,
  off-by-default flags — not silent behavior changes — precisely so they
  can't be mistaken for real production logic.
- **Properties sheet data is fabricated placeholder data.** The "Properties"
  tab that FAQ answering reads per-property facts from currently has 5 rows
  of made-up figures, each labeled "FABRICATED PLACEHOLDER DATA" in the
  Notes column. Real rent, deposit, bedroom counts, etc. need to replace
  this before any real tenant sees these answers.
- **`data/tenant-info.md` is now fictional placeholder content.** It was
  originally a genuine summary of my employer's real two lease templates
  (Tenant Placement Only / Managed); it's been replaced with fictional
  terms in the same structure for this public repo (see the note at the
  top of this document). The smoking-policy gap noted in the original was
  a real, unresolved gap in the source lease at the time — that specific
  detail doesn't carry over to the fictional replacement, which keeps the
  same placeholder note for structural consistency only.
- **No process supervision.** Running `npm start` or `npm run dev` doesn't
  restart the process if it crashes. That's explicitly left to whoever
  hosts this (pm2, systemd, Windows Task Scheduler, etc.) rather than baked
  into the app — a reasonable scope boundary for a portfolio build, but a
  real gap for actual production use.

**What would need to change to go to production**, in priority order: real
Properties sheet data → real WhatsApp Business number + template approval →
process supervision/restart-on-crash → removal (or hard environment-gating)
of the `TEST_*` overrides.

## 5. What this demonstrates about how I work with Claude Code

I didn't hand this project a one-line prompt and accept whatever came back.
I broke the build into 8 sequenced pieces (tracked and checked off in
CLAUDE.md), specified concrete behavior and edge cases for each one, and —
critically — didn't trust "it should work" as a stopping point. The FAQ
escalation and on-topic guardrail fixes in section 3 only exist because I
ran real, sometimes adversarial, test inputs against the actual deployed
model and read what came back, found where the stated behavior and the
real behavior diverged, and specified a fix, then re-tested to confirm it.
The Twilio watermark bug was root-caused from an actual observed message
loss, not theorized in advance.

That's the role I can speak to in an interview: defining what a system
needs to do, including its failure and edge cases; directing an
implementation session by session; verifying real behavior against real
accounts and real model calls rather than trusting that code looks right;
and making documented, defensible trade-off calls (polling vs. webhooks,
which model for which task, what's still fabricated placeholder data versus
production-ready) rather than leaving them implicit. I can't debug the
TypeScript syntax myself, and I'm not claiming otherwise — what I can do is
tell you exactly what this system is supposed to do, why, where it's been
verified, and where it still has known gaps.
