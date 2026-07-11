# Tenant Enquiry Automation

Real estate tenant-enquiry automation system, rewritten as owned code from an
existing n8n workflow — specified, directed, and live-tested end to end using
Claude Code.

**→ [Read the full case study](Tenant-Enquiry-Automation-Portfolio.md)** for
architecture, real debugging examples pulled from git history, and design
trade-offs.

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
