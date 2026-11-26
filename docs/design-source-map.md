# Household design source map

Updated November 3, 2026.

These are implementation references, not active dependencies or proof that the current product contains their features. Sibling links work in the local checkout layout. Resolve private machine roots in local context rather than copying operational secrets into product documentation.

## Current OpenClaw project

- [Task conductor](task-conductor.md): accepted one-worker round trip, headroom policy, remaining chain/recovery work.
- [Memory](memory.md): deployed file/index/dreaming baseline and planned wiki integration.
- [Household capture](household-capture.md): canonical scoped lists/notes and dashboard projection.
- [Local documents](local-documents.md): existing PDF/CPU extraction and artifact contracts.
- [App architecture](household-app-architecture.md) and [acceptance](household-app-acceptance.md): identity, routing, submission replay and real-phone evidence.
- [Current status](current-status.md): audit defects and proposed features.
- [Local Rolodex decision](ADR-001-local-rolodex.md): contact authority and every-card behavior.

## Uplift receipt workflow

Source repository: sibling Uplift Projects/Uplift_Finance. Do not open or copy receipt vaults, ledgers, credentials or financial data to perform source integration.

- [CLI](<../../Uplift Projects/Uplift_Finance/uplift_finance/cli.py>): operations and headless entry points.
- [Immutable vault](<../../Uplift Projects/Uplift_Finance/uplift_finance/vault.py>): original hash/manifest handling.
- [Mail intake](<../../Uplift Projects/Uplift_Finance/uplift_finance/email_ingest.py>): attachment ingestion and mailbox effects.
- [Ledger](<../../Uplift Projects/Uplift_Finance/uplift_finance/ledger.py>) and [schema](<../../Uplift Projects/Uplift_Finance/sql/schema.sql>): authoritative receipt/transaction state.
- [OCR](<../../Uplift Projects/Uplift_Finance/uplift_finance/ocr.py>): provider adaptation and canonical output.
- [Project reports](<../../Uplift Projects/Uplift_Finance/uplift_finance/reports/project_pdf.py>): PDF/report composition.
- [Review HTML](<../../Uplift Projects/Uplift_Finance/scripts/review_receipt.py>): inspection output, not a complete correction application.

See the [receipt reasoning/acceptance policy](receipt-acceptance-policy.md). Adapt individual evidence/OCR/ledger/report operations into composable tools. Main selects the sequence and interprets the evidence; no fixed pipeline is imposed on novel receipts. Keep Uplift the financial owner. Its current real OCR is cloud-oriented and mail intake can change read state; both differ from the agreed local-default household design and require deliberate adaptation.

## Historical business-card work

- [ContactProvider](../../HardyAI/app/people/types.py): provider-neutral contact search/upsert boundary.
- [Matching](../../HardyAI/app/people/matching.py): explainable candidate matching.
- [Extraction](../../HardyAI/app/skills/domains/documents/extraction.py): card fields and evidence.
- [Contact proposals](../../HardyAI/app/skills/domains/documents/contact_proposals.py): version-bound proposals and provider gating.
- [Query service](../../HardyAI/app/skills/domains/documents/query_service.py): review/readback context.
- [Business-card review fix](../../HardyAI/docs/OCR/OCR-Business-Card-Review-Fix.md): historical extraction/correction evidence.
- [Historical deferred authority](../../HardyAI/docs/ADR-002-contact-authority-deferred.md): explains why no canonical contact was written.

Adapt individual contracts where suitable. The new local Rolodex decision changes the future capture policy; do not import old mandatory per-card approval behavior accidentally.

## Frozen kitchen-screen reference

[Display-node build instructions](../../Jarvis/Construction_markdowns/jarvis-display-node-codex-build-instructions.md) specify a Raspberry Pi Chromium kiosk and JSON view messages. The specified application directory was absent in the reviewed archive. No completed Arduino client was established.

Keep the archive read-only. Reuse the thin-client/message concepts against the current household API; do not copy its missing authentication assumptions or rebuild its retired server.

## Native capability references

Validate against the installed OpenClaw version before choosing configuration:

- Package documentation: concepts/agent-loop, concepts/subagent-yield-handoff, concepts/session-tool, concepts/compaction, tools/goal and tools/progress-card.
- Package documentation: plugins/memory-wiki, concepts/dreaming and concepts/memory-provenance.
- [Official successor ownership](https://docs.openclaw.ai/concepts/subagent-yield-handoff).
- [Native secret contract](https://docs.openclaw.ai/gateway/secrets/secretref-contract).
- [Tool policy](https://docs.openclaw.ai/gateway/config-tools/tool-policy).
- [Bitwarden machine accounts](https://bitwarden.com/help/machine-accounts/).
- [Bitwarden Secrets Manager CLI](https://bitwarden.com/help/secrets-manager-cli/).
- [Password Manager CLI](https://bitwarden.com/help/cli/).

A bundled plugin or installed CLI is a reuse opportunity; configuration, authority, correct model use and actual end-to-end acceptance remain separate requirements.

## Integrated Slice 2 owners

The active reusable adaptation is now in this project's
`integrations/uplift/uplift_finance_bridge`, with operation schemas in
`integrations/uplift/operations.json`. It uses its configured Uplift DB/vault,
not the household database. No donor financial data or unsafe workflow entry
point was copied or invoked. Contacts/Documents and native adapters are under
the household service's `src/domains`; the native plugin and application
composition are separate. See [implemented boundaries](slice-2-domain-capabilities.md).
