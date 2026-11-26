# Local Contacts authority

This domain owns the local Rolodex, immutable card observations and current
contact revision pointers. It reuses the application's injected SQLite
connection and migration authority; `contactsMigrationSql` is applied by
`app.db` composition, never by a background contact worker. There is no
second contact store, task engine, review broker or Google Contacts mirror.

`ContactsService(db, sourceAccess, extractionAccess?)` receives narrow source
publication and owning Documents extraction ports.
`ArtifactContactsSourceAccess` adapts the existing ArtifactStore and copies
only intended card bytes into the chosen private/shared card projection.
Default capture is shared household. A source record and sparse contact commit
even when there are no readable fields. Distinct intake operations remain
distinct cards; search results cannot authorize a merge.

Initial fields need an owning extraction result bound to the supplied source
hash, plus an exact supporting quote or literal field match. The application
resolves supplied extraction handles or attempts local extraction; a model
repeating a value as an observation is insufficient. Normalized field wording
may differ from its exact quote. Unsupported values are omitted visibly; failed
or unavailable extraction retains the original card and an honest scan state.
A source-only save is distinct from a completed field extraction. Sources and old revisions are preserved. Current fields
are a projection of the single current revision, not a second canonical copy.

Mutation principals come from trusted application composition, never tool JSON.
They include the current admitted human `sourcePromptId`, scoped edit grants
and `assertCurrent`. A later revision/scope change also needs an exact trusted
`userPromptBinding` for prompt, conversation, task, contact, expected revision
and action. The original capture prompt cannot rewrite a reported contact.
Version checks, operation fingerprints and the revision/current-pointer/receipt
transaction prevent stale overwrites and conflicting replay. Field patches
merge only explicit set/remove targets under the current revision and preserve
unrelated fields, observations and uncertainties. Manual corrections need no
OCR; the model-facing redo resolves fresh owning extraction evidence. Failed OCR does
not change contact state; a successful redo is a new revision.

`contacts.operation_status` reads the caller's durable committed receipt after
an uncertain response without repeating its effect. Tool write responses carry
bounded receipt/current-field previews with explicit truncation flags and
counts; full observations and history remain available through read tools.

`authorizeSource(principal, artifactId)` is the read interface for other
domains. It checks only current source references of contacts the caller may
read; it does not expose Contacts tables, private origin conversation metadata
or broader artifact authority. Sharing a current record does not publish
historical private revisions. Scope reduction changes the current contact
projection; previously published immutable source artifacts and recipient
copies are retained and the receipt reports that limitation.

Household conversations cannot read the caller's private contacts, private
historical revisions or private operation receipts. Private captures and scope
changes into private storage require a private conversation. The dedicated
default-shared card-capture purpose remains an explicit publication of only
the selected card bytes under the agreed product policy.

Composition registers the descriptors from `createContactsTools(service)`.
The domain does not parse phrases, decide the user's intended correction or
run a fixed workflow. The model composes lookup, local extraction, capture and
explicit revision tools under deterministic grants. Deletion/merge and Google
Contacts synchronization require their own retention/conflict rules and are
not exposed by this initial authority.

Backups include the owned tables and linked ArtifactStore originals. Rollback
can disable new tools while preserving originals, revisions and receipts; do
not restore an older database over subsequent saved contacts. No bulk legacy
contact migration is performed. Focused behavior regressions and the model-led acceptance campaign establish
functional behavior; deployment syntax/import/schema checks alone do not count
as card quality or family privacy acceptance.
