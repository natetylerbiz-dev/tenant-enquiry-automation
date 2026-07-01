# Tenant Enquiry Automation

Portfolio rewrite of a real estate tenant-enquiry n8n workflow as owned code, built
piece by piece to learn Claude Code, Skills, and MCP servers.

## What it does

Inbound tenant email → LLM extracts tenant details → WhatsApp template sent via
Twilio → tenant chats/asks questions or requests a viewing → requested slot checked
against a Google Sheet of availability → on confirmation, agent (me) is notified and
Google Calendar is updated → questions the LLM can't answer confidently escalate to
me directly instead of guessing.

## Build order

- [ ] 1. Project skeleton + CLAUDE.md
- [ ] 2. Google Sheets MCP server — viewing slot lookup
- [ ] 3. Twilio WhatsApp send (template message)
- [ ] 4. LLM extraction from email, built as a Claude Code Skill
- [ ] 5. Email trigger (Gmail push notification or forwarding webhook)
- [ ] 6. Conversation handling + FAQ answering
- [ ] 7. Viewing confirmation → Google Calendar write + agent notification
- [ ] 8. Escalation logic + logging

Work through these in order; don't jump ahead to later pieces before earlier ones
are working.

## Stack

- **Node.js + TypeScript** — chosen over Python for natural fit with webhook-driven
  I/O (Gmail push, Twilio inbound), the more mature MCP TypeScript SDK, and type
  safety across the several external API payload shapes in play (Twilio, Sheets,
  Calendar).
- Package manager, web framework, and other specifics: TBD as they're introduced.

## Conventions

(To be filled in as pieces get built — keep this section honest, not aspirational.)

## Commands

(None yet — add real commands here once package.json exists, e.g. build/test/dev.)
