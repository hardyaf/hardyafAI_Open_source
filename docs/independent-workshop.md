# Independent workshop

Deployed November 27, 2026. All three natural model cases and independent live deployment verification passed; acceptance details are recorded in current-status and private deployment evidence.

The owner gives Jarvis an objective. Main can investigate, write arbitrary programs, build temporary skills, combine existing methods, install packages, run experiments, inspect failures, revise its approach, and delete disposable helpers. It can retain useful methods as ordinary files and reuse them across conversations. No skill registration or permanent promotion is required. Prompted source improvements use editable copies of the supplied application and pinned native runtime source.

## Restriction removal

| Former workshop restriction | Result |
| --- | --- |
| Offline sandbox | Removed. Normal bridge networking and package downloads. |
| Fixed CPU, RAM, swap and process quotas | Removed. No added Docker limits; inherited quotas are checked too. |
| Read-only OS and unprivileged lab user | Removed. Root inside the container, writable OS, normal package managers and default container capabilities. |
| Small shared memory filesystem | Removed. Shared memory can use host RAM. |
| Package and inline interpreter bans | Removed. Native full execution with inline evaluation enabled. |
| Compound-script preflight and guest command-pattern blocks | Removed for the protected workshop's full execution mode. |
| Root file tools using host-side reads | Replaced with the native filesystem protocol running entirely inside the container. Root-owned files, symlinks and hardlinks work without exposing host files. |
| Workspace-only file tools | Removed inside the lab. |
| Mandatory specialist helper | Removed. Main works directly; native children remain an optional method. |
| Obsolete workspace script recipes, compulsory solution preflights and conductor/phase-ledger workflows | Removed. Current native capability contracts own procedures; Jarvis chooses its workshop methods. |
| Artificial formal goal for workshop work or native children | Removed. Existing current user/source authority is sufficient. |
| Fixed local model/reasoning choices for optional native children | Removed. Jarvis may select registered local models and native reasoning settings. The existing Main default is retained. |
| Per-task project slug, prescribed methods and startup inventory | Removed. Jarvis chooses its files and methods. |
| Mandatory publisher and parent result-verification calls | Removed. Final file links attach actual files automatically. |
| Deliverable format and 25 MB input-buffer limit | Removed for generated files. Generic binary files and streamed downloads reuse the existing artifact store. Model input limits remain separate. |
| Automatic workshop pruning | Disabled. Jarvis controls experiment cleanup. |
| GPU exclusion | Removed. Both GPUs are exposed with native CDI; no separate GPU scheduler or model server is added. |

The environment is persistent on the large data volume. Native agent-scoped workspaces hold projects, temporary skills and retained methods. Lab-owned copies of `/usr`, `/etc`, `/var`, `/opt`, `/tmp` and `/root` preserve installed software across container recreation. The writable lab copies are never host system directories. The code-only reference snapshot is mounted at `/reference` read-only; Jarvis can copy and modify it freely in the lab. Reference updates are explicit source snapshots with a file hash manifest.

## Reuse and ownership

| Component | Decision and owner |
| --- | --- |
| Execution, sessions, children, continuation and cancellation | Reuse stock pinned OpenClaw. No parallel task engine, queue or supervisor loop. |
| Owner identity, current source and audience | Adapt existing admission, execution grants and domain authority. Main's direct tools recheck current owner/private authority and the actual native sandbox. Deferred tool calls undergo the same check. |
| Files and installed packages | Adapt the native Docker agent scope and ordinary files on the data volume. No skill registry or memory database is introduced. Jarvis chooses retention and deletion. |
| Reference code | Existing application and pinned native distribution remain authoritative; the lab receives a static code-only projection. No automatic refresh or reverse sync. |
| Deliverables | Reuse ArtifactStore scope, immutable objects, hashes and app artifact cards. Final Markdown links such as `[report](workshop:/workspace/project/report.md)` trigger native container file capture. No separate publisher, index or store. |
| Large file delivery | Extend ArtifactStore with streaming capture and integrity-checked downloads. Existing buffered model input limits do not limit generated files. |
| Native compatibility | Adapt two pinned native modules plus one namespace-only filesystem adapter, gated by protected workshop configuration. This fixes observed compound-command rejection and root-file readback failures. The existing eight V5 context files remain byte-identical. No new backend, task engine or queue. |
| Cancellation while Main waits for a child | Extend existing exact-run control using current source/grant lineage when native lastRunId is temporarily absent. Validate the root and every child before aborting; never issue an unqualified delayed abort. No new control ledger. |

Durable task/source state stays with existing native and household authorities. Notes in the lab are explanatory files, not another execution ledger. Household effects still use their existing owning domain services. The credential service, live deployment, account grants, disabled scheduling and pinned native V5 distribution retain their current owners. The lab receives no host Docker socket, SSH keys, production credential directory, logged-in host browser, live configuration or business database mount. These are the previously agreed credential and live-system boundaries.

The large SQLite store only composes cancellation with its existing source/control owners. The new lineage policy is extracted into a focused module rather than expanding that already-large module's policy responsibilities.

The existing domain runtime composes the owner policy, native sandbox proof and a separate workshop deliverable adapter. Filesystem dispatch lives in the small namespace adapter, not in that already-large runtime. The native compatibility payload is reproducible through `deploy/hardybot/workshop-runtime-patch.py`, with exact before/after hashes in its separate manifest. The original V5 manifest and its eight files are retained unchanged.

OS initialization captures a clean GPU-enabled native CDI container, including the GPU userland that a plain image export omits. No host system directory is copied. The persistent OS state must remain compatible with the installed host GPU driver. The existing ArtifactStore moves intact to a private, unmounted directory on the large volume; its IDs, scopes, ownership and immutable objects stay authoritative. The old copy is retained as a migration preimage and receives no subsequent writes. No business database is restored.

## Acceptance

Verify the resolved native config and actual Docker HostConfig: no CPU/memory/PID quotas, writable root, lab-only mounts, bridge network, root user and CDI devices. Exercise package installation, inline scripts, both GPUs, persistent files/software across container recreation, and a fresh native browser. Verify own-code reading and editing a copy. Test current-source revocation, shared/nonowner isolation, deferred-tool checks, exact-run cancellation and credential separation.

Natural model acceptance uses synthetic tasks without supplied commands: explore and verify a result, reuse a retained method in a new conversation, and create/test a source improvement without deployment. Download the actual generated artifacts and compare their contents/hashes. A running process, successful component test or prepared image does not by itself establish natural model acceptance or production activation.
