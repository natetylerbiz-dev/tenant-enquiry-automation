# Tenant Enquiry Automation

Real estate tenant-enquiry automation system, rewritten as owned code from an
existing n8n workflow — specified, directed, and live-tested end to end using
Claude Code.

**→ [Read the full case study](Tenant-Enquiry-Automation-Portfolio.md)** for
architecture, real debugging examples pulled from git history, and design
trade-offs.

## What I owned

This is an AI-assisted implementation, built through Claude Code — Claude
wrote the TypeScript. I owned the business requirements, sequenced the build
into 8 specified pieces (tracked in [CLAUDE.md](CLAUDE.md)), wrote the
behavioral specs and edge cases for each one, and verified every piece
against real Gmail/WhatsApp/Calendar accounts rather than trusting that the
code looked right. I can explain how the system works, why the major
decisions were made, where it's been verified, and what's still required for
production.

## Debugging highlights

Three real bugs, found and fixed through live testing — commit hashes are
real, check them:

- **Confidence-gate escalation** (`42aee8b`) — Two borderline FAQ answers (a
  non-standard lease-length question, an exact penalty calculation) scored
  0.85 confidence and self-answered instead of escalating. Replaced vague
  "use your judgment" guidance with explicit escalation categories; re-tested
  until both correctly escalated at 0.2–0.4.
- **On-topic guardrail** (`c4e0078`) — Nothing stopped the WhatsApp number
  being used as a general chatbot. Added a required `onTopic` check ahead of
  confidence scoring, tested against 7 adversarial/off-topic prompts plus 3
  legitimate questions — all classified correctly.
- **Twilio message-loss bug** (`b817301`) — An advancing "watermark" for
  polling inbound messages permanently skipped messages caught in Twilio's
  API indexing lag. Replaced with a fixed 30s rolling lookback window plus a
  deduped `seenSids` set.

Two more examples — a worktree/branch-lag lesson and a proactive design
decision — are in the [case study](Tenant-Enquiry-Automation-Portfolio.md).

## What it does

Inbound tenant email → LLM extracts tenant details → WhatsApp message sent via
Twilio → tenant chats/asks questions or requests a viewing → requested slot
checked against a Google Sheet of availability → on confirmation, the agent is
notified and Google Calendar is updated → questions the LLM can't answer
confidently escalate to the agent directly instead of guessing.

## Stack

Node.js + TypeScript, Anthropic API (Claude), Twilio WhatsApp, Google Sheets /
Calendar / Gmail APIs, `node:sqlite` for local conversation state, and a small
MCP server exposing viewing-slot lookup as a tool.

## Status

All 8 planned build pieces are complete and have been live-tested end to end
over real Gmail, WhatsApp, and Google Calendar accounts. See
[CLAUDE.md](CLAUDE.md) for the build order, architectural conventions, and
what's still genuinely outstanding (placeholder property data, Sandbox vs.
production WhatsApp, etc.).
