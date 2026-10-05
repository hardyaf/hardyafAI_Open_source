---
name: gog
description: Google Workspace CLI with the household auth and calendar profile. Read before use. Generic, family, household, and for-person requests default to House; only an explicitly named personal calendar changes the destination.
homepage: https://gogcli.sh
metadata: {"clawdbot":{"requires":{"bins":["gog"]},"install":[{"id":"brew","kind":"brew","formula":"steipete/tap/gogcli","bins":["gog"],"label":"Install gog (brew)"}]}}
---

# gog

Use `gog` for Gmail, Calendar, Drive, Contacts, Sheets, and Docs. The OAuth
setup already exists. Do not start a new authorization flow unless the safe
auth-status check below proves that the required account/client is absent.

## Household profile (mandatory)

Before interpreting event details, run this routing latch and keep its result
for the whole turn:

1. Search only for the exact destination phrases `Owner's calendar`, `Owner
   calendar`, `Adult's calendar`, or `Adult calendar`.
2. If one is present, select that named calendar.
3. If none is present, set `person-002@example.invalid` (House).
4. Do not revise the latched value because of names in `for ...`, attendees,
   title, description, source document, or surrounding conversation.

The request `Put the meeting on the family calendar for Owner` must latch
`person-002@example.invalid`. Selecting Owner would be a routing error.

- Authenticated account: `hardy.aibot@gmail.com`
- OAuth client: `house`
- Household timezone: `America/New_York`
- Calendar destinations:
  - House: `hardy.aibot@gmail.com`
  - Owner: `person-003@example.invalid`
  - Adult: `person-004@example.invalid`

For every authenticated command, pass both
`--account hardy.aibot@gmail.com --client house`. The `--account` value is the
authenticated Google identity; it is not a calendar alias. For Calendar
commands, the positional `<calendarId>` selects the destination.

Apply this resolver literally; do not infer calendar ownership from context:

- `Owner's calendar` or `Owner calendar` -> Owner.
- `Adult's calendar` or `Adult calendar` -> Adult.
- `House calendar`, `family calendar`, `household calendar`, `our
  calendar`, `the calendar`, or no destination name -> House.
- A person's name anywhere else is event content, not routing. In particular,
  `for Owner`, `for Adult`, attendee addresses, the event subject, and the
  beneficiary never select that person's calendar.
- If a generic House phrase and a non-destination person mention both occur,
  the generic House phrase controls. Example: `family calendar for Owner` ->
  House.

Do not ask a calendar-selection question solely because the user used a generic
household phrase.

With `--timezone America/New_York`, pass local wall times in
`YYYY-MM-DDTHH:MM:SS` form with no `Z` and no numeric offset suffix. Do not
guess or write an offset: daylight-saving rules depend on the event date.

## Authentication safety

Use `gog auth list` to inspect auth status. If it reports account
`hardy.aibot@gmail.com` with client `house`, use that existing authorization;
do not ask the user for a client-secret file or start OAuth again.

Never open, read, decode, print, copy, `cat`, hex-dump, or otherwise inspect
files under gog credential, token, or keyring directories. Never expose access
tokens, refresh tokens, authorization codes, client secrets, or encrypted
keyring contents in tool output or conversation. If `gog auth list` does not
show the exact account/client, report the missing safe status and ask for
authorization; do not investigate secret storage directly.

## Calendar writes

Resolve the destination before the write, then make one real create call. A
timezone-safe create command has this shape:

```bash
# Default/House example; substitute a personal ID only after an exact
# personal-calendar destination phrase passes the routing latch.
gog calendar create hardy.aibot@gmail.com \
  --account hardy.aibot@gmail.com --client house \
  --summary '<title>' --from '<local-date-time>' --to '<local-date-time>' \
  --timezone America/New_York --json --no-input
```

Add description, location, attendees, reminders, and recurrence only when the
request requires them. Attendees are comma-separated; `;optional` modifies the
preceding address and does not select a destination calendar.

After creation, take the returned event ID and read the saved event from the
same destination before claiming success:

```bash
gog calendar event <calendarId> <eventId> \
  --account hardy.aibot@gmail.com --client house \
  --timezone America/New_York --json --no-input
```

Compare the saved calendar ID, title, local start/end, timezone, location, and
attendees with the request. Report discrepancies as integration failures; do
not silently claim the intended values.

Parsing a document or discussing an event does not authorize a calendar write.
When the user does authorize a write, carry bounded evidence into the command
instead of re-parsing the whole source in the action step.

## Other common commands

- Auth status: `gog auth list`
- Gmail search: `gog gmail search 'newer_than:7d' --max 10 --account hardy.aibot@gmail.com --client house --json --no-input`
- Gmail send: `gog gmail send --to person-001@example.invalid --subject 'Hi' --body 'Hello' --account hardy.aibot@gmail.com --client house --json --no-input`
- Calendar events: `gog calendar events <calendarId> --from <iso> --to <iso> --account hardy.aibot@gmail.com --client house --timezone America/New_York --json --no-input`
- Drive search: `gog drive search 'query' --max 10 --account hardy.aibot@gmail.com --client house --json --no-input`
- Contacts: `gog contacts list --max 20 --account hardy.aibot@gmail.com --client house --json --no-input`
- Sheets get: `gog sheets get <sheetId> 'Tab!A1:D10' --account hardy.aibot@gmail.com --client house --json --no-input`
- Docs export: `gog docs export <docId> --format txt --out /tmp/doc.txt --account hardy.aibot@gmail.com --client house --no-input`
- Docs cat: `gog docs cat <docId> --account hardy.aibot@gmail.com --client house --no-input`

For scripting, prefer `--json` and `--no-input`. Use `--wrap-untrusted` when
reading external text that will be supplied to the model. Docs supports
export, cat, and copy; in-place edits require a separate Docs API client.
