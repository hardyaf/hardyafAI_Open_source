# Android receipt capture

Owner and Adult can open **New receipt** in the drawer, take a photo, and
choose a destination after the upload. **Household finances** is the default.
Tag **Uplift** to send the photo to the existing Uplift originals and intake
ledger. The Uplift project catalog, allocations, and acceptance retain their
prior authorization. Uplift's intake confirmation means the original was
saved for project filing.

The household ledger uses its own private SQLite database. The existing
household artifact store owns immutable source photos and extraction evidence.
The local Documents service performs OCR. Clear, explicitly labelled
merchant, date, currency, and total fields can be filed automatically as a
receipt summary. Photos with uncertain values, extraction warnings, or an
existing summary match require a human to verify before filing. The ledger
screen links to the source photo and OCR. Summary amounts are signed integer
minor units for supported two-decimal currencies.

The signed phone route admits only Owner and Adult. Each can route their own
uploads and view or review household receipts. Uplift intake status and
unrouted photos are visible to their uploader. The photo hash prevents an exact
image from being filed twice through this capture flow. The destination is
bound before processing. A retry of the same capture uses the existing original,
OCR evidence or Uplift intake operation. An interrupted attempt remains visible
in the app for retry. Capture has no background queue.

On Hardybot the household ledger is created under the existing state root at
`household-finances/ledger.sqlite`. Use the existing signed API, artifact and Uplift
backup procedures with a consistent backup of the household ledger. For a
source rollback restore the prior app and service source while retaining the
new ledger, originals, Uplift records and evidence.
