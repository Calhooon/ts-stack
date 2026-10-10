# #544 implementation map (unpublished candidate)

This map accounts for the authored source of all 24 required behavior families.
The original full occupied customer workflow on source316 committed12/14 rows
before failing the actual non-null broadcast-column constraint. Legacy request
metadata creates own undefined optional broadcast/retry properties; native
private insertion serializes those as SQL NULL instead of using the existing
false/zero migration defaults. The ordinary native sync writer also rejects
that optional shape. Genuine private insert/rollback/update and ordinary native
writer regressions reproduce both unchanged-production failures on source317.
The private and ordinary native writers now omit only undefined optional
broadcast/retry columns before normalization. Inserts use the existing schema
defaults; updates preserve stored counters. Explicit false/zero and true/retry
values remain writes, and nullable fields retain their existing handling.
The same five genuine regressions require fresh qualification of this correction.
The failed full run drained cleanly after1105.817s, without timeout/native fault
or OOM. All original customer data, expiry, cases and semantic oracles remain.
The complete wallet and test-source compiler now passes with zero diagnostics.
Selected functional cohorts pass, including the native schema compatibility and
measured migration fixtures described below. Full system, supported-host,
resource, artifact and exact-head hosted qualification remain pending. PR569
stays open and unmerged. Source custody or a passing historical campaign never
establishes current readiness.

The complete original Linux root formatting gate passes. The original root
typecheck reached the wallet examples and exposed an ESM worker boundary and
missing browser hash declarations in their compiler inputs. The dedicated worker
example now uses an explicit `.mts` module and the same fixed client entry, with
Node-compatible `.js` relative imports. The example configuration retains every
existing TypeScript input and includes the existing precise hash declarations.
The fresh original full Linux root typecheck passes across all workspace
projects, including the client, mobile, examples and operator. Full root lint and
formatting also pass. No compiler option, runtime contract or worker resource
limit is relaxed. The complete current root control suite passes all 374 cases.

The complete 27-case storage-manager cohort executes 25 passing cases and two
external-fetch failures, then fails to exit before its supervisor deadline.
The existing intended synthetic chain tracker is now established before signing
in those two cases, and the owned test wallet and service spies use `finally`
cleanup. All original cases, operations and assertions remain. Fresh runtime
qualification of that correction is still required; the failed run is retained.

## Coordinator and storage

| Required behavior                                                          | Concrete implementation                                                                                              | Authored coverage                                                                                                            |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Atomic page ownership, foreground fairness, bounded queue and cancellation | `WalletStorageManager`, `StorageAccessQueue`, `commitSyncAdmission`, `runPullSession`, `runSnapshotSyncSession`      | Queue unit/generated cases; sync-session and snapshot-session cases; manager transition/journal cases                        |
| Explicit reentrancy and current primary fence                              | Borrowed `runAsSync(callback, activeSync)`; generation/provider/identity checks under ownership                      | Manager provider-transition, primary-switch and stale-work cases                                                             |
| Durable destination acknowledgement and restart                            | Snapshot sync destinations; journal reconciliation/status recovery; durable normalized ID mappings                   | Lost-reply, replacement-manager, interrupted writer and rollback cases                                                       |
| Coherent local capture and indexed keysets                                 | `KnexWalletReadSnapshot`; retained SQL RC/RR/WAL views; `openPackedIdbSyncSource`; journal receipts/high-water/floor | SQL isolation, same-timestamp, full closure, tombstone and retention cases                                                   |
| Packed IDB and bounded large fields                                        | Packed v7 fields/versions, binary chunks, UTF8/UTF16 and structured-field preparation                                | Large-row, staged-reference, atomic rollback, corruption, quota and physical-retirement cases                                |
| Adaptive byte/latency budget                                               | `SyncPageBudget` fixed versus marginal fitting, smoothing, hysteresis and bounded upward probes                      | Unit/generated fixed-latency, large-proof and table-transition cases                                                         |
| Authenticated full source archive                                          | `StorageClientBase` + `StorageServer` + snapshot archive RPC/service/remote source                                   | Authenticated HTTP, all thirteen original tables, identity/network, expiry, quota, close/recovery and old/new cases          |
| Negotiated remote destination                                              | `RemoteSnapshotSyncDestination`, `KnexRemoteSnapshotSyncRpc`, durable transfer/checkpoint tables                     | Real HTTP/SQL held-I/O, foreground access, primary replacement, multipart, malformed data, lost reply and atomic fault cases |
| Raw bytes with legacy interoperability                                     | Binary JSON negotiation and bounded snapshot-transfer pieces                                                         | Binary/JSON peers, integrity and ordinary legacy chunk cases                                                                 |
| #542 returned error handling                                               | `throwSyncResultError` before counters/checkpoints/completion in every chunk consumer                                | Third-party returned errors and unfinished no-progress refusal                                                               |
| #543 basket mapping                                                        | Shared output merge policy validates non-null parent mapping and repairs existing output basket association          | Missing mapping, repeat merge and stored-row repair cases                                                                    |

The original request admission is retained across availability I/O and read-mode
reselection, so the wait-queue bound cannot be bypassed by pending initialization.
It bounds request count, not arbitrary caller payload bytes.

Reads and proof preparation occur outside atomic destination ownership. A queued
cancellation cannot invoke the operation. Once invoked, the original commit and
its actual durable ACK/failure are awaited; cancellation cannot turn a lost reply
into a fabricated zero-progress result. Journal custody observations intentionally
remain available after cancellation. Legacy providers retain serialized execution.
Read-ahead is an evaluation item: this candidate retains one ordered page in
flight, rather than enabling unmeasured parallel readers or writers.

## Portable archive and recovery

| Required behavior                                                   | Concrete implementation                                                                                                    | Authored coverage                                                                                                             |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Canonical streamed BRC-38, nullable histories and source provenance | `createBrc38Stream`, streamed rows/structured fields, coherent native/IDB/remote sources                                   | Independent canonical vectors, all thirteen tables, exact binary/structured values, nullable fields and non-mutating captures |
| Node streamed BRC-39                                                | `Brc39StreamNode`, owned one-shot Argon2 worker/ready native backend, native GCM                                           | Independent NFC/KDF/GCM bytes, abort and actual worker exit, strength, corrupt/truncated/oversized files and private staging  |
| Browser streamed BRC-39                                             | Browser stream export, `Brc39WebCryptoGcm`, authenticated streamed browser staging                                         | Independent native GCM oracle, arbitrary chunk/block boundaries, private quarantine, cancellation and final-tag withholding   |
| Asynchronous worker/native KDF                                      | First-party browser Worker backend + explicit installer; optional ready host-native backend                                | Native browser Worker/NFC/foreground cases and selected-backend failure/input-erasure cases                                   |
| Authenticated import preview                                        | Native private preview and browser `previewAuthenticatedBrc39BrowserImport`                                                | Data-only preview, wrong identity/network/password, original provenance and cleanup cases                                     |
| Isolated semantic restore and repeat merge                          | Native composed import/recovery and browser `restoreAuthenticatedBrc39BrowserInactive`                                     | Empty/occupied/repeat targets, all entity policies/relationships, actual stored bytes, restart and no implicit activation     |
| Publication, explicit selection and retirement                      | Native publication receipts/catalogue/current observer; browser publication/profile selection/retirement                   | Lost-ACK recovery, inactive versus selected state, manager reopen, changed data, expiry and physical cleanup cases            |
| Native physical custody                                             | Common private filesystem bridge; Unix driver; Windows original HANDLE/DACL/image/job implementation and candidate recipes | Authored platform identity/privacy/cleanup and retained native contract cases; Windows execution remains unqualified          |

BRC-38 includes original source settings/user metadata and its thirteen closure
tables. It excludes root keys, pending action batches, auxiliary runtime tables
and storage-global logs. Restore preserves historical managed-change values;
any later operational policy upgrade is explicit. Import success is data recovery,
not proof of key recovery or permission to activate a primary.

Packed IDB v7 uses a new namespace and rejects in-place v6 conversion. Copy data
through the negotiated path and retain the original v6 database for rollback.
Never reset an existing database. A private restored profile remains inactive
until an explicit, currently fenced selection operation succeeds.

Node KDF admission is per installed module instance, not a kernel-wide memory
quota. Browser Worker termination is the native browser API call; browsers expose
no process-exit receipt. Windows executable/addon/supervisor qualification tables
remain empty until actual host qualification. None of these limitations may be
relabelled as verified physical platform behavior.

## Device and consumer integration

`DeviceBackupController` shares only bounded versioned device preferences
(automatic backup and host catalogue destination IDs). Every participating
profile has its own identity, network, manager, provider and durable checkpoint.
There is no shared primary choice, archive identity or recovery journal. Unknown
preference versions refuse; supported legacy preference values are preserved.
The host explicitly persists migration through atomic preference storage.

Construction launches no backup or timer. The host calls foreground cadence,
`suspend()`, `resume()` and `close()`. Suspension cancels queued work but joins the
actual original in-flight commit and cleanup; failed cleanup fences reuse and
retains its concrete retry owner. `examples/deviceBackup.ts` demonstrates this
lifecycle. Node, client and mobile entrypoints export the controller and shared
contracts. The mobile build supplies authenticated remote storage, not an
installed native SQLite/IndexedDB provider. Native host providers/KDFs and
physical suspension behavior require separate device qualification.

The packed current-row and restore-journal comparisons share one complete
metadata-data comparator. It compares every field, extent and genuine Date
internal slot, including native structured clones from another realm. Every
caller independently repeats its original current transaction, source, primary,
profile, revision, schema, content and expiry checks; equality confers no owner
or retained admission result.

## Qualification wiring and acceptance

The public Node authenticated native merge reserves incoming ID ranges on the
current source primary before copying or importing. Resume reuses the immutable
ranges, original limits and expiry. The source's AUTOINCREMENT floors advance
permanently so foreground allocations cannot collide with an inactive candidate;
existing wallet rows and profile selection remain unchanged. Cancellation does
not reclaim these counter holes. Catalogue cleanup removes expired range records
without lowering counter floors. This effect is part of the import contract.

The public entry-point cases independently compare all47 rows and complete
payloads, repeat full-envelope authentication with different chunk boundaries,
lose an observer acknowledgement after a committed import, and reject wrong
passwords, binding changes, corrupt tags and truncation while preserving actual
candidate rows, reservation charges, ranges and original expiry. Separate merge
runner cases acquire fresh source/private read scopes between operations. The
public cases reopen a genuine private owner after the API returns. Neither kind
of case is a physical process-kill or platform qualification result.

The current enclosing comparison cases commit independently declared wrong
metadata or complete payloads in wallet, local recovery and checkpoint families,
require fresh composition to reject them, restore the fixture cell, and compare
the complete graph again. User-header cases cover older/equal/newer timestamps,
another local user, changed identity/primary/date metadata and source refolding.
Current SQLite user identity and primary columns are NOT NULL; the NULL negative
case checks the actual SQL constraint instead of fabricating an impossible row.
These authored cases remain unrun.

The current native browser catalogue explicitly selects all 60 exported cases
from 19 source modules. `client/test/portable-program-browser.cjs` bundles that
catalogue, loads the fixed built client worker asset, executes cases serially in a new
native browser, rejects case deadlines/faults, compares actual exported selection,
and retains original cleanup promises. The complete original catalogue now passes all60 cases in19 modules on native Chrome154.0.8037.98. The dedicated Worker/KDF, full authenticated restore/preview/publication/activation, snapshot, corruption/refusal and cleanup cases run in one current-source cohort under all original30-second case deadlines. The primary browser emits an actual zero exit with no signal, its supervisor group drains and no new private profile remains. This is browser functional evidence; physical RSS and complete operating-system tree/platform qualification remain open.
A separately selected occupied-history component now runs through the actual
installed Chrome and the original 30-second case deadline. It preserves the
private source's one-MiB row allowance by reserving a complete child allowance
in the shared working owner until its source actors physically drain. The
fixture independently rejects an orphan global request before adding the
required active-user transaction for the positive merge. Both original cases
pass, including exact legacy history spelling, bytes and zero retained charges.
The launcher owns a private profile, uses an inherited process group, bounds
startup/output and waits for its actual Chrome child close before removing the
profile. That primary child receipt and the outer process-group drain do not
prove a complete operating-system tree or physical RSS bound. The later full60-case browser/Worker cohort passes. Physical platform and resource qualification still remain required.

Ordinary wallet build now installs the source-owned native/CJS asset cohort after
TypeScript emits its required siblings. Ordinary Jest discovery includes the
existing source copier/preparer CJS cases. The client build emits a self-contained
dedicated worker; `test:browser` retains the original benchmark and adds the
complete native browser catalogue. Packed API requirements and the device
declaration consumer include the current backup/recovery contracts. These
core build, fixed source-asset copier and strict declaration consumer pass.
The client, self-contained dedicated worker and mobile builds also pass.
Packed runtime contracts and the complete ordinary Jest suite remain pending.
The preceding Source207 cohort passed all266 cases in21 selected suites. The
original242 cleanup/structured-stream, raw-stream/chunk/text/property/source-asset,
queue/budget/admission and packed-IDB/legacy-page cases remain, with six new
nested traversal/stage-read/byte-brand cases and eighteen metadata/component
cases. One separate authenticated point-index case passes on synthetic private
temporary files; the remaining original index cases are not covered by that
filtered run. These results do not qualify the full composition. Genuine foreign-realm Date and
DOMException internal-slot checks preserve values without accepting brand
impostors. Native stored JSON member data is copied through bounded own data
properties before the unchanged member validator; caller-supplied members and
all actual source/connection/transaction ownership checks retain their original
requirements. The streamed source passes captured binary fields to its encoder
rather than its already-base64 ordinary projection. The pinned fake-indexeddb6.2.5
development patch models the browser's readonly database-name getter using a
private slot, retaining the factory, requests, transactions, cases and budgets.
Sealed unattached stages now read through their actual owner; the operational
reader retains its referenced/retired-content guard. Both recursive JSON spelling
paths use bounded member point reads, including native-file and private-browser
adapters, without retaining nested host iterators or raising the original
iterator/allocation limits. Journal headers read bounded inline metadata in the
same native transaction and preserve fresh schema/profile/primary/revision/expiry
checks. Native schema attributes are read directly without idb wrapper allocation;
clock/schema verdicts are never cached. The occupied request case retains its
original30-second deadline, repeated preparation and exact stored histories,
notification bytes, reset-only write condition and durable acknowledgement checks.
The three structured JSON output paths now share one bounded UTF-8 emitter.
It preserves the original output and per-part working reservations, transfers
full chunks without erasing caller-owned bytes, erases its unfinished buffer on
close and withholds its final partial chunk through the original exact-span and
whole-source digest checks. All115 original structured JSON cases pass after
this consolidation. This reduces the measured Vite artifact by590 raw,129 gzip
and156 Brotli bytes; it does not resolve the remaining bundle-size gap.

The current nine-file component cohort passes74 original cases, including the
actual occupied-history Chrome case and the full metadata Date/extent comparison
cases. The other73 cases use emulated IndexedDB or pure source fixtures.
Fake-IDB evidence still does not qualify native browser execution. Both original
package-documentation and repository-health checks pass after correcting only
the SDK baseline version to the actual unchanged3.2.1 source manifest.

The property command and shared registry preserve all 21 existing wallet
selections and add 40 missing authored files: 56 property files plus five
retained ordinary oracle suites yield 61 selections. The ordinary build runs
before the command validator and selected cases. The platform validator adds
current exports and the actual packed dedicated-worker contract while preserving
every original bundle ceiling. These source changes follow the acknowledged
held569-only division. The original registry goldens and the complete
61-suite command validator pass; no instrumented mutation campaign has run.

The full native run exposed two runtime gaps: the original-provenance extent
reader omitted already-supported scalar TEXT, and attaching one genuine stage
to two columns unpinned it before the second column's fresh validation. Both
are repaired under the original current owner/receipt/schema/expiry/range/quota
checks. Shared staged fields validate before any unpin, and each content is
unpinned once within the same native writer; the original128-field limit and
reference multiplicity remain. Independent oracles retain every complete value,
key, extent, hash and refusal while correcting JSON insertion-order assumptions,
optional-coordinate expectations, inactive-writer lifecycle and the distinction
between field-internal and archive whitespace. Prior failures are preserved.
The controller closes its owned page before Chrome and releases only its own
diagnostic handles after the actual primary kernel exit. Zero exit/no signal
and separate supervisor drainage remain required; no complete OS tree or
physical-memory claim follows from that observer cleanup.

The preceding browser artifact gate failed under the original limits: its Vite
consumer measured 3021960 raw, 718875 gzip and 545678 Brotli bytes against
2515000, 600000 and 460000. That failed sample remains preserved. On October 8,
2026, the operator explicitly authorized a 30% increase on held PR569 for the
browser budget, with review after full implementation, validation and feature
completion. The branch ceilings are now Vite 3269500/780000/598000 and esbuild
2554500/708500/559000 bytes (raw/gzip/Brotli). Only these six numbers change;
full namespace exports, composition checks, public names, properties, licenses,
annotations, source/declaration maps, build settings and all test/runtime
controls remain. Raising a ceiling is not evidence of a passing artifact or
feature completion. The post-goal budget review must compare the qualified
complete feature set and accepted baseline cost, consider measured size
reductions, and record the resulting retained or reduced ceilings.

The current critical-source
inventory records 495 changed TypeScript modules: 476 runtime selections,
18 independent fixture inputs and one type-only contract. Source selectors
retain every original target and control; compiled coverage and mutation
execution remain required.

`bench:snapshot-program` adds the actual authenticated HTTP snapshot destination
to the measurement wiring, alongside the unchanged legacy replica benchmarks.
It seeds all thirteen archive tables, then measures the twelve replica tables
(original source sync states remain archive provenance). Small, large and large
individual-record fixtures each measure cold, unchanged and incremental copies
with zero or 15ms fixed RPC latency. Reports contain real request/response body
bytes, SQL query counts, sampled process RSS/CPU, foreground percentiles and
queue/read/preparation/commit-acknowledgement times. Commit acknowledgement time
includes transport and validation; it does not measure SQL lock duration. A
separate case measures cancellation after an acknowledged page, destroys the
actual TCP connection after a real server commit, independently observes its
durable checkpoint and retries to completion. Fixed synthetic header services
are protocol oracles, not live-chain proof. These commands are unrun and do not
establish browser, export/import, custom-engine or physical-device performance.

The full current source must be frozen with compiled worker siblings, native
assets/candidate recipes, declarations, ordinary examples, all authored unit and
browser/native cases, property selection, complete critical mutation coverage,
and security/format/platform gates. Newly added sources require fresh registry,
controller, resource and actor agreement; historical suite counts or executable
pins cannot grant coverage or runtime admission to them.

Then qualify component baselines and their complete composition on SQLite, real
browser IDB and authenticated HTTP: small/large wallets and large individual
records; cold, incremental, unchanged, export and import; normal, latency and
disconnection schedules. Record real wire/query/CPU/peak-memory/queue/lock and
cancellation measurements plus foreground p50/p95/p99. Retain every original
case, seed, replay, threshold, deadline and interruption failure. A fake IDB or
independent crypto oracle alone cannot qualify native browser/device behavior.

All eleven program acceptance rows remain open until their required evidence is
present. Exact-head local gates and hosted CI, analyzers/reviews, compatibility,
rollback and physical platform records remain required. Publishing, provider
rollout and funded recovery require their explicitly authorized operational
steps after artifacts are concrete and validated. PR569 must remain unmerged.

The current mutation source registry retains all original 57 definitions and
adds exactly one target for each of the 40 newly registered wallet property
suites (97 total). Ordinary companion tests support those suites without being
misregistered as generated properties. Original controls and ranges remain.
This registration is source wiring; complete critical-source/per-test worker
coverage and an actual mutation campaign remain required.

The added measurement sources use one fixed small/large/large-record matrix.
`bench:snapshot-program` now selects authenticated HTTP destination measurements
and encrypted full-thirteen-table SQLite export/private staging import, with
fixed zero/15 ms RPC and zero/5 ms chunk latency cases. Source SQL drains before
the private import pools open. Private staging success does not establish native
operational publication or activation. Native composition remains separately
required by the complete qualification plan.

The client's separate `bench:snapshot-program` runs an explicitly owned native
browser and its delivered worker asset. It measures full-thirteen-table
authenticated packed-IDB restore, actual activation/manager selection, cold,
unchanged and incremental negotiated replica copies, and export from the actual
packed source into bounded native IDB ciphertext storage. Its legacy decoder
oracle runs outside measured intervals. Reports include actual storage request
and write counts, native transaction wall time, event-loop/foreground
percentiles, queue/ACK timing and CDP task CPU/JS heap. Transaction wall time is
not SQL lock duration, and CDP heap is not process-tree RSS. An independent
resource supervisor must measure and drain all admitted browser/worker/bundler
processes. The original 60-case/19-module browser contract catalogue and its
30-second case limits remain unchanged. These measurement sources are included in the passing client source compiler
check but remain unrun; they are not acceptance evidence.

The native program measurement also selects the fixed three-size matrix. Its
separate opt-in fixture limits preserve the original native contract defaults.
It measures real full47 occupied composition, inactive publication and actual
manager cutover, then full13 streamed export from the current native provider.
The independent auxiliary oracle requires all47 tables and retained bytes;
legacy decryption separately checks labels, raw transaction, history and all13
archive tables. Source-chunk latency is fixed at zero or5ms. Original cleanup
uses the fixture dependency stack, which stops before removing a directory
while a stream, file, profile or kernel still retains work.

A separate genuine native-browser Worker case bridges actual instrumentation
counters from the main document and two real dedicated workers to Jest's
current per-test context. A separate MessagePort carries cumulative snapshots;
production READY/key messages and native transfer/termination remain intact.
Counters are merged by maximum within a worker and summed across independent
workers; missing or overflowed receipts refuse. Neither this bridge nor its
primary browser-child close receipt proves process-tree absence or resource
qualification. The original60-case browser catalogue remains independently
required. Source-only critical selection records the current 495-module
inventory; fixture/type inputs are explicitly retained without pretending they
are operational actors. Actual instrumentation/coverage/mutation remains unrun.

Node measurement reports name observed source/admission/serving Knex events.
They explicitly leave unobserved private-kernel counts and SQL lock duration
unknown; zero must not stand for missing instrumentation. Independent process-
tree RSS/CPU and lock traces remain qualification obligations.

The native measurement's bounded observer delegates to actual child spawn and
pipe writes, counts native SQL/request/reply wire traffic, and copies only fixed
reply headers. It stores no SQL, credentials, archive or binding payload. A
first observer fault cancels the genuine operation and is retained through
cleanup. Actual successful `BEGIN IMMEDIATE`/`EXCLUSIVE` and terminating replies
on writer slot0 enclose lock acquisition/release: begin-request to terminal-ACK
is a conservative upper window, begin-ACK to terminal-request a lower window.
These observations are not an exact in-kernel timer, profile authentication,
process-tree drainage or physical CPU/memory evidence. Fixture materialization
and independent legacy decode remain outside measured intervals.

The ordinary SQLite measurement also observes the exact original Knex driver
executor during each finite phase, including private staging clients. It
preserves the original receiver, arguments, returned promise and property
layout, then restores the original before later oracle/cleanup work. Source and
catalog events remain separately reported. Direct `connection.exec` transaction
controls are excluded; this count is not an inferred exact kernel lock trace.

Both ordinary and native measurement controllers now propagate sample/foreground
fault cancellation into the genuine source/crypto/import scopes and preserve
original failures through observer cleanup. Ordinary export reports foreground
p50/p95/p99 from its actual serving manager. Isolated private staging has no
serving manager and reports those foreground percentiles as unknown instead of
substituting zero. The benchmark command places all three explicit paths before
Jest's variadic ignore-pattern option so native measurement is actually selected.

## Current source compiler and assembly checks

On October 8, core, client and mobile source compiler checks passed after
integration repairs to exact SQL row bindings, IDB transaction modes and ordinary
current structured-field hash calculation. Those checks emitted no files and
executed no application or test code. The original composite core build then
passed, followed by its fixed C/CJS source-asset copier and strict declaration
consumer. Four imported fixture/measurement modules are explicitly registered in
the composite project; no strict setting, test case or threshold was removed.
Client, self-contained dedicated worker and mobile builds also pass. Source lint
passes with warnings denied. The current registry retains all 97 targets and
every original source range, case, threshold, seed, replay and deadline. The
source audit identifies a concrete path for each of its 24 required behaviors;
no additional missing runtime component is known. All acceptance rows still
require current execution evidence.

The broader advisory compiler over all legacy core test sources still reports
diagnostics and is not recorded as passing. None of these source checks qualify
runtime behavior, delivered worker execution, native binaries, coverage, performance
or production readiness. Complete delivery and qualification requirements remain
in force.

## Snapshot and journal integration feedback

The current source also passes 139 local snapshot/session/lifetime cases, 39
manager/journal/row-mapping cases against standard native SQLite WAL databases,
and 41 migration/raw-frame cases. The latter include four additive-index
installation/rollback regressions and exact framed rows across all thirteen
standard tables. A separate actual authenticated loopback HTTP run passes all
32 source/destination/archive cases for the full and mobile client classes,
including cancellation, lost replies, replacement controllers and legacy
compatibility. These local results preserve original case deadlines and process
bounds; earlier failures remain recorded.

The repairs compare retained reads with a captured inclusive monotonic deadline,
queue wallet access behind an actual active provider transition, detach bounded
own SQL column descriptors before strict framing, retain only key coordinates
in position records, and box Knex's thenable SQL expression until it enters the
same retained query. Additive index migration verifies every supplied definition
while counting only the thirteen-table source inventory. Empty migration adapters
preserve ordinary cleanup without unsupported journal DDL. Fault fixtures retain
actual private-field receivers; scheduler, timing and idempotent cleanup oracles
now reflect their existing contracts without removing full-value assertions.

This evidence does not qualify the custom native executable/Windows runtime,
physical devices, process-tree RSS/CPU, full property/mutation/coverage campaign,
performance matrix, released consumers or exact-head remote gates. All eleven
acceptance rows remain open. The operator-authorized 30 percent browser budget
allowance still requires review after the goal is achieved.

The complete original journal directory now passes 934 unit cases in 36 suites
and 128 cases in nine property suites. Generated properties retain their original
minimum 300 runs, seeds, replay controls and deadlines. Two additional negative
cases verify that an away-and-back primary change or direct epoch change rolls
back retirement custody, identity mappings and the user's epoch together. Actual
identity transition work now reacquires the destination write fence before and
after semantic work. Global membership predicates name their own key table
explicitly. These are standard native SQLite and independent MySQL protocol or
metadata fixture results; they do not qualify an actual MySQL server.

Historical full-scan fixtures use the real SQLite TEXT/BINARY key representation.
The source migration regression now proves that a physically closed reader's
still-live recovery receipt blocks a schema addition; after that exact receipt
expires, the addition rotates the source epoch while retaining policy, clock and
bootstrap allowance. The MySQL orchestration fixture checks its actual bounded
primary-epoch query. Expected read/admission refusals are observed separately
from successful physical destruction; no cleanup failure is silently accepted.

Current Linux ARM64 compilation and the original standalone runtime contract pass
with the unchanged address-space, SQLite heap and descriptor ceilings. The Mac
candidate compiles but refuses admission under those original ceilings; that
failed sample remains separate and does not qualify the Mac platform.

The native storage component run exposed an incorrect assumption that SQLite's
SQL authorizer covers incremental BLOB opening. Every owned incremental opening
now uses an explicit forward-only comparison/retired-process guard. The original
semantic mutation refusal remains required, and an additional read-handle case
checks the exact preserved bytes and physical close. The repaired Linux ARM64
candidate passes the original runtime, WAL/DELETE, profile, private-stage, range
and committed-writer recovery contracts, with all synthetic fixtures drained.
Its fixed component byte count and digest now bind that exact qualified native
component. Build receipts never populate this registry at runtime. Current full
native provider, platform and system qualification remains pending; this component
binding grants no profile activation or production admission.

Source Jest now delivers the three ordinary compiled physical Argon2 worker and
utility siblings through an owned setup/teardown lifecycle. It refuses foreign
existing files, substituted build inputs, changed content and replaced inodes;
cleanup removes only its unchanged original assets. Production worker loading
and original cases remain unchanged. Five independent filesystem cases pass.

Actual native provider startup exposed Knex's non-writable `destroy` method.
The enrolled root now replaces its configurable value while retaining the
original property contract and awaited cleanup. Legacy catalog validation reads
every complete trigger/view separately in the same retained transaction, avoiding
an oversized aggregate reply. Native destination DDL, additive source indexes and
source identity reads use the existing fresh producer-membership check alongside
their original transaction, schema and lifetime checks.

Native migration diagnostics reached the unchanged 336-page physical cap with no
free pages while installing journal quota triggers. SQLite trigger bodies now
compute their original OLD/NEW byte charges once per atomic update, avoiding
repeated stored expressions. MySQL bodies, byte/row ceilings, conflict behavior,
counter consistency and mandatory refusal remain unchanged. Independent actual
SQLite tests prove UTF8 charges, conflict updates, shrinking, deletion, exhaustion
and counter underflow. The combined ownership/schema/journal regression run
passes all 55 cases in five suites, including a late foreign catalog reference.

Full native provider and hosted ARM64 delivery remain under qualification. Earlier
failures and diagnostic-only runs retain their original status; these local
component positives do not close any of the eleven system acceptance rows.

Native quota triggers now use pure row-charge and next-byte arithmetic functions.
They retain the original UTF8/BLOB charge, fixed byte/row ceilings, change-bit
checks, counter underflow refusal and atomic SQL update. Independent original-SQL
vectors include exact boundaries and signed64 corruption. The exact Linux ARM64
candidate passes the original runtime and all six native component contracts,
including 206 private-stage checks. This binds only that component's bytes.

Generation retirement releases obsolete definition records only after verifying
the complete surviving inventory and dropping the corresponding empty table in
the same transaction. The persisted array format remains unchanged, including
resume from a finished generation holding the historical full record. A separate
regression checks every committed page, damaged ownership records and repeat
completion. The current combined regression passes 56 cases in five suites.

The unpublished genuine native generation uses the explicitly versioned
`brc38-native-sqlite-source/v1:` SHA256 binding of its complete UTF8 source JSON.
The complete freshly observed inventory remains in the plan and is compared
before and after each addition; the binding never substitutes for those checks.
A historical native full record is accepted only when it equals that complete
fresh plan, then upgraded under the existing writer and exact previous-value
condition. Ordinary SQLite retains its full JSON record.

Fresh genuine native snapshot generations use a single primary-key B-tree for
their eighteen derived tables. Existing generations retain their exact historical
layout; a partial/mixed layout refuses complete definition validation. No
operational table or incremental-BLOB chunk loses its physical rowid. Migration
now reaches text guards, but the full 18-case provider run still fails before
callbacks. A read-only diagnostic records 324 of the unchanged 336 pages before
remaining text guards, with 208741 bytes of SQL, 102 tables, 148 indexes and 228
triggers. The earlier diagnostic that queried generation metadata before its
table existed is invalid and provides no qualification evidence.

Fresh local baseline journal/v3 shares the original advance/observe SQL through a
rowless view and its insert trigger. Every original operational/pointer observer
still emits its actual physical coordinates. The native authorizer compares the
complete current observer SQL, name and parent table before allowing an event;
direct submissions and changed observers refuse. No mutable SQL function or
saved authority is introduced. Existing journal/v2 definitions remain readable
without automatic conversion. The new driver passes the original runtime and all
six component contracts, now including 215 private-stage checks. Independent
component checks cover canonical insert/key-move/delete coordinates, direct and
counterfeit refusal, and source/event rollback. They do not qualify the complete
observer semantics or wallet. The 19-case source cohort includes an additional
shared-observer fixture; its full run remains pending schema fit. Packed schema
fit, full provider behavior and reproducible hosted delivery remain implementation
work, before complete system qualification.

Fresh packed binary/TEXT metadata now uses one primary B-tree for each versions,
fields and garbage table; prepared-field metadata does the same. Chunk tables
keep their physical rowids. The actual complete version/prepared table SQL
selects compact or historical schema DATA on each read, followed by complete
object and implicit-index validation. Empty local expansion preserves that
selected shape. Equivalent per-source marker predicates share INSERT/update-of
guards; per-field NULL clearing and row/key/pointer/quota/lifetime guards remain
separate. Existing occupied layouts are not rewritten. The new 20-case cohort
adds independent metadata geometry, marker-boundary and mixed-layout rollback
checks. Diagnostic25 preserves every source input and drains all fixtures, but
all20 cases still fail before callbacks: creating the projected structured
chunk table exhausts the original limit. Immediately before that table, the
actual database has335/336 pages, no free pages,240317 bytes of SQL,105 tables,
146 indexes and302 triggers. Diagnostic runs grant no qualification credit.
Provider24 is invalid as a whole because two documentation files changed during
its complete source freeze; its failed logs are preserved without rehabilitation.
Full provider and end-to-end qualification remain pending.

A source-owned Linux ARM64 qualification/delivery tool now composes the original
candidate builder, actual compiled static pin and pinned-descriptor launcher.
It retains the original runtime and all six independent component contracts,
including real committed-writer loss and WAL recovery, before exclusive delivery.
It refuses unsupported platform/Node identities, changed sources, changed pins,
skips and existing destinations. Actual tool runs1/2 fail: the runtime preflight
passes, then the WAL/DELETE component rejects observed native RSS above its
unchanged64MiB address bound. Run2 preserves bounded nested diagnostics; the
worker, actual component groups and container drain. Its failed private-root
export did not succeed. The source now streams input digests and isolates build
buffers in a bounded preparation child. Actual run3 passes the runtime and all
six native components, including the original RSS bound and writer recovery,
but delivery refuses the assertion-count comparison. The retained executable
at fd4 consumes one of the original32 descriptor slots: the unchanged synthetic
exhaustion/close loop produces357 assertions instead of358 for pathname launch.
The source now requires exactly357 for this descriptor launch; every fixed
native assertion remains unchanged. Run3's original failed evidence is exported
before worker removal; no delivery qualification is credited. The corrected
receipt comparison passes in actual run4: exact static candidate delivery,
original runtime, all six components, healthy committed41 writer loss and
recovered42/25 assertions, empty fixtures and independently drained component,
preparation and CLI groups. The original isolated worker is removed; source,
frozen inputs and foreign containers remain unchanged. All16 negative cases
pass in a separate actual Linux cohort with0skip. Its first run timed out on
the authored empty-argument parameter row; each argument array is now one Jest
value. Failed runs remain failed evidence. The tests use the unchanged ordinary
Jest catalogue/configuration and deadlines. This is component delivery and
negative-case evidence; it does not qualify the complete provider or hosted
release workflow.
The original worker owner must separately attest
resource controls and freeze inputs; the tool does not establish full provider,
OS-tree, RSS, platform-release or wallet activation qualification. Shared hosted
workflow wiring is still pending BotBoard division and actual hosted provisioning.

## Fresh native membership SQL

Fresh owned-native generations use direct retirement projections and one source
selection for each proof guard. This removes repeated scalar source subqueries
and redundant nested projections without changing comparison predicates,
collations, NULL behavior, trigger events or persisted tables. Standard SQLite
keeps the historical definitions. Existing native generations select their exact
historical or reduced observers from the actual complete transaction UPDATE
trigger; validation still compares every definition and refuses mixed layouts.
Occupied generations are not rewritten. The additive independent-source oracle
covers all thirteen families, replacement, nested ownership, ignored updates,
rollback and proof presence. Current schema size and native execution remain
unqualified until measured on this source.

## Native shared-quota dispatch

Fresh native destinations now author one rowless SQL counter handler and the
original fifty-four source event emitters. Row charges, counters, toggling,
limits and same-writer rollback remain the original predicates. Existing native
destinations keep their exact historical definitions; mixed or unknown objects
refuse. Selection checks the actual guarded-kernel protocol on each call. An old
qualified binary cannot acquire the new dispatch just from newer TypeScript.
The kernel guard freshly compares the complete emitter, parent table, rowless
view and handler definitions on its actual main connection. Its compiled source
vectors are generated reproducibly from the same fixed SQL factories. A
temporary trigger that shadows a canonical emitter name also refuses. Run
`node src/storage/portable/native/generate_shared_quota_sources.cjs --write`
after ordinary core compilation to regenerate the header; the package build
checks it deterministically before copying native source artifacts.

Scoped implementation feedback passes core compilation, declaration consumption,
deterministic header reproduction and 43 ordinary SQLite quota/destination cases.
The fresh Linux ARM64 candidate passes the original runtime contract, all six
original native components and the added 306-check quota dispatch component.
Its exact component bytes are source-pinned only after those independent runs.
The component checks fixed independent UTF8 charges, conflict updates, rollback,
complete-definition drift, temporary name shadows, family refusal, exhaustion,
underflow and missing-counter atomic refusal. It uses the unchanged 4 MiB profile
formula (330 pages); the private-stage provider retains its separate 336-page
formula. Neither formula is changed.

Actual provider schema fit and complete behavior, retained-executable delivery,
mutation instrumentation, physical hosts and end-to-end system validation remain
required. No native ceiling, original case or assertion has been relaxed; this
component evidence does not establish full #544 qualification or release readiness.

The experimental version-2 parent layout was withdrawn after actual provider
feedback exposed its incompatibility with the complete local inventory. All
eighteen reconciliation parents belong to the original forty-seven operational
tables, whose physical-rowid contract remains required. The isolated 328-check
component and 44 ordinary cases did not prove that contract. Fresh destinations
retain the original parent row trees and the version-1 guarded dispatch; no
existing schema is converted.

The private journal migration now binds its callback to the freshly asserted
original owned root. Knex's nontransactional migrator supplies a cloned facade;
that facade grants no authority. The callback retains its exact root check,
name, ledger and config. A closed owner refuses before the callback executes.
Actual provider feedback now reaches the original callbacks, but all twenty
cases still fail across local layout, physical-rowid, bounded schema reads,
packed/derived field lifetime and later candidate-journal capacity. The row-tree
correction and those remaining defects require fresh feedback. Existing ordinary
migration regression cases also exposed five journal failures; they remain open.
The correction passes all 44 quota/destination semantic cases, including the
complete eighteen-parent rowid check. The private migration suite passes its new
actual-root/closed-owner case and two original cases, but five original journal
cases still fail. The regenerated native header and all eighteen build inputs
match the earlier independently qualified version-1 candidate exactly. Its static
pin is restored from that verified evidence; the failed version-2 provider and
component receipts are retained. Full implementation and qualification remain
incomplete.

The fresh local packed installer admits the exact unused prepared-proof seed
created by the wallet migration: one integer metadata ID of 1 and proof epoch 0. Changed, extra or missing proof metadata remains a refusal, and the original
physical rowid is retained. Seed refusal cases use the actual private writer
with rollback before admitting the original state.

Native journal schema observation reads each complete definition through
16 KiB binary chunks in one retained transaction. The native IPC frame and
decoded-result budgets remain unchanged. Reconstruction preserves SQL bytes,
literal whitespace, UTF-8 and null SQL for implicit indexes; ordering, the
512-object limit, 64 KiB definition limit and 1 MiB source JSON limit remain.
Root reads obtain a transaction so schema positions and chunks cannot cross
views. Ordinary SQLite retains its existing schema query. Additive semantic
and genuine-provider cases accompany these changes; fresh native capacity,
lifetime, complete behavior and end-to-end qualification are still required.

Fresh genuine native membership generations share each numeric table's complete
maintenance body through one rowless event view. Existing historical and
reduced observers retain their exact definitions; ordinary SQLite keeps its
original layout. The original BEFORE conflict witnesses and AFTER statement
order remain, with event-specific retirement and unchanged unique collations,
NULL comparisons and live-row refresh. Every helper definition and its complete
reserved/attached inventory is checked, so an extra handler cannot hide behind
matching expected SQL. Data erasure validates the layout before dropping its
dependent triggers and views. This reduces duplicated schema SQL without
removing required row trees or indexes, increasing budgets, or converting an
occupied generation. Independent source-oracle cases cover replacements,
nested ownership, rollback, quoted columns and all three supported collations;
genuine native capacity and complete program qualification remain required.

Fresh owned native candidates now reuse six existing source indexes with identical key order for the seventeen logical import query identities: transaction IDs, request IDs, user/transaction IDs, reclaim IDs, transaction labels and output tags. The installer checks each complete source definition, uniqueness, origin, partial predicate, key order, ascending direction and BINARY collation in the retained transaction, and refuses temporary shadows, missing or altered source indexes, partial named layouts and foreign reserved objects. Fresh candidates create eleven named import indexes; historical complete seventeen-index layouts retain all their trees. Every query caller supplies its actual retained database when choosing the index address. Ordinary SQLite and MySQL keep the original seventeen definitions and names. These addresses do not replace whole-source binding, producer membership, primary fences, quota, expiry or receipt checks. Independent ordinary property cases retain 300 runs and seed/replay/deadline controls; a separate genuine native case checks plans, rollback and damaged layouts. Native capacity and the full acceptance program still require current physical execution.

Fresh genuine native source journals now keep the derived physical/scope metadata directly in their composite primary trees and share the exact revision-clock update through one rowless event view and handler. Each observer advances at its original statement position after the original key guards; physical and membership writes retain their predicates, revision values and order. Existing exact legacy journal anchors select the original rowid tables and original observer SQL. Mixed or altered anchors and temporary shadows refuse selection. Complete generation validation includes foreign named handlers attached to journal tables/views, and validated data erasure drops the handler and view before the tables. Ordinary SQL engines keep their historical production layout. Paired independent ordinary SQLite engines exercise authored SQL semantics across all thirteen streams, ownership changes, indexed primary-key plans, rollback, invalid events and clock exhaustion; that test does not grant native admission. A separate genuine after-journal case requires complete installation and checks compact trees and attached-handler refusal. Full native capacity and operational qualification remain pending current execution.

Fresh native candidates also reuse seven independently inspected unique point indexes for baskets, tags, labels, outputs, transaction references, certificate fields and commissions. Reordered equality keys remain complete point lookups; globally unique reference/parent keys bound lookup before the unchanged userId residual. Actual same-transaction source SQL, uniqueness, key order, ascending BINARY collation, nonpartial origin and NOT NULL key columns are required. All callers retain every logical key and owner check. Four named indexes remain in a fresh candidate. Exact previous eleven-index and historical seventeen-index layouts retain their full inventories; partial layouts fail. Ordinary production layouts and all operational/raw-private rowids stay unchanged. Genuine native cases require actual indexed plans and damaged-layout refusal; an independent ordinary property fixture checks equality and ownership semantics without granting native admission. Full native capacity and system completion remain unqualified until current physical execution.

Fresh genuine native source journals now share the repeated key-guard, scope-upsert and physical-upsert SQL through three rowless views and exact handlers. Thin observers evaluate the original predicates and pass the original revision, generation, presence and key values at the original statement positions. Physical generation replacement uses the original fresh-key Boolean; packed pointer replacement retains the prior generation. Clock advancement remains at its original position after all key guards. These SQL values are data, not producer, source, ownership, receipt or generation authority. Original rowid generations and the previous compact clock-only generations select their complete original plans; only a fresh native installation chooses the new family. Existing complete helper definitions are observed in the current transaction, and partial/altered/shadowed/foreign-attached families fail validation. All operational/raw-private rowids and all indexed queries remain. Independent paired SQL traces and actual native cases remain required before capacity or complete program qualification.

The fresh journal family also shares complete membership, main-row and packed-pointer events through three rowless helpers. Each source observer retains its original AFTER timing and full UPDATE-change predicate. The main-row handler checks current keys, then old keys for UPDATE, advances the clock once, writes the old physical key before the current key and finally reads current source membership. Every main-row branch retains the indexed equality and exact byte residual; the helper carries actual cells and adds no stored event rows or B-tree roots. Pointer observers retain their actual-source existence predicate and original point reads, record presence without replacing physical generation, and cannot revive a tombstone after its source is gone. Certificate-field pointers retain actual physical rowid lookup and exact membership text comparison. Signed sync-state IDs and optional global ownership checks retain their original meanings. Exact original, clock-only and effects-only generations keep their prior definitions. The new helper family is validated from complete current definitions, including its longer bounded source handler. Independent paired SQL traces use ordinary event-input tables without modeling native payload/quota/lifetime storage or granting native admission; complete genuine native capacity and lifetime cases remain required.

The fresh genuine native generation additionally shares the original BEFORE
conflict-witness statements through phase-specific rowless identity handlers
and shares each composite AFTER event body. It retains the exact existing
original, reduced and earlier shared observer generations. The new phase is
carried with actual source cells at the original BEFORE/AFTER positions; SQL
unique comparison, NULL semantics, column affinity and retirement/merge order
remain in the original witness tables. All ten identity tables and operational
physical rowids remain. The independent ordinary SQL source oracle executes
both shared families with its original 300-run collation/conflict schedules;
this is implementation feedback and does not establish native resource fit.

Fresh genuine native journal generations share current numeric/relation key and
owner reads through a non-materialized source view. This reads the actual source
rows and stores no verdict or payload. Full equality and exact BLOB residuals
remain; certificate-field point reads retain the source's own collation and
compound index. Numeric packed-pointer reads share the same current projection.
Complete original, clock-only, shared-effect and shared-event occupied families
retain their exact definitions. Original guards, clock positions, physical old/
current writes and membership ordering remain. Independent all-stream traces
and source query-plan checks are implementation feedback; native resource fit
and the full program still require qualification.

## Native exact cell-change predicates

The current source adds a data-only paired `brc38_cells_changed` function and
`brc38-cell-change/v1` protocol. It uses SQLite's own BLOB conversion, preserves
NULL versus empty values and the original ordered short circuit, and returns
allocation errors rather than equality. It retains the original function argument
limit; definitions over 500 distinct columns use the original SQL predicate.
Fresh genuine native index and journal generations select shorter predicates
only after current function inventory and protocol observation. Occupied layouts
select from their complete UPDATE definition and retain their original SQL;
complete generation validation rejects mixed, altered or shadowed objects.
No source, ownership, profile, primary, revision or lifetime verdict is cached.

An additive native contract compares a complete typed cross product and paired
column sequences against independently authored CAST-AS-BLOB SQL. It also checks
NULL, empty, NUL, UTF8, integer64, REAL, argument bounds, allocation failure,
trigger behavior and savepoint rollback under the original resource ceilings.
The original six components and 306 shared-quota checks remain unchanged. The
candidate builder and artifact preparation include the added contract source.
The new Linux ARM64 candidate passes the original runtime, all six original
components, all 306 quota checks and 1,152 independent cell comparisons, including
argument bounds, allocation-pressure refusal and rollback. Its exact bytes are
manually source-pinned after those independent runs. This component evidence
does not qualify the provider or system. Native schema fit, complete provider
behavior and all full-system acceptance requirements remain open.

Current scoped feedback passes core assembly, declaration consumption, source
artifact copying, formatting, lint and all 154 ordinary SQLite cases in seven
suites. Actual native provider58 and read-only diagnostic59 still fail all 25
cases with no skips. The first diagnostic baseline has 323 pages, no free pages,
206,387 SQL bytes, 248 roots and 621 objects: 2,298 fewer SQL bytes than source229,
but no page reduction. Before the 4,713-byte source handler, it has 336 pages,
no free pages, 212,973 SQL bytes, 259 roots and 644 objects. The actual failure
remains SQLITE_FULL13 followed by original rollback-ownership refusal1. Other
cases also report allocation, packed-field and later candidate failures; this
sample does not establish a common cause for every failed case.

The journal UPDATE predicates follow that handler in installation order, so
their shorter source cannot solve this earlier failure. Further baseline root
reduction is still required for both the 336-page private stage and default
330-page profile. A read-only audit identifies the ten derived conflict-witness
tables as an area to investigate. Any replacement must independently preserve
source affinity, unique collations, NULL conflicts, nested ownership, indexes,
original statement order and occupied layouts. No witness replacement or quota
increase has been adopted.

## Shared derived conflict witnesses

The current source implements one fresh native witness table tagged by the ten
original numeric source families. Each source retains its key and owner; global
families use an explicit zero owner. Non-key slots share storage only when their
declared type matches, preserving original affinity. Unique lookup indexes retain
the original per-column collations with a leading source tag. BEFORE capture,
nested owner retention, AFTER retirement and live-source UPSERT keep their original
order. There is no retained semantic verdict or authority record in this table.

Identical physical index shapes share one tagged tree only when the mapped
columns, their order and every collation match exactly. Each original unique
conflict retains a named actual indexed lookup; original operational indexes are
unchanged. Distinct declared type slots are not combined by this optimization.

Fresh selection requires current genuine native identity, the actual cell-change
protocol and complete matching table/index/observer definitions. Existing occupied
families retain their original tables and observers. Reserved and attached-object
inventory rejects mixed families, altered definitions and foreign witness handlers;
temporary shadows refuse. Oversized shapes retain the original layout instead of
changing the existing SQLite column or SQL-size limits. All 47 operational and
18 raw-private rowid contracts remain unchanged.

The ordinary all-family source oracle gains an additive shared-witness family,
including original 300-case conflict schedules, NULL/quoted fields, replacements,
nested ownership, proof guards and rollback. A separate geometry case checks the
single key tree, source separation and indexed unique lookups. The existing additive
native journal case checks the actual tree and foreign-handler refusal. Original
20 native bodies/assertions/deadlines and the other four additive cases remain.
Current assembly/declaration/quota reproduction/artifact copy, source lint and
all 162 ordinary cases across seven complete suites pass. Actual native feedback
62 and diagnostic 63 both run all 25 cases: eight pass, 17 fail and none skip.
The complete journal/shared-witness/attached-inventory case now passes; the first
observed native baseline is 310 pages, zero free pages, 202868 SQL bytes, 236 roots
and 609 objects, down from source 230's 323 pages/248 roots. The last journal
trigger is reached at 334 pages/244819 SQL bytes/247 roots/709 objects. The
diagnostic's first refusal is the expected missing physical rowid negative case,
not a failed installation. All current worker groups and containers/fixtures
drain, frozen inputs and the qualified C candidate remain exact, and original
20 native bodies plus the other four additive cases remain byte-preserved.

This proves progress within the private 336-page fixture, not complete native
fit or default 330-page readiness. The 17 failing local-layout, packed/lifetime,
revision/capacity/epoch/signed64 and candidate/cursor cases still require warranted
implementation repairs; their failures are not assumed to share one cause. The
previous private-migration and full-test typing failures, mutation registration
and shared provisioning, all 11 end-to-end/platform/security/performance/CI/review
acceptance rows and full production readiness remain open. The authorized 30%
browser budget increase will be reviewed after goal achievement.

## Native content deadlines and foreign-key restoration

The last nontransactional journal migration now enables and observes actual
foreign-key enforcement before its runtime callback. Earlier DDL migrations
retain their required order with enforcement disabled; final cleanup restores
it again and preserves the primary failure if restoration also fails. Packed
content collection keeps its original cascade and complete-garbage checks.

Content actors accept a finite earlier deadline bounded by the unchanged
operation expiry. Each actor captures that deadline and its monotonic bound;
all source, writer, resource and final admission checks remain. Lifetime owners
retain the captured deadline in a private field and cannot renew it through a
caller-visible property or a later policy. Request and generation expiry rules
remain unchanged. One additive native case checks actual foreign-key enforcement,
invalid and beyond-operation bounds, attempted renewal, owner mismatch and closed
actors with complete resource release. All previous 25 native contract bodies,
assertions and deadlines remain unchanged. These changes await scoped feedback
and full-system qualification; no completion claim follows from implementation.

Packed binary and TEXT schema checks now compare every exact name/type/SQL
inside SQLite in bounded batches of at most eight definitions and 8KiB of
bindings, with a single longer original definition retaining its individual
query. They return only scalar counts. Current transaction checks, complete
family counts, preparation variants, actual layout selection and original
implicit primary-index checks remain. No schema or admission verdict is retained
between calls. The new deadline negative case uses the fixture's original
64KiB working ceiling; the original derived-byte case still requests its own
8MiB ceiling and remains an unresolved resource-policy mismatch.

The initial 26-case native feedback reached nine passes and 17 failures, including
the multipart case's original 30s timeout; the supervisor stopped it and retained
no qualification credit. Foreign-key enforcement corrected the prepared-lifetime
case's missing cascade. Disk fit, original named derived tables, the remaining
allocation mismatch and all complete system gates still require implementation.

Current feedback 65 runs all 26 native contracts within the original bounds:
10 pass, 16 fail and none skip. The new deadline/FK case and original prepared
lifetime case pass. Multipart completes its case in 12.678 seconds rather than
exceeding 30 seconds, but still fails during the remaining migration/layout path;
it is not qualified. The complete worker finishes in 79.410 seconds and drains
its process group and fixtures; its owned container is removed, all frozen source,
emitted, native dependencies and candidate bytes remain unchanged. All 162 ordinary
cases in seven suites, current source build/declarations, formatting and lint pass.

The original derived-index contract still requires the ten named physical witness
tables that the new shared layout removes. This conflict must be resolved in the
implementation while preserving that contract; the newer geometry case does not
waive it. Other cases reach SQLITE_FULL in local-baseline rows or journal scope,
while some retain an earlier rollback failure plus final FK restoration failure.
The original derived-byte case requests an 8MiB working ceiling from a 64KiB
admitted fixture and is correctly refused by the unchanged allocation bound;
that mismatch remains unresolved. These different failures are tracked separately.
All previous 25 native bodies/assertions/deadlines are still byte-preserved.
Default330/private336 fit, the earlier migration/full-test typing failures,
mutation registration/provisioning and all 11 full-system acceptance rows remain
open. The goal is active; implementation is incomplete and hosted CI is deferred.

### Held569 fresh local observer layout, 2026-10-09

Fresh local baseline v3 metadata now clusters its derived `(tableId,rowId)` primary key in one WITHOUT ROWID tree. All 47 operational source tables retain their physical rowids; the original three local revision/tombstone range indexes remain. Fresh canonical source and packed-pointer observers use positional event inserts. The complete occupied v2 and original v3 definitions remain independently selectable from the current actual clock and row-table SQL; partial or mixed families are refused rather than adopted. This is a fresh-layout change, not an in-place conversion of occupied roots.

The kernel accepts only the complete exact old or new canonical emitter SQL, on its original source table and actual family-zero writer, with a fresh same-name TEMP-shadow exclusion. The new independent local-observer component supplements all original native component bodies and their unchanged resource bounds. The additive wallet case checks the single derived primary tree, original range indexes and operational rowid, and mixed-emitter refusal followed by actual savepoint restoration. Existing 26 case bodies, assertions and deadlines remain unchanged. Actual LinuxARM build10 and all nine components11 pass, including 93 independent local-observer checks; the original six components, 306 quota checks and 1152 cell checks remain. The exact 1,353,240-byte candidate SHA256 `78bfc71e7f257df1cfb888a95230af7ae907c5177de7e5cb74b0c8b5a8878cf8` is manually pinned after qualification, with all worker groups and fixtures drained. Complete wallet runtime qualification remains pending; this source change does not establish full #544 completion or production admission. The original named physical witness-table contract and allocation-policy mismatch remain open.

Actual complete provider67 runs all 27 cases with the original deadlines and no skips: 10 pass, 17 fail, 110.503 worker seconds. All original 26 bodies/assertions/deadlines remain byte-exact. The additive physical-layout oracle was corrected after66: SQLite resolves the declared `rowId` as `rowid`, so querying that spelling is not a hidden-tree test. Actual `table_list`/`index_list`/exact schema assertions now run and the subsequent full journal still fails at `snapshot_journal_physical_page`. The independent current-view geometry is310→331of336pages,236→241roots and202868→244910DDLbytes, with zero free pages. Local compaction alone does not make the combined program fit. All fixtures/process groups drained, the owned container was removed and frozen source/C bytes remain exact. The original named physical witness-table contract, content allocation mismatch, migration/rollback/candidate failures and full program qualification remain unresolved. No hosted CI, application push, merge, publication or deployment occurred.

### Native derived import metadata and physical witnesses (2026-10-09)

Fresh genuinely owned native roots now cluster the two derived import journal/mapping tables and the three provenance budget tables into their primary trees. Each occupied family retains its complete original rowid layout; every current table, implicit index and trigger is compared against the selected complete source family. Partial, mixed, foreign or temporary-shadowed families are refused before installation can reuse them. Standard SQLite creation retains the original rowid layouts. Original provenance JSON tables remain physical rowid tables because the native incremental BLOB reader uses those coordinates. No persisted backend label selects a schema or grants transaction authority.

Fresh native index generations again create the original ten named physical witness tables. Occupied shared-witness generations remain readable under their exact original definitions. Both native witness layouts now reject temporary identity shadows. This restores a required physical contract; equivalent rows in a shared table alone do not satisfy that contract.

Source assembly, generated quota reproduction, fixed native-artifact copying, declaration consumption and source lint pass. A bounded diagnostic on the actual private Linux native fixture independently reads all 243 table/index roots, confirms the five compact metadata layouts, three raw provenance layouts and ten named witness layouts, and ends before journal installation. The candidate at that point uses 318/336 pages, zero free pages and 206457 bytes of schema SQL. Relative to the previous 310-page/236-root candidate, five duplicate metadata roots disappear; restoring the physical witnesses adds their required roots, producing a net seven-root increase. The combined layout still needs further implementation before the complete local and snapshot journals can fit.

This diagnostic has no full qualification credit. The previous complete native run belongs to source233 (10 pass,17 fail,zero skipped); source234 has not run that full cohort. The original 27 native test bodies/assertions/deadlines, property seeds/replays/minimum300 runs, original native component bodies and fixed native resource limits remain unchanged. All11 acceptance rows remain open, and mutation registration, migration/type repairs and the end-to-end acceptance graph remain pending. Held569 stays open/draft/unmerged with auto-merge off; application pushes and hosted CI remain deferred until implementation and required local gates are complete. The authorized six browser budget increases remain at30percent and must be reviewed only after the full goal is achieved.

### Fresh native target index compaction (2026-10-09)

The streamed private native restore path now registers a transactionally bounded migration before the SQLite source generation is sealed. It retires seven redundant nonunique index trees on proven transaction requests, commissions, sync-state reference numbers, action-batch reservations/blobs, and output-tag/transaction-label maps. The retained unique/primary/compound indexes provide the exact original key prefix, direction and BINARY collation. Source query consumers do not force the retired names. Actual retained-prefix EXPLAIN plans establish indexed searches; no parallelism or runtime speedup claim follows from those plans.

The migration requires the genuine current private native writer, empty affected tables, no generation/journal/restore publication, no temporary shadows, exact old and retained index SQL, complete index kind/keys/collations and real operational rowids. It validates every family before any DROP and owns an atomic savepoint through the seven removals. An occupied or partial family is refused. All original table definitions, foreign keys, uniqueness constraints and physical rowids remain, and no compatibility objects or persisted admission/schema verdicts are installed. Ordinary Knex migrations and existing/retired/published profile paths remain unchanged. This is fresh private construction, not an upgrade of an occupied profile.

A bounded pre-change native diagnostic independently observed all seven exact prefix matches and retained indexed search plans. A separate post-change diagnostic on the real fresh private fixture confirms all seven retired trees absent, all five compact import metadata layouts, three raw provenance layouts and ten original named physical witness tables. The complete root inventory changes from243 to236, and the pre-local/pre-journal candidate changes from318 to311of336pages, with zero free pages and205882bytes of schema SQL. Source assembly, quota reproduction, native artifact copying, declaration consumption and lint pass. All previous27 whole native cases/assertions/deadlines, property controls and C component bodies remain byte-preserved; one additive28th30-second case checks retained queries/rowids and refusal of occupied reinstallation.

The full source235 native cohort has not run. The diagnostics stop before complete journal construction and earn no full qualification credit. Combined default330/private336 storage fit, allocation/content/rollback/candidate behavior, migration/type/mutation work and every end-to-end/platform/performance/security/CI/review acceptance row remain pending. All11 rows remain open. The six authorized browser ceilings remain30percent higher, with review only after the full goal is achieved. Held569 remains open/draft/unmerged with no auto-merge, app push or hosted CI until the implementation and required local gates are complete.

Fresh private packed schemas now select an additive literal-marker guard family.
Zero-byte BLOB markers compare with `IS X''`; zero-byte TEXT markers compare
with `COLLATE BINARY IS ''`, preserving storage classes, embedded NUL bytes,
NULL handling and source NOCASE/RTRIM behavior. The original writer errors,
field clearing, quotas, statement order, table definitions, raw rowids and
physical witness tables remain unchanged. Every call observes the actual
version table and source guard, then validates the complete chosen family;
occupied original rowid and compact families retain their exact old guards.
Mixed, missing or modified definitions refuse adoption. Local packed expansion
retains the selected family. This reduces repeated predicate SQL without a new
native function, source rewrite, cached verdict or larger resource allowance.
An additive native case compares synthetic SQLite values under three collations
and checks complete occupied-family selection, tamper refusal and rollback.
Full feature completion and end-to-end qualification remain open.

The earlier additive complete-journal contract still asserted a shared witness
table for a fresh fixture, contradicting the source234 restoration of the ten
original physical witnesses and the original derived-index contract. Its oracle
now checks an independently fixed exact inventory of all ten named tables and
each real WITHOUT ROWID tree. Its foreign attached-handler refusal probe targets
the actual transactions witness. Every remaining assertion and its original
30-second deadline remain intact; occupied historical shared-witness support
is unchanged. This is an oracle correction, with no skipped case or weaker gate.

Fresh native snapshot journals now select an additive positional event family.
Each rowless helper retains its complete fixed column order, no defaults, and
its existing effects. The fresh membership handler now uses the source
contract’s safe signed range for sync-state table7 IDs; other tables retain
the positive range. The historical handler incorrectly disabled the journal
on a negative sync-state membership despite the source handler accepting it.
Source emitters insert exactly the same cells
at the original statement positions while omitting repeated column lists.
Ordinary SQLite and all five complete occupied native layouts retain their
original definitions. Fresh complete helper and emitter inspection refuses
mixed, altered, missing or temporary-shadowed families; no schema observation
is cached as authority. Physical tables, rowids, witness trees, quotas, resource
limits and native kernel bytes remain unchanged.

An additive 30-second native case checks actual view column orders/defaults,
source insertion, positive and signed key movement, deletion and rollback. It independently
expects both physical tombstones and scope tombstones, compares exact revision
and generation effects for positive IDs with the complete occupied historical
family, proves signed-ID tombstones with the fresh handler, rejects a
mixed positional emitter, and verifies full rollback to the fresh family.
All 29 earlier whole case bodies and deadlines remain unchanged. The initial additive fixture omitted required activeStorage and then exposed
the signed membership guard mismatch. Both failed results remain recorded.
The repaired additive case passes on the original qualified Linux provider,
including both signed-key tombstones and exact historical positive-key effects.
Current assembly, declarations, lint and formatting pass. Snapshot-journal-only
storage is333of336pages,247roots and239114bytes of schema SQL, saving one page
and4430SQLbytes. The unchanged original combined local-observer case still
fails SQLITE_FULL creating snapshot_journal_physical_page after the local
layout reaches331pages. The full current30-case cohort has not run; all11
acceptance rows remain open. No app push or hosted CI occurred. The authorized
six browser ceilings remain30percent higher and are reviewed after the full
goal is achieved.

The current implementation repairs native destination optional-trigger selection.
After complete actual packed-family verification in the retained transaction,
destination verification selects the same legacy, compact or literal-marker
family as the packed verifier, including its local-layout and prepared guards.
It no longer synthesizes legacy trigger bodies for a current compact family.
The shared quota handlers retain their original exact definitions. No persisted
schema, source row, acceptance budget or native kernel is changed. A new additive
31st native case checks genuine literal and occupied compact families, exact
stage/provenance payload guards, complete destination verification, missing-guard
refusal and actual rollback. The actual Linux ARM provider executes this additive case successfully with
the original 30-second deadline and physical process/container/fixture drains.
All previous 30 whole cases and original deadlines remain preserved. The full
31-case cohort and whole-system qualification remain pending. Core emission,
source-asset reproduction/copy, declaration consumption and lint pass. A first
compiler feedback run retained a missing local-variable error; that extraction
was withdrawn and the original packed verifier body restored byte-for-byte.
The new complete-family selector serves destination extras without changing
existing absent-family or primary-index admission behavior.

Two shared test-fixture typing repairs reduce complete src/test/benchmarks
compiler diagnostics from 445 in 97 files to 359 in 96 files. Both affected
fixtures emit byte-for-byte identical JavaScript; all runtime values and test
assertions are preserved. No diagnostic suppressions or exclusions were added.
The complete test-source compiler still fails and is not a passing gate. Cold
native geometry remains 310 of 336 pages with 236 roots; the combined local
baseline/journal capacity failure remains unresolved. All eleven acceptance
rows are open. No application push or hosted CI has started.

The source-only fixture completion batch supplies the actual fixture identityKey
to storage authentication arguments, selects and validates the existing benchmark
user identity, and completes nine chain-tracker fixtures with a finite synthetic
currentHeight. Telemetry event collectors retain their original appended values
and order while explicitly returning void. The fragmented-input benchmark uses
the actual serialized script length and the existing excludeSending=false behavior.
Original test registrations, assertions, environment gating, deadlines and
performance thresholds remain unchanged. Full test-source compiler feedback is
pending for this batch; these repairs do not establish whole-system qualification.

A read-only audit rejected the proposed clustering of sixteen destination
metadata tables: every candidate belongs to the original forty-seven-table
physical-rowid recovery inventory. The schema remains unchanged. Combined native
local-baseline/journal capacity still needs an admissible implementation fix under
the original limits. The six authorized browser ceilings stay thirty percent
higher, with mandatory reconsideration after the full goal is achieved.

The next fixture batch completes fourteen additional full ChainTracker mocks,
leaving deliberately minimal root-verdict inputs unchanged. Three console-spy
assignments now use their declared variable. No production API, schema, dependency
or SDK changed. Shared-registry coordination has acknowledgement of receipt and
conditional metadata preparation only; both feature graphs must be complete and
exact source inputs freshly agreed before integration. No SDK/runtime adoption or
qualification transfer is authorized by that acknowledgement.

Current complete src/test/benchmarks compiler feedback improves from359errors
in96files to291in88 and then275in81, removing84diagnostics in this fixture
batch. The compiler still fails. Current core emission, source assets and
declaration consumption pass, as do zero-warning wallet lint and formatting.
AST checks preserve registrations, matcher expectations and deadlines in all
twenty-three repaired fixture files; the complete31-case native file and71
original property/native-C controls remain unchanged. No application/test/native
runtime ran in this batch and no full-system qualification credit is claimed.
Combined native capacity, remaining test/API graph, allocation/content/rollback,
migration/platform/performance and exact-head gates remain unfinished; all
eleven acceptance rows stay open. No application push or hosted CI occurred.

The source-only fixture graph now uses the actual callable contracts for monitor
trigger and bulk-download helpers, instead of incompatible Jest mock argument
tuples. The reorg fixture states its Promise<void> return contract while retaining
its original synchronous throw and asynchronous replacements. One numeric-array
fixture states its element type. Fetch mock generics now use actual return and
argument types, and the existing installed fetch spy is injected through its
actual global callable. Production APIs and all original assertions remain intact.
Compiler feedback for this batch is pending.

Current issue544 and542 remain open;543 is closed upstream. Closure does not
replace the required basket-remapping and repair regressions on this held branch.
The current legacy copy loops call throwSyncResultError before budget/checkpoint
progress, and EntityOutput uses mappedBasketId; these are static implementation
observations, with full current fault/relationship qualification still required.

### Native first-failure provenance through fenced cleanup

The native transport retains one immutable first-fenced-failure data record for each of its four connection slots. Original statement error code, bounded message (512 characters), autocommit observation and reply rollback/release codes remain available as the standard non-enumerable `Error.cause` on subsequent fenced errors, even when Knex replaces the original rejection during migration cleanup. This data contains no SQL, bindings, stacks or nested error chains, and grants no admission, recovery or authority. Actual error codes/messages, physical fences, deadlines and kernel resource limits remain unchanged. A synthetic native rollback-trigger case exercises the original statement, migration rollback, foreign-key restoration and physical fixture drain. The additive32nd case passed on the original pinned Linux native provider: the same frozen SQLITE_CONSTRAINT_TRIGGER1811 receipt survived both SQLITE_ABORT4 cleanup errors, with actual fixture/process/container drain. A separately selected original fresh-local-layout case still failed; its preserved first error is SQLITE_FULL13 with autocommit=true and reply rollbackCode=1/releaseCode=0. This confirms capacity failure for that case without attributing other failures to it. All31 original whole cases remain intact, and the full32-case cohort and system qualification have not run.

Storage update fixtures enumerate their own closed table literals using the corresponding key/value union. Date keys retain their actual created_at/updated_at contract, and structured JSON and Buffer comparisons check the actual returned value shape before using it. The per-field updater accepts an object for Object.entries rather than requiring a string index signature on each schema interface. Existing fixtures, registrations, matcher expectations and deadlines remain. These strict source corrections require fresh compiler feedback and eventual full storage regression qualification; source compilation is not runtime proof.

### Permission callback declaration completion

The event-keyed `bindCallback` overload infers the existing single, grouped or counterparty request type from the selected event. The original broad event/handler-union signature remains available, including its parameter extraction shape, and the registration/dispatch implementation is unchanged. A declaration consumer checks all six events, rejects accidental inferred `any` with a type predicate and preserves dynamic-event/legacy handler-union assignment. This is an additive declaration correction; no callback runtime, permission authority or persistence behavior changes. Fresh source/declaration feedback is required before qualification, and the full program remains incomplete.

Permission module fixtures inspect object-valued arguments as unknown and retain the original field assertions and transform order. Boundary token fixtures supply the existing explicit expiry0 never-expire value, while private collector spies verify the actual token array before adding their original fixtures. No production permissions-module input widening, authority change, suppression or removed assertion is introduced. Full fixture runtime regressions remain required.

### Current source and native capacity evidence

The event-specific callback overload and declaration consumer passed core/declaration assembly and removed29 full-source diagnostics; two permission fixture corrections removed21 more. Complete src/test/benchmarks compiler errors decreased195→166→145 across68files, and still require resolution without exclusions or suppressions. The first full-source controller refused an accidentally substituted nonexistent tool path before any worker launch; the original Node24.18/compiler and bounds were retained for the corrected invocation. Callback registration body and emitted runtime code (ignoring comments) remain byteexact, with every32 native whole case and71 original property/C control unchanged.

Actual isolated native measurements correct an earlier ambiguous geometry label: baseline ALONE uses331/336pages,241roots and243362SQLbytes; local packed ALONE uses322pages,237roots and223800SQLbytes. Cold uses310pages,236roots and201320SQLbytes. Installing packed then baseline fails with original SQLITE_FULL13 BEFORE journal sealing. These failed samples and their real fixture/process/container drains are retained. Removing every ASCII whitespace byte would be an optimistic upper bound of16558cold,18800packed,19631baseline bytes; these counts include quoted strings, are not semantics-preserving savings and do not establish an admissible capacity fix. The all-components layout requires a structural implementation solution under unchanged native caps. Zero authored whole native cases ran in these scalar audits; full32-case and complete-system qualification remain open.

### Action-batch decoder declaration and strict fixture completion

The pack decoder now declares its existing zero-copy payloads as Uint8Array views, retaining the wider ActionBatchPackItem input type and assignments for existing callers. Its runtime emission is unchanged. A declaration consumer uses the existing exported utility and SDK subpaths and checks backing-buffer access and compatibility with ActionBatchPackItem arrays. The first consumer attempt used incorrect root exports and failed; the corrected consumer and all four core/declaration assembly steps pass.

Action-batch fixtures accept the actual AtomicBEEF byte union and CreateActionResult transaction type. Fee helpers require defined transactions and output satoshis. Reservation capability fixtures pass the actual boolean resume argument. Fetch and WAB mocks use their real callable parameter/return types, retaining the invalid-fetch input, failed authentication, optional continuity fields and malformed completion scenarios. No original scenario, expected matcher argument or deadline changed in the six edited fixture files; all32 native whole cases and71 original property/C controls remain byteexact.

Full src/test/benchmarks compiler feedback decreased145 to123, then115 including one accidentally removed hostile-fixture type injection, and finally114 across60files after restoring that original injection. The compiler still fails. The first compiler controller refused a missing explicit scope phase label before launching any worker; the corrected same controller ran within unchanged bounds. Formatting and zero-warning wallet lint pass. These are static implementation feedback, with no application/test/native runtime or full-system qualification in this batch. Native combined capacity remains unresolved under the original limits; the read-only investigation did not establish an admissible structural fix. All eleven acceptance rows remain open. The six browser ceilings remain thirty percent higher as authorized, with reconsideration after the complete goal is achieved.

### Native local payload-quota projection

Fresh local packed installation projects each sealed payload's before/after charge once in its UPDATE FROM source. The original four-times-per-reference charge, byte/row ceilings, underflow and change-bit conditions, changes()==1 requirement, rejection message and code remain. Historical complete six-trigger families remain supported. Every native family inspection reads the current anchor trigger's exact SQL, then verifies the complete selected family; a mixed or changed family fails. No occupied schema, persisted table/protocol, physical source rowid, kernel, executable pin or native resource limit changes.

The independent SQL oracle passed all38cases (19scenarios for both families, each on both payload IDs14/15). It covers zero-length/shared content, replacement/move/delete, missing/pending/incomplete versions, missing/wrong counters, underflow, exact/over-budget boundaries, four-GiB integer charges and transaction rollback. These minimal synthetic SQL rows establish payload-quota behavior only. The genuine native fixture separately accepted complete projected and historical families, rejected a mixed family and restored the projected family through its real savepoint. All32 original native whole cases and71 original property/C controls remain unchanged; the whole cohort and full system are unqualified.

Actual measurements: cold310pages/236roots/201320SQLbytes; fresh projected packed322pages/237roots/223014SQLbytes; restoring the historical guards in that already-used database yields323pages/237roots/223800SQLbytes. The projection saves786SQLbytes. Fresh page count remains322, so this does not establish a reduction from the historical fresh packed322-page measurement. Packed plus baseline still fails initial SQLITE_FULL13 before journal, with actual cleanup provenance retained. The complete native layout still needs a larger structural solution.

The first Linux attempt failed before tests because the root Jest entry was absent. A corrected attempt passed the SQL/family checks but failed strict directory drainage because Jest placed its cache in the fixture directory. Both samples remain retained. The final bounded attempt assigned a separate owned temporary cache path, preserved the original empty-fixture check, passed all38SQL/family checks and verified empty fixtures, absent groups/container and unchanged frozen/source/candidate/foreign inputs. The failed combined-capacity sample remains explicitly failed; the passing diagnostic does not qualify the combined layout.

### Native baseline pointer projection

Fresh compact local baseline families use a single current-parent point query for each packed INSERT/DELETE observer. INSERT SELECT LIMIT1 retains the historical scalar lookup's one-row selection, emits no event for a missing parent and records the actual physical rowid rather than the logical source key. Complete historical named/positional families remain supported. Selection reads an actual anchor trigger, then complete current-family equality rejects mixed or altered observers. The native authorizer adds only the exact fixed projected spelling for each existing source/family/ID/context and still checks current main schema and temporary shadow absence; direct dispatch receives no new authority.

An independent 36-case SQL oracle covers nine scenarios across binary/text and historical/projected forms, including physical versus logical keys, missing parents, current row moves/replacement, repeated pointers and rollback. All36passed. A new actual-kernel C component covers every20 fixed pointer coordinates/40transitions, missing parents, rollback, direct-dispatch refusal and temporary shadows. It passed641checks alongside all nine existing C components and the unchanged native runtime resource contract. Every original C test body and the32whole-native-case source remain unchanged. The production driver and source-asset copier intentionally change; the other69inputs from the previous71-file control map remain exact.

The source asset copier now includes the new C contract. The LinuxARM component pin references the new immutable serially built candidate only; other native platforms, complete wallet/provider behavior and full system remain unqualified. An earlier build overlapped static emission and is excluded from qualification/adoption despite its successful raw result. A later fresh serial build and physical drain corrected that ordering. A missing exact assembly phase label also refused startup before worker launch; its failure is retained, and the same controller ran after scope correction.

The actual current native view generated all40 projected/legacy pointer definitions: legacy13114SQLbytes, projected10120SQLbytes, a2994-byte reduction. All nonpointer definition data remained exact. This is definition-size evidence, not installed page savings. Cold310/336pages and packed322/336pages remain; actual packed-plus-baseline still fails initialSQLITE_FULL13 before journal sealing. Independent SQL/C tests do not qualify that failed layout. Core/declarations/source delivery/format/lint pass; full src/test/benchmarks still has114compiler diagnostics in60files. All eleven acceptance rows stay open and full implementation/qualification remains pending.

### Storage test graph fixture completion (2026-10-09)

Completed six storage test fixtures without changing production contracts: the funding fallback uses complete typed outputs with the original owner/reservation/status coordinates; the sync batching mock accepts the real provider argument and supplies every required basket field; endpoint fixtures use current settings/user/access fields; IndexedDB abort calls the actual transaction adapter; the manual authentication fixture increments its declared counter; and the logging test narrows the installed middleware before invoking it. All original assertion expressions, scenario names and deadlines are structurally unchanged. The original 32 native whole cases and 71 current property/native component controls remain byte exact.

Five complete original suites pass in the bounded isolated Linux fixture: 53 funding/sync/RPC tests plus nine endpoint/IndexedDB tests, zero skips. Formatter and warning-free wallet lint pass. Strict full source/test/benchmark compilation still fails with 104 diagnostics across 54 files, reduced from 114 across 60. The manual authentication fixture is compilation-only in this batch. These fixture results use the existing SDK 3.2.1 / better-sqlite3 13.0.3 dependency fixture and do not establish current-SDK or full-system qualification.

The read-only native tree audit confirms that fresh derived witnesses already use `WITHOUT ROWID`; the seven previously compacted redundant indexes cannot be counted again. No new installed page saving is established. Packed plus baseline remains `SQLITE_FULL` before journal; the original native rowids, ten physical witnesses and native limits are retained. The authorized browser caps remain exactly 30% above their originals, with review deferred until the full implementation, validation and goal are achieved. All eleven acceptance rows remain open; complete implementation and local root gates precede application push and hosted CI.

### Complete wallet verifier capabilities and original fixture contracts

The optional wallet verifier now declares the capability graph it executes:
SDK per-input, whole-transaction-only and hybrid backends remain supported,
with optional canonical P2PKH digest batches. Wallet setup, storage and test
provider declarations use the same additive WalletScriptVerifier type, exported
through Wallet and the SDK namespace. Actual method guards replace assertions
that a whole-only backend also supplies verifySpend. Whole-only decline,
consensus rejection and unresolved-source paths retain the explicit JavaScript
per-input interpreter; existing hybrid batching, source counts, consensus
contexts and resource/initialization error identities remain unchanged. No
wire, persistence or caller migration is required. SDK/verifast declaration
identity reconciliation remains conditional with the existing owner.

All four core/emitted-declaration assembly steps and wallet zero-warning lint
pass. The original verifier suite's eighteen cases and thirteen additive
whole-only regressions pass together in bounded isolated Linux feedback. Two
failed samples are retained: the new fixture initially left two stack items
on its first supposedly valid input; one unchanged retry followed a failed
preparation assertion. The actual fixture correction consumes the existing
ASM-empty unlocking item before the independent OP_TRUE/OP_FALSE verdict. No
original assertion, scenario or deadline changed. All failed and successful
workers, fixtures and containers were physically drained before edits.

Twenty-three additional original fixture/helper contracts now compile, retaining
all original assertion/scenario/deadline ASTs. Their twenty-two full original
suites pass 345 cases, zero registered skips, in four serial bounded Linux
batches. Original runtime guard returns remain present; registered passes are
not claims of active-path qualification. Together this batch has 376 passing
registered cases in twenty-four full suites. Original thirty-two whole native
case files and seventy-one current property/native component controls remain
byte-identical. These are implementation feedback, not complete system or
current SDK adoption qualification.

Full src/test/benchmarks compiler feedback decreased from 104 errors in54files
to65in31, then58in30after verifier completion. It still fails. The remaining
BDK benchmark error now reports divergent SDK declaration identities for the
same Transaction class; the peer SDK owner has the exact finding. Native
packed-plus-baseline installation still reaches SQLITE_FULL before journal
sealing under unchanged native limits. All eleven acceptance rows and the full
implementation graph remain open. No application push or hosted CI was started.
The six authorized browser ceilings remain thirty percent above their original
values; reconsideration is due after the complete goal is achieved. PR569
remains open, draft and unmerged with automatic merge disabled.

### Full internalize result and fresh native index reuse

`Wallet.internalizeAction` now declares the `StorageInternalizeActionResult`
that its unchanged runtime already returns. The additional `isMerge`, `txid`
and `satoshis` fields remain compatible with the SDK base result. A strict
declaration consumer checks the full return type, rejects accidental `any`,
and verifies SDK substitution. All four assembly/declaration steps pass.
Both complete original internalize storage suites pass all four registered
cases in bounded isolated Linux, with no skipped tests or edited expectations.

After its original owner, empty-table and migration-seed checks, fresh private
local packed installation reuses the exact cleanup index on
`(spentBy, outputId)` and removes the redundant `idx_outputs_spentby` tree.
The installer first checks exact original DDL, physical output rowids,
nonunique/nonpartial flags, ascending BINARY keys, no temporary shadow and
the actual retained search plan. Its existing savepoint and rollback own the
change. Ordinary and occupied profiles retain their original indexes. The
membership retirement index remains because its canonical family requires it.

All 26 independent SQLite cases pass for nullable and duplicate spenders,
logical/physical identity separation, updates, deletes, rollback, affinity,
keysets and plans. Actual pinned native installation confirms index removal,
retained physical output rowids and the composite search plan. Packed schema
uses 321/336 pages and 236 roots, saving one installed page and one root from
the preceding 322-page layout. Cold remains 310 pages and 236 roots. Combined
packed-plus-baseline installation still fails with `SQLITE_FULL`13 before
journal sealing; autocommit/fenced cleanup observations and failed samples
are retained. This saving does not complete native capacity implementation.

Formatting and zero-warning lint pass. Full strict src/test/benchmark compiler
feedback now has 53 diagnostics across 28 files, down from 58/30. Original
32 whole-native cases and 71 current property/native controls remain
byte-identical; the unchanged internalize runtime and original installer
statements, apart from the additive compaction call, are AST-exact. These are
component feedback, not whole-system qualification. All eleven acceptance
rows remain open. Complete implementation and local root gates precede
application push and hosted CI. PR569 remains open, draft and unmerged. The
six browser limits retain the exact authorized 30% increase, with review after
full implementation, validation, feature completion and goal achievement.

### Private migration declaration and original fixture contracts

The private migration factory now preserves its original config-bearing migration
return type while remaining a Knex migration source. Its runtime is unchanged.
A strict declaration consumer rejects accidental `any` and checks the migration
config, original return type and Knex substitution. All four core/declaration
assembly steps pass.

Twenty-three original fixture/helper contracts now use the actual nested error,
byte-array, serializer, callback and SDK fixture types. Their registered scenarios,
deadlines and original literal data remain unchanged. Preservation checks retain
1,717 original assertion call AST nodes, including nested calls, with three
explicit equivalent-expression transforms. The 32 whole-native cases and 71
current property/native component controls remain byte-identical. No test
exclusion, suppression or production permission widening was introduced.

Formatting and warning-free wallet lint pass. Full strict source/test/benchmark
compilation decreased from 53 diagnostics across 28 files to 13 across seven:
12 SDK PushDrop declarations require the capabilities used by ProtoWallet,
and one BDK benchmark has divergent SDK Transaction declaration identities.
The SDK owner has both exact findings; no cast to a full wallet or conflicting
SDK edit has been adopted.

Fourteen complete original/new component suites passed 231 registered cases,
zero skips, in the pinned bounded Linux fixture. Original runtime guard returns
remain, so these passes do not establish active-path or current-SDK qualification.
The combined storage batch and then the complete manager suite exceeded the
unchanged 30-second diagnostic supervisor. In the manager suite the first
interlock case passed; the second started without a result before termination.
The two cases alone contain at least 25,150 milliseconds of sequential waits,
excluding compilation, setup and other tests. This timeout therefore does not
establish a deadlock. Both failed samples remain; containers were physically
removed after termination and wrapper groups are absent. The complete manager
suite still requires its original full qualification.

The combined native packed/baseline/journal layout remains incomplete under the
original resource ceilings. A read-only review established no admissible VACUUM
saving: it can change implicit physical rowids, requires temporary storage and
cannot run inside the retained transaction. The actual kernel rejects ATTACH
and does not enable DBSTAT. No kernel, dependency, executable pin or native cap
was changed. All eleven acceptance rows remain open. Complete implementation
and local root gates precede application push and hosted CI. PR569 stays open,
draft and unmerged. Browser ceilings remain exactly 30 percent above their
originals as authorized; review follows full goal achievement.

### Shared native baseline pointer observers and complete component delivery

Fresh unpublished baseline definitions share four observers across the fixed
binary/text INSERT/DELETE families. Their point lookups retain original physical
rowids, missing-parent behavior, rollback and event dispatch. Occupied historical
legacy and projected per-ID families remain supported; full exact schema
validation rejects partial, altered and mixed families. The native authorizer
accepts only the exact installed fixed observer on its original source table,
current writer and family, with temporary-shadow and direct-dispatch refusal.

The independently built Linux ARM candidate is 1,353,464 bytes, SHA256
`e125b81323dce7a793ed05a81a194e648059fa8e6ea040a215714f680263219e`.
The original native resource contract and all eleven C components pass; the
added group component covers 32 coordinates and 64 transitions with 994 checks.
All original C component bodies, 32 whole-native case bodies and the other 69
property/component control inputs remain exact. Complete SQL feedback passes
all 36 historical/projected cases and 20 new coordinate cases, zero skips.

Actual cold and packed geometry remains 310 and 321 of 336 pages, respectively,
with zero free pages. Packed-plus-grouped-baseline still fails SQLITE_FULL13
before journal installation. The bounded diagnostic passed its observation and
cleanup checks; the combined layout explicitly failed and remains incomplete.
There is no installed capacity-saving or complete-platform qualification claim.
Core/declaration/consumer assembly and lint pass. Full test-source compilation
retains 13 SDK interface errors in seven files; the new test type error was fixed
after native workers physically terminated. The native delivery tool now adds
cell comparison, local observers, projected pointers and grouped pointers to its
original runtime/WAL/profile/private/range/recovery/quota checks before delivery.
The actual source-owned Linux qualification/delivery CLI passes all twelve
records (runtime plus eleven components), exact candidate-byte delivery and
physical preparation/component/CLI group and fixture drainage. This qualifies
the component delivery path only; provider and full-system qualification remain
open.
All native limits remain unchanged. Full implementation and local root gates
precede hosted CI or application push; all eleven acceptance rows stay open and
PR569 remains draft, open and unmerged. The authorized browser increase remains
exactly 30 percent, to be reconsidered only after the full goal is achieved.

### Compact native witness key UPSERTs

Fresh native generations use a compact witness UPSERT helper family. The
BINARY, non-NULL primary-key conflict already proves equality of its key cells,
so the helper omits their self-assignments and impossible IS-NOT comparisons.
Every nonkey assignment and change predicate remains, as does UPSERT behavior
for nested writes. A key-only identity uses DO NOTHING instead of an empty
UPDATE. Historical default factories and occupied complete helper families
remain; selection inspects the actual transaction helper as well as the
unchanged source observer, then validates the complete family. Mixed, missing
or altered helpers cannot become a trusted installed generation.

Allocation diagnostic34 identifies the current capacity failure at baseline
definition127 of158, identity-budget UPDATE observer, with336of336pages and
zero free pages. The remaining definitions require10982SQLbytes. This diagnosis
provides no installed capacity or full-system qualification claim. New
independent all13-source traces cover three collations, recursive triggers on
and off, NULL and quoted identities, replacements, nested ownership, ignored
writes and rollback. Actual bounded Linux35 passes all eight cases, zero skips.
The original default factories produce byte-identical definitions to the frozen
source249 modules for ordinary and occupied shared-witness DATA. Complete
physical witness DDL remains exact; only20fixed helper definitions change.
Genuine native validation accepts complete compact-key and historical full-key
families, refuses mixed helpers and an altered anchor, and restores exact
geometry after actual savepoint rollback. Helper SQL shrinks56147to53459bytes,
a2688-byte reduction. Actual cold309and packed319of336pages compare with
source249cold310and packed321; this is two installed packed pages saved. The
combined packed-plus-baseline STILL FAILS SQLITE_FULL13 before journal. The
passing diagnostic does not qualify the failed combined layout. All original
32whole-native cases and71current property/component controls remain exact;
the full original22shared-membership suite remains required after complete
implementation, with original300-run seed3242026 properties and30-second
case deadlines. Core95/format102/lint91 pass; compiler46 retains the13known
SDK errors in seven files and no new source errors. No source
rowid, physical witness, kernel, dependency, executable pin or native cap changes.
All eleven acceptance rows remain open; full implementation and local root gates
precede hosted CI and application push. PR569 remains held open and unmerged.

Fresh native baseline generations use fixed inventory coordinates in the 141 internal source observer names. The event bodies, all 47 physical source tables, clocks and pointer observers are unchanged. Occupied full-name generations retain their complete family; mixed or altered families fail exact validation. The fixed names remove 3,027 SQL definition bytes plus 3,027 separately stored schema-name bytes; page savings remain unmeasured. Actual Linux ARM candidate14 passes the original runtime contract and all twelve C components, including an independent 47-source/423-transition/2,784-check compact-name component. The native authorizer admits the fresh positional spelling only and refuses case-insensitive temporary shadows, altered coordinates, direct events and retired/comparison actors. Actual component feedback: all 48 independent SQL cases pass with zero skips. The genuine cold baseline installs at 326/336 pages, accepts complete old and new observer-name families, rejects mixed/altered families, and restores the exact schema and geometry through real savepoint rollback. The source-owned delivery CLI passes all 13 records and delivers exact candidate14 bytes, with all preparation/component/CLI groups and fixture contents drained. The full packed-plus-baseline installation still fails SQLITE_FULL before journal installation; packed geometry is 319/336 pages. The 6,054 metadata-byte saving is measured, but no packed-plus-baseline page saving or full-system qualification is claimed. Native limits and the original whole-case/property controls remain unchanged; this component does not establish complete #544 qualification.

Fresh authenticated private native migrations create auxiliary archive pages and requests with one clustered composite primary tree each. Both original keys are already non-null; columns, affinities, payloads, request expiry indexing and logical key operations remain unchanged. Ordinary SQLite/MySQL creation and occupied tables retain their existing definitions. The original nullable archive header key, private staging/payload tables, operational source rowids and ten physical identity witnesses are unchanged. Complete fixed DDL, actual private writer, pre-generation state and case-insensitive temporary shadow checks gate creation in the original migration transaction. Actual Linux feedback passes all seven new independent SQL cases and genuine fresh/occupied archive families, temporary shadows, late creation, bad source binding, persisted restore admission, absent/extra index removal and exact savepoint rollback. Cold allocation is 307 pages, packed is 317, and packed plus baseline installs at 336/336. Complete snapshot source binding now validates after compaction. The subsequent journal CREATE TABLE snapshot_journal_generation fails SQLITE_FULL, so complete journal capacity and full #544 qualification remain open. Native candidate14, pin8, limits and all original case/property controls are unchanged.

The fresh native local-packed installer now reconciles its snapshot source binding around the fixed spent-by index compaction. It validates the original complete generation and empty unpublished source, verifies that only the redundant nonunique index disappeared while all observers and identities remain exact, conditionally updates the original binding and validates the complete new generation. The existing layout savepoint owns the index and binding together. The preserved allocation37 sample shows the archive change allows packed plus baseline installation at 336 pages, then exposes the old binding mismatch; The later native39 run validates the complete repaired binding and all four negative controls, then retains the first journal-table SQLITE_FULL failure. Full journal capacity and system qualification remain open.

Fresh private native journal generations group the complete 24 original packed-pointer emitters into four family/event observers. The original positional factory and occupied generation families remain supported. Fixed coordinates and actual unique/physical parent lookups preserve pointer replacement, missing-parent deletion and original event selection. Complete mixed, partial or altered families refuse. Actual feedback passes all 14 independent SQL cases and both genuine native fresh grouped and occupied original positional families. Altered SQL, missing or mixed observers, temporary shadows and a partial group refuse; real savepoints restore the exact schema, generation and geometry. The grouped plan removes 20 trigger definitions and 3,198 SQL bytes while retaining every other definition. Cold fresh journal allocation is 329/336 pages, compared with 330/336 for the original family. Complete packed plus baseline remains 336/336 and the first journal table still fails SQLITE_FULL. The original 32 whole native system cases remain pending; this is component proof, not full-system qualification. A disposable ordinary SQLite copy rebuild saved only six pages and did not fit the complete graph; native VACUUM is not implemented or claimed.

Fresh empty native local packed layouts consolidate parent-admission and key-move guards by fixed coordinate and original error identity. Every original marker, actual-parent check and unrelated quota/content/lifetime definition remains in force; occupied layouts retain their original complete guard families. Mixed, missing or altered definitions refuse. The change is internal schema definition data and introduces no archive or public API migration. Complete combined packed, baseline and journal capacity and full native system qualification remain required before release.

Fresh empty private native local packed layouts now use stable compact internal observer names. Table and index names, preparation/source anchors, every event body, predicate, error and source coordinate remain exact. Complete occupied original and parent-grouped families keep their original names. Complete mixed, missing or altered families and temporary shadows refuse. This internal definition-data change does not change the archive vocabulary or relax native resource limits; combined native capacity and full-system qualification remain pending.

Native publication inventory compares restored timestamps with the exact SQLite ISO-text representation written by StorageReader/StorageKnex, including header users and packed metadata rows. It rejects different timestamps or numeric encodings rather than accepting multiple representations. The genuine composed16MiB path exposed this mismatch after complete restore; full system qualification remains pending. Small4MiB exhaustion controls, original deadlines/cases, and all native resource enforcement remain unchanged.

Packed native sync-state inventory uses the exact preserved syncStateId as its TEXT attachment coordinate; sync states have no remapped entity ID. Signed and zero keys retain their original meaning. Independently selected certificate-field rowids and strict safe-integer, content, identity and source checks remain in place.

Published structured resource records persist immutable limits and the original working-allocation ceiling, excluding live owners and cancellation signals. Each finite publication inventory creates one real allocation owner at that ceiling and shares it across the full pass; persisted owner objects and widened bounds are refused. This does not revive the private import or supply physical, source, or semantic authority. Full composed-path and system validation remain pending.

An occupied compact import metadata family remains valid in a genuine retained read-only published-copy inspection. The copy uses the original native clustered-table definitions; fresh compact creation still requires a native owner. Exact complete family, SQL/NULL/object-count/temporary-shadow checks and both native/copy membership rechecks remain mandatory. Ordinary SQLite transactions cannot claim native compact-family or copy ownership. Full composed-path and system qualification remain pending.

Published wallet journal verification reuses the caller’s actual retained SQL transaction, including a genuine read-only copied-profile actor. It does not open a nested transaction and assume that child inherits membership. Actual root callers retain their original transaction path, while the journal/schema/receipt/identity/primary and physical owner checks remain independent. This preserves one coherent read scope without enrolling another actor; complete composed and system validation remain pending.

Small snapshot-journal schema rows now transfer their exact type, name, table and SQL bytes together with their lengths in one at-most-16KiB BLOB response. Larger rows retain the original individual bounded chunks and strict UTF-8 decoding. Every invocation reads the actual retained schema view; original per-definition, name, complete source JSON and object-count bounds, NULL SQL and ordering remain unchanged. This reduces measured repeated metadata round trips without caching schema verdicts or raising resource limits. Full native bootstrap and system qualification remain pending.

Native local-baseline generation checks now compare every selected definition in fresh SQLite queries containing at most eight definitions and 8KiB of definition bindings, plus the fixed scalar LIMIT; an existing longer definition retains its individual query. Exact SQL bytes, complete family counts and primary-index checks remain. Both total and distinct-name counts prevent a duplicate from masking a missing object, and the actual current native actor is rechecked while assembling and executing each batch. No schema verdict is cached, no definition or limit changes, and the original error identity is retained. Full composed bootstrap and system qualification remain pending.

Actual native snapshot schema reads now select at most eight length records per response and transfer groups whose complete BLOB bytes fit the existing 16KiB response allowance. SQL rechecks the aggregate before transfer; longer rows retain their original individually bounded chunks. Temporary row coordinates and lengths remain data in the actual retained transaction. Exact ordering, all original JSON/SQL/name/object bounds, strict UTF-8 and NULL handling remain; there is no cached verdict or changed production quota. Full composed and system qualification remain pending.

Current native all47 baseline installation now uses the existing atomic journal source-addition migration. It validates the complete old/new plans in the actual writer, refuses installation while live capture receipts remain, preserves events, retained floor and bootstrap progress, and rotates the journal epoch so old source bindings cannot resume. Idempotent retries with an already-installed baseline do not repeat the migration. Existing native actor/profile/primary checks, definitions, quotas, deadlines and the source-addition protocol remain unchanged. Full composed and system qualification remain pending.

Whole-feature native test fixtures explicitly admit 16 MiB, matching the existing composed integration allowance. The independent default preview admission remains 4 MiB. The complete schema has a measured minimum above the old 336-page private-stage allowance, so successful full-feature fixtures use the unchanged native formula at their explicit admission (1,360 pages). Five capacity assertions follow that deliberate fixture migration; all original test names, counts, semantic assertions and deadlines remain. Independent four-MiB controls retain the original 336-page ceiling and exercise actual quota exhaustion and rollback; the full-feature fixture verifies genuine packed/baseline/journal sealing after its real native writer completes. No product default, native quota formula, VFS/C implementation or original property control is relaxed. Supported data, copy/WAL/recovery and concurrent-owner peaks still require measurement before a production recommendation; this test admission is not that qualification.

Whole-native full-feature fixture admission separately selects 16 MiB for authenticated decoded/working allocation and 16 MiB for aggregate physical storage, preserving the 64 KiB serialized-row limit. The original derived-TEXT contract requires an 8 MiB working allocator and a 16 MiB decoding budget; admitting only 64 KiB for allocation cannot exercise it. The preview helper retains its original coupled allocation default and adds an explicit optional allocation selection. Small 4 MiB exhaustion controls retain 64 KiB allocation. All native quota/heap/address/FD derivation formulas, production defaults, C candidate and original semantic tests remain unchanged. The full selection derives a 49 MiB SQLite heap and 128 MiB address-space allowance under the existing formula; this is a fixture envelope, not a production recommendation. Current full native and new admission-case validation remains required.

Private content staging captures an owned byte copy before queued I/O, including Node Buffer inputs. Buffer.slice() shares caller memory; staging uses the existing detached-copy helper so caller mutation cannot change a pending append and cleanup cannot erase caller bytes. Finite chunk bounds, working/lifetime charges, replay-prefix comparison, independent stored-byte hashes and cleanup remain unchanged. The original derived-TEXT byte-preservation contract is the regression control.

Fresh private native local schemas retain individual literal field guards and original observer names, and fresh journals retain complete individual positional pointer emitters. This preserves independent historical-emitter conversion and damaged-definition rollback contracts. Complete occupied grouped/named families remain recognizable under their existing exact validators; no occupied database is rewritten. Compact physical tables and source-owned quota, generation, ownership, mixed/missing/altered/TEMP refusal and rollback safeguards remain.

The complete canonical migration regression fixture explicitly admits 8 MiB of aggregate physical storage, preserving 64 KiB row and working-allocation ceilings. Its measured empty main database is 1,503,232 bytes; the actual small 4 MiB fixture limits the main database to 336 pages (1,376,256 bytes) after its unchanged three-image recovery reservation. An independent control compares both real page ceilings and verifies the complete schema fits the larger bounded allowance with recovery headroom. Original migration algorithms, exact DDL/names/callbacks/configs, selected rollback/replacement retry and case deadlines remain unchanged. The small default and exhaustion controls remain 4 MiB. This is an empty-schema test allowance; production data, concurrency and recovery peaks still require qualification. No production default or native resource formula is changed.

PushDrop infers the actual getPublicKey/createSignature wallet capability through a generic parameter while defaulting to WalletInterface for existing full-wallet annotations and public wallet access. Constructor and method runtime bodies/defaults are unchanged, and emitted JavaScript remains byte-identical. Actual ProtoWallet and full-wallet declaration checks cover both forms without casts or invented wallet methods; the original six script tests remain intact alongside two appended regressions. SDK output propagation and release ownership are coordinated separately; full program qualification remains pending.

## Current declaration and authenticated fixture consistency

The acknowledged SDK `PushDrop` source now generates consistent declarations
and source maps in the existing types, ESM and CommonJS layouts. Exactly the
`PushDrop.d.ts`, declaration-map and JavaScript-map outputs change; all runtime
JavaScript and other declarations retain their existing bytes. Strict actual
installed import and require consumers preserve real `ProtoWallet` inference,
the `WalletInterface` default and public full-wallet methods. The unchanged old
declarations fail the corresponding negative controls.

The authenticated large-record HTTP fixture now uses the existing genuine
full-wallet constructor for its stranger, with the same random root key and
awaited client and wallet cleanup. `StorageClient` and `AuthFetch` retain their
full `WalletInterface` contract, including payment operations. Both original
latency variants, all authentication, integrity, retry, checkpoint and stored-byte
assertions, and the original 360-second case deadline remain. The complete wallet,
test and benchmark source compiler passes with zero diagnostics after this
correction; the changed HTTP fixture still requires runtime validation.

The next complete manager cohort has 27 cases; the earlier diagnostic's version
number 17 was not a case count. Its two interlock cases have about 25 seconds of
combined scheduled exclusive waits before setup and remaining cases. Whole-suite
supervisors must cover that work and cleanup. The shared-membership cohort retains
all 22 cases, nine 300-run properties with seed 3242026, and its original explicit
30-second property deadlines. Preparing fair whole-suite bounds does not change
those case contracts or qualify their execution.

## Repository qualification and Windows cleanup

The Windows candidate-build controller retains its primary outcome until the
original executable cleanup completes. Its timer is cleared in `finally`; cleanup
then either preserves the original failure or returns the original output. A
cleanup refusal retains the concrete retry and both error identities. Compiler
arguments, source and pin policy, physical shutdown marker, retained-worker gate,
output ceiling and 200-second deadline are unchanged. Syntax, AST preservation,
formatting and warning-free repository lint pass; actual Windows host qualification
remains required.

The complete repository formatting check and 12 additional static governance,
license, toolchain and service-contract checks pass. Verifast's documentation,
governed source-version inventory and ordinary generated stack facts now match
its source manifest through exactly three version substitutions. All other facts,
baseline entries, dates, published versions and release classifications remain.
All 34 original pure metadata control tests pass, together with documentation
policy, repository-health and the affected formatting checks. The generated
package migration ledger now matches the exact ordinary-generator preview under
an author-verified branch-local ownership acknowledgement. Only the existing
Verifast version and declaration-correction notes change; every other package
entry, published baseline and release classification remains. These checks
do not replace the complete health, typecheck, build, runtime or exact-head CI
gates.

The isolated full-workspace compiler attempt stopped on a native compiler fault
marker. Its replica used read-only generated outputs instead of the actual
writable modes, so the observation does not establish an SDK source defect or
qualify the original root gate. Actual source and installed outputs retain their
bytes. The failure and admission correction are preserved; a fresh supported-host
run must use the original output modes and ordinary governed compiler. No flagged
Mac worker is replayed.

Full manager, shared-membership and authenticated HTTP supervisors retain every
original case and oracle. The HTTP supervisor allows both original 360-second
case deadlines plus setup and physical drainage; its two-case cohort has not yet
run. Failed Docker API observations block new runtime admission. Limits continue
to require workload, concurrency, recovery and peak measurements with headroom,
including the authorized browser allowance's review after the full goal finishes.

## Measured qualification progress and harness allowance

The full workspace typecheck passes on source273. The complete manager suite
passes all 27 original cases in 128.942 seconds after preparing its intended
chain tracker before createAction and restoring/destroying owned fixtures in
finally. Shared membership passes all 22 cases and 2,700 generated schedules
(seed3242026) in 129.573 seconds, retaining its original 30-second case deadlines.
The aligned root suite initially had 372 passes and two governance failures;
the acknowledged invariant descriptions, genuine 97-suite/97-target goldens and
preserved wallet build prerequisite are now corrected. Full updated gates still
require execution.

The full HTTP attempt failed: the zero-latency case reached its 360-second harness
deadline, followed by authenticated-response failures in the second case. The
first asynchronous case may have remained active, so the second is not an
independent latency verdict. Failed evidence and exact container cleanup remain.
A private 90-second diagnostic observed 12 completed upload-part calls with
3.554–4.605-second durations (median3.821 seconds); request serialization took
about 2 milliseconds and most time was in authenticated HTTP. It is diagnostic
evidence, not a passing campaign or production capacity proof.

The test transfers a 7 MiB record in roughly 28 parts and repeats complete corrupt
and valid reads, acknowledgement loss, disconnect, restart and restore. Those
operations plus the one-second latency variant need a workload-derived harness
allowance. Each complete case now allows 600 seconds; a whole-suite supervisor
must allow 1,260 seconds for both cases plus setup and drainage. All original
assertions, mocks, operations, data, latency variants and production RPC deadlines
remain unchanged. The original failure is retained; the larger allowance is
unqualified until both complete cases pass. This avoids optimizing inherited
authentication solely to meet an unsupported harness ceiling.

Limits require a demonstrated purpose, supported workload, measured use and peaks,
concurrency, cancellation, recovery and useful headroom. Compare that benefit with
implementation complexity, maintenance cost and compatibility. The authorized
30% browser allowance is reviewed after the full goal. All eleven acceptance
rows remain open; full platform/resource/property/mutation/conformance/artifact
and exact-head CI/analyzer/review qualification is still required.

The ordinary wallet selection contains 671 suites and retains its default three
Jest workers. The original full build and packed-consumer command passes on the
source274 candidate, including every declared public export, wildcard resolution
and consumer declarations. Registry access is a prerequisite of its unchanged
script-disabled temporary npm installation; a network-isolated attempt is not
a package-validity result.

The first complete coverage campaign is unqualified. Its action parity fixture
created a second legacy wallet without the intended offline chain tracker, and
create-action fixtures used live chain services for synthetic transactions. Both
now install their actual fixture Services before actions and restore their
spies; original test declarations, assertions, options and deadlines remain.
The native timeout sample also contains inconsistent elapsed clocks: its parent
recorded 429.451 monotonic seconds while the native suite reported 2,269.852
seconds. Host suspension or clock drift must be resolved before interpreting
that sample as a capacity or deadline defect. No native or product limit changes
follow from it. Full corrected coverage, platform and production qualification
remain required.

On stable clocks, the complete native private contract suite ran 30 passes and
two 30-second case timeouts. A private diagnostic retained all 32 bodies, data
and assertions while measuring those two registrations with a 90-second harness:
exhausted-epoch retirement and rebuild completed in 45.296 seconds; derived TEXT
version ownership completed in 32.722 seconds. All 32 diagnostic cases passed in
234.170 seconds. That measurement establishes no branch qualification or
production capacity. The two actual outer test allowances now select 90 seconds,
with the native fixture's original 120-second lifetime and every other case
allowance, resource formula and product deadline preserved. This bounded
headroom accommodates the complete declared workload without speculative
implementation changes for a 30-second ceiling. Normal current-source gates,
complete native cases, coverage and system qualification remain required.

The normal source276 native suite passes all 32 cases in 234.887 seconds, with
no diagnostic wrapper, and all four full root gates pass (374 root controls).
The broader coverage attempt preserves its failures and was deliberately stopped
for a corrective batch. A full completed-profile fixture still selected the
small 4 MiB physical allowance: the journal schema exceeded its recovery-reserved
main-page capacity while the host retained over 22 GB free. Those four full
publication/activation/transfer/reopen fixtures now explicitly admit 8 MiB and
retain the matching inventory accounting; the shared default and 4 MiB exhaustion
controls remain. No product/native memory formula or deadline changes follow.

Shutdown during a delayed archive source open now rechecks cancellation before
the service-closed state, preserving the accepted capture's cancellation error
while cleanup retains its quota. Ordinary source-opening cleanup again retains
the concrete destruction error as its cause; native owners retain aggregate
opening/cleanup evidence and the same retry operations. The SyncState fixture
accepts its original date input after the existing in-place timestamp conversion,
and the archive migration test checks the actual later journal migration and
ordering. Complete affected suites and broader system qualification remain
required; no interrupted coverage attempt counts as complete.

The affected source277 run confirms the archive service/store, SyncState update
and profile transfer suites pass. The guarded-source control also requires the
same retained cleanup error at opening and later provider destruction. When both
steps return that same existing typed error, preserve it directly; its cleanup
owner and retry are already attached. Distinct opening/cleanup failures continue
through the ordinary/native cause handling above. The DELETE activation suite
reaches a 30-second case deadline; no product or test deadline increase follows
until a bounded complete-case measurement distinguishes workload from a hang.

The complete DELETE diagnostic exposes two compatibility defects rather than a
capacity defect. Composed images now permit explicit `rowId` columns only for
`WITHOUT ROWID` tables, whose complete composite primary keys already determine
row order; ordinary implicit-rowid shadowing still refuses. A native owner can
also retain the exact historical ordinary SQLite quota family after handoff.
Selection compares complete current definitions against ordinary historical,
native historical and guarded dispatch sources, rejects altered or mixed
families, and never rewrites an occupied layout. The existing 16 KiB definition
bound remains: observed historical definitions are 890–2,481 bytes.

The guard cleanup fixture now delivers its intended unproved close event, so it
can check refusal and retry ownership while the physical `closed` state remains
false. A missing event correctly leaves cleanup pending and does not justify a
larger timeout. Publication checks require a real descriptor verification at
each boundary and every observed verification to match the durable wallet
identity, rather than prescribing one call when publication now performs three.
The killed-copy child loads the actual compiled modules produced by the required
build. The four-MiB negative control keeps every independent rollback-state
check and additionally asserts both concrete fenced migration cleanup failures
retain the original SQL_FULL cause; an intentional fixture stop is not the
writer's subsequent native error. Full current-source regression and system
qualification remain required. No product or test deadline increases accompany
these corrections.

The next exact diagnostic corrects the earlier image classification: existing
legacy global key/edge tables may also use ordinary rowid storage. The reader
now selects an unshadowed alias from SQLite's three implicit rowid names and
refuses an ordinary table when all three are shadowed. Explicit source fields
remain complete cell data. Regression rows share the same explicit `rowId`, so
count, payload and mutation checks detect using that field incorrectly.

A native profile's existing catalog connection is retained until actual profile
destruction, instead of being evicted by a 30-second idle pool timer. Its pool
still admits exactly one connection; source writers and temporary readers keep
their original zero-minimum pools. All retirement ABI, actual lease and freeze
requirements remain. The earlier full native case reached the genuine writer
with its catalog lease already evicted; increasing the test deadline could not
repair that ownership failure.

The original four-MiB layout attempt exhausts capacity during baseline setup,
before reaching journal setup. Its independent snapshot now precedes that entire
attempt and checks the actual rolled-back schema, baseline presence, packed
presence, settings and page allowance. Both fenced migration cleanup errors
must retain the original SQL_FULL cause. The new quota regression removes its
actual declared trigger/view types rather than assuming both are views. Previous
failed diagnostic and ordinary runs remain retained; no full qualification or
new deadline allowance is claimed.

On the corrected source280, the full retirement case completes in 34.836 seconds
under a private 90-second observer. Its actual outer harness now allows 60
seconds, leaving 25.164 seconds of measured headroom. Original bodies,
assertions, 60-second observer inputs, fixture lifetime and native/product
limits remain. The same diagnostic runs five of six DELETE cases successfully;
that partial diagnostic is not normal branch qualification.

The no-decision recovery case exposes a stale receiving receipt in the original
publication instance: durable READY already includes the wallet's physical
identity, while its cached identity still omitted that copied file. Publication
now retains the exact proven complete identity after its READY commit and
physical syncs. Recovery keeps its complete receipt comparison and committed
retirement refusal. The four-MiB control independently verifies rollback and
requires the exact original stop error plus the concrete FK restoration fence
failure, which retains SQL_FULL. Normal whole-suite and broader qualification
remain required; previous failed runs remain evidence.

The normal source281 run passes all four root gates and 193 of 194 affected
cases. No-decision recovery now completes; its remaining mismatch is a fixture
snapshot of the legacy manager's cached user timestamp. Existing primary
selection refreshes cached `activeStorage` while updating `updated_at` in the
durable row. The fixture now snapshots the actual original typed user through
its actual provider before freezing, verifies identity/primary cache coordinates,
and retains exact recovered-user and complete database-image equality. No
public cache contract or recovery data is changed to satisfy that expectation.
Complete current affected and broader qualification remain required.

The next original full-coverage attempt exposed two funding success fixtures
without their offline chain tracker and a legacy snapshot suite whose injected
faults were bypassed by the newer journal transport. The funding cases now use
the existing independent tracker fixture while retaining the real canonical
builder. The snapshot fixture explicitly declines journal negotiation so it
exercises its intended transport; production negotiation and independent journal
tests remain unchanged. Its killed-before-commit child now intercepts the actual
Knex transaction. Original cases, semantic assertions and deadlines remain;
these fixture corrections require complete validation, not larger limits.

The original two suites then pass 158 of 159 cases. The remaining crash hook
used assignment to Knex's non-writable transaction property. Its owned child
now defines that configurable property explicitly, retaining the actual
transaction, pre-commit SIGKILL and durable recovery assertions. No production
behavior or time allowance changes; full validation remains required.

### Complete failure reproduction and corrective batch

The original twelve failed suites were reproduced with coverage and the original
three workers under a 12 GiB container allowance. The former 6 GiB allowance
produced OOM kills; this attempt peaked above that cap without OOM events. The
legacy portability suite passed, but the campaign remains unqualified: the
composed native recovery suite also exposed setup deadlines and original
30-second case timeouts. Those require independent diagnosis.

A single retained source failure now preserves its exact identity through close;
distinct cleanup failures remain aggregated. Snapshot archive opening similarly
distinguishes its original failed read from a second physical cleanup failure.
A queued native index operation rechecks revocation before executing, so sealing
cannot overwrite a close that already owns admission. Both process-loss child
programs are explicit ordinary build inputs and forked from their compiled
`out/test/storage` locations. Byte-preflight evidence inspects its one actual
SELECT after schema checks; Unix privacy tests retain refusal and no-file controls.
Password and salt refusals identify their respective resource boundary, while
the original encoded-byte erasure and cleanup controls remain unchanged.

These changes do not resolve the remaining offline chain authority, controlled
sealed-storage corruption fixtures, legacy export ordering/boolean compatibility,
or composed native setup/resource qualification. Full qualification and the
remaining #544 acceptance rows are still open; #569 remains held and unmerged.

Fresh structured-source validation reads all thirteen fixed table counters in
one bounded statement. Authenticated source guards now compare their complete
fixed name/type/table/SQL predicates inside one fresh SQLite count query, with
all family/object-count checks retained. No schema verdict is cached, no owner
is inferred from metadata, and no product or original case limit is increased.
The actual sealed-source case now independently drops, alters, restores and
rechecks a physical guard after a successful comparison. This targets measured
repeated setup queries; full native timing and system qualification remain
pending. The symlink refusal oracle names the actual file-type/link-count
boundary while retaining refusal and no-file-creation assertions.

The complete native diagnostic reaches actual source activation in 153.5 seconds
and observer entry in 154.6 seconds, then expires and physically drains at its
original 180-second lease. The composed test fixture now accepts an explicit
five-minute admission; its default remains three minutes and no production
limit or original case deadline is changed. Full setup, import and recovery
measurements remain required before selecting complete-case harness allowances.

Synthetic corruption fixtures first prove normal sealed writes refuse, then
transactionally introduce the intended damaged payload and restore the exact
physical guard before exercising digest or SQL-extent refusal. The preview's
fifteen occupancy queries retain their no-count/no-offset assertion; independent
schema ownership checks can use metadata counts. Closed binary references name
the actual source-closed error while the row-advance lifetime check remains.

The synthetic binary corruption helper retains and restores both independent
physical UPDATE guards: the whole-envelope authenticated source seal and the
provisional immutable-prefix guard. Their ordinary refusal is asserted before
corruption and the complete fresh seal/prefix definition checks run afterward.
Production write protections are unchanged. Earlier single-guard fixture
attempts stopped at the second protection and did not qualify read integrity.

The complete actual native fixture now returns in 227.3 seconds and immediately
closes/removes its physical directory under explicit five-minute admission.
The diagnostic command passes in 228.1 seconds with zero OOM, exact original
native input and frozen source, and no retained worker/container. This validates
full setup under the selected allowance, not complete import/recovery, native
case timing or production suitability. Original defaults and application case
deadlines remain unchanged.

Binary corruption uses the actual persisted bounded chunk length, rather than
assuming every chunk is 64 KiB. The same-size postimage passes the unrelated
length constraint and exercises the retained read-digest refusal after both
physical guards have been exactly restored. Full affected validation follows.

### Legacy archive flags and certificate order

The published SQLite `getProvenTxReqsForUser` getter leaves optional
`wasBroadcast` as SQL `0`/`1`; the separate typed finder returns booleans.
The new SQL archive source preserves the existing getter's numeric spelling.
Semantic staging accepts exactly either booleans or `0`/`1`, retains the
original archive value, and rejects other flags. The existing native restore
admission converts both admitted representations to the physical SQL flag.

Certificate-field names retain the legacy locale sort. For distinct names
that compare equal, a bounded row-identity read inside the retained snapshot
uses the original unpaged finder's chosen SQLite index or table scan. This
preserves scan direction, custom index direction and insertion order without
fetching the full original payload. The group allocation policy reserves the
query results and ordinal map as well as detached rows. Complete archive
comparisons cover both insertion permutations, the stock import index, table
scans, custom descending indexes and reverse unordered scans.

A separate actual native measurement on source289 confirms the distinction:
legacy request flag `1`, typed request flag `true`, and a certificate table
scan whose locale ties retain insertion order. Its full composed fixture
returned in 235.3 seconds under the explicit 300-second fixture allowance;
this is diagnostic setup evidence, not complete system qualification.

### Offline legacy action and monitor qualification

The selected legacy action-batch and monitor fixtures use an explicit test-only
chain tracker. It accepts exact height/root pairs from the pinned legacy
wallet's proof inventory and the monitor's independently authored block
headers. Unknown roots and wrong heights are independently rejected; wallet
creation, proof validation, monitor transitions and reservation assertions
remain real. This avoids relying on external chain services during isolated
Linux qualification. It neither changes production chain authority nor
qualifies a live chain or funded restore/spend. Fixture teardown drains every
owned legacy wallet even when an assertion fails.

The source294 native thirteen-table/twenty-two-TEXT/three-mode attempt
selected a finite 480-second fixture lease and a 510-second Jest deadline. Full
setup independently measured 227.3 and 235.3 seconds; the existing 120-second
archive operation plus physical inventory reads and cleanup need separate
headroom. The helper's default remains 180 seconds, and all payload, memory,
authentication, UTC/monotonic expiry and cleanup checks are retained. This
test-only admission is subject to actual full-case measurement; no production
latency or lifecycle limit follows from it.

The offline fixture binds both Services and the Monitor's separately configured
Chaintracks authority. Stubbing only Services leaves real Monitor proof checks
using its original external chain client; both paths now use the same exact
fixture root/height membership.

The source294 full native case failed normally after389.948s because its single
120-second source budget covered three independent modes. The recorded failure
remains unqualified. The corrected test gives each mode its own120-second
source deadline, with a maximum360-second aggregate operation,720-second
selected fixture lease and750-second Jest deadline. It reports mode start/end
times for full-cost review. The helper default180s, application defaults, field
and memory limits, and every original correctness/cleanup check remain intact.

The IndexedDB source also preserves the optional request flag's original
boolean or historical0/1 spelling. Four complete-document regressions compare
both ordinary and packed streams with the original materialized exporter and
check that the actual source row is unchanged. These simulated IDB checks are
component evidence; real browser qualification remains required.

### Full customer import and recovery qualification

The source295 original complete native export case passed in410.212 seconds
(command411.340 seconds). Ordinary, structured and text modes took17.500,
55.221 and67.869 seconds respectively, each below its retained120-second
source allowance. All thirteen tables, twenty-two text fields, complete archive
provenance and independent pre/post physical inventory assertions passed;
there was no OOM or timeout, and all owned work was physically drained.
This qualifies the export component only, not complete customer recovery.

The first original occupied import/current restart/repeat import/customer-write
integration case originally selected a bounded720-second fixture lease and
750-second Jest deadline. The source304 run expired normally at720.346s,
after230.755s setup and46 real drained baseline operations (median8.974s;
maximum26.077s). It had not completed the first baseline. Source305 therefore
selects a provisional5400-second fixture lease and5430-second Jest deadline
for measurement of both complete imports, current recovery and customer writes.
That ninety-minute source305 attempt failed before native setup (243ms):
the structured JSON index correctly refused a source lifetime above its
existing one-hour bound. Source306 selects a3600-second fixture lease and
3630-second Jest deadline within that supported maximum. Both failed attempts
remain retained. This qualification window does not establish a production SLO;
full latency, foreground fairness and resource qualification remain mandatory. Its old30-second test deadline could not contain
measured235-second setup. This selected test allowance preserves the full
large incoming and later customer TEXT records, every original assertion,
independent semantic/auxiliary/prior-import oracles, actual import/recovery
implementations, memory quotas and physical cleanup. It reports only synthetic
stage names and timing, never archive contents. The first and repeat imports
also report structural phase, operation number, episode, row progress and elapsed time from the
existing synchronous public callback after authentication or a fully drained
merge operation. This observation cannot authorize work or renew an expiry;
it measures progress before reviewing the selected whole-workflow allowance. The source306 complete case failed functionally after2090.687s, before its3600s expiry: strict source allocation-history validation rejected sequence metadata during the first import. The first import, later customer write, restart and repeat import remain unqualified;
other recovery cases and the helper default180-second lifetime remain unchanged.
No production deadline or resource recommendation follows from this allowance.

The first complete customer case reached real fixture readiness in230.576s,
then failed in the independent prior-import oracle: the native compact import
journal had no physical rowid. The production prior-import page and point
readers require that same key. The source297 correction retains rowid tables
for fresh unpublished native import metadata families whose custody copies
need original physical identity, avoiding a new surrogate-key protocol solely
for compact-index savings. Exact verification of existing rowid and compact
families remains; no existing data is rewritten. Field/payload layouts,
public legacy schemas, quotas, deadlines and all original recovery assertions
are unchanged. Fresh-layout complete customer qualification is pending;
recovery of earlier compact candidate profiles is still unqualified. This
unpublished correction is not a deployed migration or a full-system claim.

The source297 full customer case passed its fresh physical-row prior-import
capture, then failed actual incoming-ID reservation because the current-profile
observer bootstrap had not installed the required ledger. The source298
correction installs a missing ledger through the same explicit atomic
source-addition migration as baseline observation. Live capture receipts still
refuse schema addition, ordinary source reads/import allocation still cannot
install persistence, and the ledger uses the actual generation's original
maximumRows rather than silently increasing capacity. Existing generation,
disabled-epoch recovery, quotas, expiry and custody checks remain. All original
customer assertions and720/750-second integration allowance are unchanged;
complete runtime qualification remains pending.

The source298 complete original customer case cleared prior-import capture and
ledger bootstrap, then failed after254.439s at the packed-row identity read-back.
The installed Knex query builder retains only its first argument when that
argument is a column array; the separate physical-rowid argument was omitted.
The exact identity check therefore rejected a missing projection. Source299
places every metadata column and the physical-rowid expression in one array.
The original bigint identity and complete metadata equality, field descriptors,
source/writer ownership, quotas, expiry and savepoint rollback remain unchanged.
All93 original customer assertions and records are retained. Fresh complete
customer qualification of this correction is pending; source presence and the
private diagnostic do not establish readiness.

Resource ceilings should protect a named resource and support the intended
customer workload with measured concurrency, recovery and peak headroom. Review
the engineering and maintenance cost of further optimization against the value
of a ceiling. The authorized30percent browser artifact increase is reviewed
after the full goal. The measured16GiBVM/12GiBcontainer admission is qualification
capacity, not production sizing. Correctness, authentication, atomicity and
cleanup checks remain mandatory when a resource allowance changes.

The source299 original complete customer case cleared the packed-row identity
check and progressed through real baseline copying. It then failed after575.207s
at the raw `monitor_events.details` length API, without timeout or OOM. The
native ABI requires INTEGER coordinates; the JavaScript bridge deliberately
binds ordinary numbers as REAL. Source300 binds the already validated safe
table, field and row coordinates as bigint in both local and raw TEXT metadata
readers. It preserves the native INTEGER guard, coordinate validation, original
transaction ownership, ABI, UTF-8/NULL/length rules, quotas and scoped wiping.
A genuine authenticated private-native regression uses independently authored
raw UTF-8/NUL/NULL cells, compares complete bytes, and verifies REAL-coordinate,
copied-actor and cancellation refusals. This lower transport control is not a
complete composed profile or system qualification. Current full customer and
all supported-platform/resource/consumer/exact-head evidence remain required.

The source300 bigint binding attempt was stopped by the original client/mobile
Knex typecheck before any runtime cohort. Source301 uses explicit SQLite INTEGER
casts on those already validated safe-number coordinates. This conversion is
lossless over the admitted range and fits the existing portable Knex declaration
without an assertion or ambient type change. The C ABI still rejects direct REAL
coordinates. The genuine native regression and every original case are retained;
current complete qualification is required.

Source301 root/build, seventeen whole component suites429 and the original TEXT
reader suite18 pass. The raw native regression correctly refused an unestablished
read view: BEGIN alone leaves SQLite at SQLITE_TXN_NONE. Source302 independently
selects and asserts its original raw row keys inside the genuine READ transaction
before invoking extent metadata. The retained-view C guard and production readers
remain unchanged; all complete-byte and negative controls remain. The corrected
regression requires fresh execution and does not qualify full customer recovery.

Current source302 qualification passes all four original root gates and the
wallet build. Seventeen complete metadata/affected suites pass429 cases, the
complete original TEXT reader suite passes18 (including five signed-rowid
controls), and the actual raw native regression passes one:448 component cases
in total. Thirty-two other native cases are unselected and unqualified. The
source299 complete customer run failed at the now-corrected raw coordinate ABI;
current complete import/restart/repeat/recovery qualification remains required.

The incoming-ID reservation regression now independently checks SQLite's
`typeof(seq)` as well as exact deleted-high counters, retry stability, foreground
allocation and stale-primary refusal. Its selected fixture admits900 seconds
with a930-second test deadline because native setup alone measured230 seconds;
the helper default180 seconds and other cases are retained. The source307 regression against the unchanged writer failed at the independent
source-counter predicate after237.141 seconds, before its900-second expiry.
Source308 explicitly casts the already validated safe reservation floor to
SQLite INTEGER for both insertion and update of sqlite_sequence. Its untyped
column otherwise retains the native driver's REAL number binding. The same
strengthened regression must pass before this correction receives qualification
credit; the complete customer workflow remains separately required. No allocation-history integrity or expiry check is
relaxed. Limits should protect supported workloads and resource use with
measured headroom; reducing feature scope or adding complex representations
solely to fit an arbitrary cap is not the objective.

The source308 complete original customer run cleared the strict INTEGER
allocation-history predicate and reached PREPARED after 193 drained operations.
It then failed after 2151.142s, before expiry, because existing operational
checkpoint payload preparation correctly required query-only mode, while the
fresh physically read-only private native lease retained SQLite's default
query_only=0. All original customer records, assertions and oracles remain.
A test-only source309 addition to the original genuine native raw-field case
reads the actual PRAGMA and fails against that unchanged reader (160ms).
Source310 sets and verifies query-only mode before lending every fresh private
native read lease. It retains the separate physical read-only slot, exact
owner/transaction/source checks, writer revalidation and destruction on both
success and failed admission. The payload reader's refusal is unchanged.
Same-test runtime qualification and complete customer/restart/repeat remain
required; root/build success does not establish those outcomes.

Read-only source308 observations showed a 1.82GiB container peak without memory
limit/OOM events and little CPU throttling; most sampled CPU belonged to the
native kernels, with roughly 70percent cumulative CPU in system calls. The
native driver currently selects a 64KiB SQLite page cache per connection and
checks actual file/directory identity on physical reads. Cache thrashing is a
hypothesis for the high file-operation cost, not a measured causal conclusion.
Review a bounded cache allocation within the existing native heap before
complexity solely to fit a timeout. No cache, native heap, admission deadline
or original customer workload was changed by source310.

Source311 replaces the native driver's fixed64KiB SQLite cache target with a
bounded share of its already admitted hard heap. Each of the four driver and
two possible temporary recovery-copy connections targets at most one twelfth
of that heap and at most1MiB. SQLite cache_size remains a target; the existing
hard heap and address-space limits are the actual memory boundaries. Schema,
VFS identity, physical quota, IPC, authentication, ownership and lifetime
checks remain fresh and unchanged. This does not increase a production memory
ceiling or suppress a timeout. A fresh exact native build must pass the original
standalone native contracts before registry admission. Full customer timing
and correctness remain unqualified; the source308 CPU observations support an
experiment, not a speedup claim or final production sizing.

The fresh source311 Linuxarm64 native15 candidate passed all13 original
standalone modes: runtime, WAL/DELETE/descriptors, profile, private stage,
range, committed writer loss/recovery, shared quota, cell comparisons and the
four observer/pointer families. The original assertions, heap/address/file/IPC
bounds and physical fixture/process cleanup are unchanged. Source312 admits
only its exact1353576-byte build, SHA256
cae4b83968b782cc9047fc69cab0df35f74632d890506964ffd574830ba36a5f.
No unqualified platform entry is added. The same source309 native read-mode
regression passed against source310 (182ms; unchanged reader failed160ms),
including original full UTF8/NUL/NULL and ownership/cancellation controls.
The complete customer, restart, repeat, performance, platform, consumer and
exact-head CI/review obligations remain open. No standalone result is a
full-system or production sizing claim.

The complete original source312 customer case failed after438.181s in the
first import's checkpoint preparation, before its one-hour expiry. The fixture
selected2MiB per merge page even though checkpoint TEXT scratch alone reserves
2MiB, in addition to existing-state planning and retained decoded metadata.
Source313 explicitly selects8MiB for this complete occupied fixture's merge
page, within its existing8MiB row allocation ceiling. Empty restore retains
2MiB. Original records, full TEXT values, semantic/auxiliary/prior-import
oracles, row counts, physical quota, working allocator and real expiry remain.
Production defaults are unchanged. The failed run peaked at1818038272 container
bytes with zero memory-limit or OOM events; container RSS is separate from
explicit component allocation accounting. The allocation selection requires
full original customer/restart/repeat qualification and is not production sizing.

The same original source313 customer run committed its header checkpoint
(nextRow1/14, operation194), then refused the next provenTxs page after489.350s.
The8MiB attempted envelope still omitted the complete proof/field/current-map
pipeline: binary scratch, key/current allowances, proof validation scratch and
retained decoded metadata precede checkpoint scratch and writer revalidation.
Source314 selects the existing supported16MiB decoded/working ceiling for the
complete composed fixture. Its row allocation ceiling follows that owner;
original native heap/address formulas continue to enforce the admitted bound.
Empty restore remains2MiB. Physical/logical quotas, original customer bytes,
rows, independent oracles, finite expiry, cancellation and cleanup remain.
This is a qualification envelope, not a product default or production sizing.
Complete original import/restart/repeat validation is still required.

Source314's complete original customer run committed five of fourteen rows,
then failed at the existing transaction physical-coordinate guard after658.554s.
The16MiB complete fixture envelope cleared the prior header/proof/request/scalar
allocation failures; no timeout or OOM occurred. Existing field selection passes
a metadata array followed by a raw rowid expression to Knex.select; Knex keeps
only that first array, omitting the required coordinate. Source315 adds a focused
actual composed-source regression through the production current-field helper,
with an independent raw coordinate query, TEXT extent and wrong-ID/cross-user
negative controls. Production remains unchanged for the old-fail proof. All
original eighteen customer/recovery cases and their assertions remain.

The source315 focused actual-source regression reproduces the same missing
physical coordinate after its independent raw integer/row query succeeds.
Source316 spreads the metadata column names into Knex.select, preserving the
additional actual rowid expression. Indexed identity, safe positive physical
coordinate, schema/pointer, owner, allocation and cross-user checks are unchanged.
The same full composed-source regression, including wrong-ID/cross-user negative
controls, must pass before credit. Full customer/current restart/repeat remains
required after this functional correction; a larger allowance is not its fix.

The complete occupied customer case on source318 committed all14 incoming rows, then refused request inventory publication because reconstructed omitted nonnull broadcast counters were represented as NULL while the actual SQL row used its existing false/zero defaults. The exact native SQL regression now compares all reconstructed scalar columns against the real parsed request postimage for omitted, own-undefined and explicit counter variants; the reconstruction is otherwise unchanged pending before/after qualification. This does not qualify the whole workflow or change HEX spelling/matching, product defaults, original expiry, quotas, ownership, or cleanup.

The genuine native SQL postimage regression on319 confirmed exactly two mismatched scalar fields for both omitted/own-undefined counters: actual0n versus reconstructedNULL. Both explicit false/zero and true/retries variants passed. Source320 reconstructs those existing nonnull false/zero insert defaults as0n while preserving all other metadata selection, nullable NULLs, explicit counters and complete equality. Same-regression and complete private/customer requalification remain required.

A separate native request identity review now extracts the existing shared lowercase preparation without changing its semantics and adds an actual occupied-fixture indexed lookup regression. The original uppercase archive spelling, real source row, current journal generation, mapped proof parent and physical coordinate are independently checked. No broad casefold matching or schema change is assumed warranted without the old-fail result; full customer recovery remains unqualified.

The genuine occupied native identity regression on321 confirmed a real existing uppercase archive request (localID1) was missed after preparation lowercased its key. Source322 preserves the original archived spelling for the existing exact indexed query and the independent reconstructed inventory. Same-page alias detection remains lowercase; cryptographic comparisons, schema, index enforcement, ambiguity refusal, physical coordinates, current parent/generation/clock and full original controls remain. This is removal of an introduced key rewrite, not a general case-insensitive schema/migration or scan fallback. Same-regression and whole workflow qualification remain required.

Full customer source322 now resolves its real existing request, but stops at the occupied source's initial lowercase-only64HEX guard after12/14 rows and1057.092s, without timeout/OOM. The guard is exposed unchanged for exact-format regressions (valid lowercase, uppercase, mixed; malformed lengths, whitespace, newline, nonhex and nonASCII). These pure grammar tests are separate from native source/current/owner/resource qualification; the original full workflow and all previous native cases remain required.

Source323 genuine unchanged guard regressions failed only uppercase and mixed-case (8 passed, 2 failed); the final-newline rejection already passed. Source324 accepts exactly64ASCII hexadecimal characters in any case. Complete occupied-source review also identified its staged JSON probe lowercasing the stored key while comparing the unchanged uppercase argument; only that comparison argument is normalized. The destination query still uses the preserved original literal key with its mandatory index and ambiguity refusal. Ownership, source seals, current pointers, immutable admission, clocks, all budgets and complete postimages remain unchanged. Narrow grammar and complete native/customer qualification remain required; static review of the staged comparison is not native qualification.
