---
name: extract-tenant-enquiry
description: Extract structured tenant details (name, phone, email, property, message, confidence) from a pasted real-estate enquiry email. Use when the user pastes or references a tenant enquiry email and wants the key details pulled out.
---

# Extract Tenant Enquiry

Given an inbound tenant enquiry email (subject, sender, body), extract:

- `name`: tenant's full name, or `""` if not stated
- `phone`: tenant's phone number, or `""` if not stated
- `email`: tenant's email address, or `""` if not stated
- `property`: the property/listing being enquired about, or `""` if unclear
- `message`: a short (1-2 sentence) summary of what the tenant is asking for
- `confidence`: a number from 0 to 1, how confident the extraction is that name/phone/email/property were correctly identified

Rules:

- Never guess a phone number, email, or property name that isn't actually present in the email; leave the field as `""` instead.
- If the sender's display name/email conflicts with a name mentioned in the body, prefer the body text and lower `confidence` accordingly.
- Output the six fields above as JSON.

This mirrors the schema used by `extractTenantDetails()` in `src/services/extraction.ts`, which the running system calls automatically; this skill is for manually extracting details from an email pasted directly into a Claude Code conversation.
