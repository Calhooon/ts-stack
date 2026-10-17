# Candidate journal artifacts

The unpublished #569 implementation now has a distinct immutable journal artifact
producer, SQL storage, durable offered requests and authenticated HTTP source
transport for full and mobile clients. A destination-owned DATA receiver and explicit coordinator are now assembled
in source; their authenticated integration is still under focused feedback.
Ordinary manager pulls and the direct local-source DATA coordinator are integrated.
Verified large-payload reuse and full remote primary reconciliation remain required. This component alone
does not complete #544 or establish production readiness.

## Bounded logical journal fields

The actual SQL capture now exposes an internal `fieldDeltaReader`. Its metadata
page separates supported binary and TEXT cells from small row cells; NULL stays
NULL, and an empty non-NULL field has a zero-byte descriptor. Metadata reads do
not select payload cells. Every extent is at most64KiB and repeats the actual
retained profile, generation, interval, physical membership, field type and logical
length checks. Captured private coordinates remain authoritative when callers
mutate public header copies. A foreground WAL write does not change this view.
Native packed fields report their logical lengths and stored digest DATA rather
than empty SQL markers. Unpacked native TEXT uses the bounded native extent
metadata protocol; ordinary SQLite/MySQL use exact binary/UTF-8 extents.

`preparePackedNativeSnapshotJournalField` connects this reader to the existing
native content owner. It hashes streamed source bytes, replays bounded writes and
independently hashes stored content before issuing a one-use pointer attachment.
An existing sealed version is freshly verified for reuse. Source reads run outside
the native writer. No `WalletReadSnapshot` or SQL source fence is fabricated;
semantic row merge, profile/primary checks and financial ACK remain the actual
caller's responsibility. These internal APIs do not advertise a new remote
capability or change `wallet-journal-packets/1`.

The bounded legacy full-row journal reader now precharges and hydrates actual
native logical fields before encoding; oversized rows still require the field
path. Version-one frames retain leading U+FEFF as exact SQL text, alongside NUL
and astral characters, without changing their existing byte format. Focused host
regressions include a2MiB source, independent hashes, foreground writes, forged
coordinates, expiry/cleanup contracts and NULL/empty/Unicode values. A genuine
native rollback/reuse case is authored but still requires pinned-runtime execution.
Target-owned field cache/semantic promotion and full remote primary
handoff remain implementation work. This source connection is not complete
large-payload sync or whole-system qualification.

## Immutable field artifacts

The actual field producer now captures all fifteen journal streams into a separate
version-four binding and `wallet-journal-fields/1` encoding. A version-two field
frame contains small raw cells plus exact binary/UTF-8 length and SHA-256 DATA;
whole payloads are never inserted into those SQL cells. Separate content packets
carry at most64KiB. The original version-one raw-cell and journal-packet formats
remain unchanged and their strict decoders refuse field envelopes.

Each actual retained field is measured and hashed, including duplicate content.
The producer stores each distinct SHA/length only once, replays bounded extents
and independently rehashes that replay. A mismatch cannot publish its metadata
frame or READY. The directory binds each content packet's frame/change/field,
kind, whole-content hash, offset and length into the exact archive chain. Its SQL
index query reads at most4KiB of each content header rather than the full payload.
This lets the native receiving cache locate required chunks and skip already
verified content; an index or hash cannot authorize cached bytes or an ACK.

Identity capture rereads and compares the actual small-cell page in the same
pinned view. Notification documents use a private streamed JSON index, retaining
last-duplicate-member behavior and legacy invalid-ID filtering. Batches visit at
most64 candidates and resolve actual indexed profile membership before capturing
identities. Private temporary logical/physical storage is bounded to64MiB, member
count to one million and shared working allocation to16MiB. Both EOF digests and
physical index cleanup precede source completion; no complete notification object
or wallet-sized ID map is allocated.

The new artifact methods share the original eight archives,128MiB aggregate,
32MiB per artifact,4096 packets and1MiB packet ceilings. They retain actual SQL
capacity transactions, writer tokens and source receipt expiry. Old row/journal
APIs refuse field artifacts. Cancellation after an actual prefix commit preserves
the cancellation error, drains the actual source and removes provisional staging.
Replay corruption and forged small-row metadata refuse. Leading U+FEFF remains
exact text in natural identity DATA as well as raw frames.

Focused host tests cover a2MiB multichunk value reused across two source fields,
a notification document over1MiB with257 candidates, foreign-profile filtering,
exact Unicode/NUL values, foreground writes, closure-before-READY, incremental
hard deletes, future positions, integrity-bound index tampering and failure
cleanup. The new large fixture passed in23.88s and later exceeded its original
30s case guard under type-reader contention; only this new complete case now has
a60s guard. Existing tests/benchmarks, production lifetimes and limits are unchanged.

## Bounded destination custody postimages

Current-row ownership checks keep small raw rows on their original path. Larger
rows read actual small SQL cells and explicit logical binary/TEXT extents from
the same locked destination transaction. Each chunk is at most16KiB; TEXT decodes
strict UTF8 including leading U+FEFF. Every byte contributes to the fingerprint.
Packed length/hash metadata only selects a candidate: actual streamed bytes are
hashed to EOF and compared with the stored descriptor. No schema verdict survives
the operation, and the original profile/key/index/generation checks still apply.

Source paging and destination custody share a bounded SQL primitive module;
destination custody does not import the snapshot/source orchestrator. Fixed table
coordinates are immutable DATA, and schema/mode checks remain fresh per operation.

The fingerprint retains the exact raw-v1 header/cell/type/column-order spelling,
including the four-byte header length and raw binary suffixes. It hashes that
spelling in bounded windows instead of constructing a frame. Historical small-row
fingerprints remain identical; no wire frame ceiling or persisted schema changes.
Returned large rows expose small cells plus explicit measured field descriptors;
they are not complete financial DTOs. A transient4MiB hashing reservation drains
on success or failure while retained metadata keeps its own charge under the
original16MiB operation allowance. This closes the large postimage/custody read
gap; complete field-aware financial effects and durable byte-cache integration
remain separate requirements. The existing genuine native cache component and
mandatory pair also assert real packed binary/TEXT custody; execution is pending.

## Separate destination field windows

A target-owned destination binding may select the exact `wallet-journal-fields/1`
encoding. That selection participates in its persisted binding digest. Removing
or changing it cannot reopen the window. Existing row bindings retain their exact
encoding and digest. The original row DATA receiver refuses a stored field window
before resume, replacement cleanup or promotion; local row bootstrap also refuses
it. This prevents incomplete metadata from becoming a complete financial row.

Field metadata uses separate staging and promotion-read functions. They retain
the original actual SQL window/primary fence, nonce, ordered fifteen-stream intake,
byte/page quota, payload hash chain and dependency order. A multi-megabyte field
remains an explicit length/hash descriptor in the bounded metadata frame. Neither
staging that descriptor nor reading it for promotion proves content custody or
issues a financial acknowledgement. Complete field-byte custody and semantic
promotion are still separate implementation requirements.

The separate internal field promotion batch uses the original atomic partial
cursor, captured-frame completion check and fresh window fence. A failed outer
commit rolls back effects and cursor together. A lost reply is recovered from
that durable cursor; replaying an older cursor refuses before effects. The old
row batch refuses field windows. The field effect still must supply complete
content, identity, proof and merge policy; this cursor component does not itself
perform financial promotion or primary selection.

## Native journal transaction and output effects

The internal native action preparer now accepts an actual issued authenticated
field frame and the actual target's staged promotion receipt. It checks that
stored frame and completed captured-identity sidecars in the target window before
preparing content. Target inspection and source HTTP/content preparation occur
in separate scopes; no HTTP runs under the target writer.

The original full-snapshot action kernel is shared with this journal path. It
retains current-row and parent-generation checks, original transaction/output
merge policy, BRC177 reclaim quarantine and genuine one-use native attachments.
Journal effects also retain the original actual identity-transition and membership
boundary, including inherited creation custody, missing bootstrap repair and
postimage fingerprints. A changed frame, target window, profile, producer or
current state refuses before financial effects. The field receiver now supplies the shared outer promotion kernel and proof
component. Remaining request/simple-field components, complete provenance,
ordinary SQL byte cache and manager routing still need integration; this internal component alone does not
supply a complete-window financial ACK or primary handoff. Native execution is
pending full feature assembly.

## Native preparation from actual field artifacts

`preparePackedNativeSnapshotArchiveField` accepts only a frame issued by the
actual opened authenticated artifact. It obtains descriptor DATA from that
frame's private original bytes. Copied metadata cannot enroll as a frame or a
native producer. Actual ready-status calls precede and follow preparation; HTTP
never runs inside a native writer.

The real native writer may select an existing SEALED content version by hash and
length, but this is only a candidate lookup. It acquires an actual prepared-field
lifetime and independently hashes every stored byte to EOF under a fresh owned
read-only view. Cached TEXT also decodes actual target bytes to EOF. This permits
verified reuse without downloading content packets again. A miss retains the
original source hash, replay hash and independently verified stored EOF. Actual
producer/schema/expiry checks, one-use attachment, rollback consumption and
cleanup ownership remain required; no copied seal or hash grants an attachment.
Original snapshot and retained-journal callers retain their original source
passes and checks.

The genuine native/HTTP case checks independent bytes, pointer rollback,
consumed actors, cold downloads and zero content downloads on verified reuse.
The shared native/HTTP oracle also runs from an appended case in the already selected `NativeSnapshotReadContractsNode.test.ts` component suite, while retaining the full two-profile functional case. Both paths are authored and typechecked, not executed or qualified yet. Both new field/native cases now have separate mandatory CI cohorts. The explicit original18 case/name/pattern/order baseline is preserved; the complete pair union is20 cases and the complete wallet matrix is58 lanes. Source registration and47 passing routing/orchestration tests do not qualify either native case. This internal
preparation does not supply a financial row merge, parent/proof/primary policy
or ACK. Durable target-window integration and ordinary SQL/MySQL field cache
promotion still require implementation.

## Authenticated field transport

Full and mobile clients negotiate the distinct `snapshotJournalFieldArchive`
capability and open it with `openSnapshotJournalFieldArchive`. The version-four
server-offered tuple uses its own digest domain and actual durable offered row;
absent, collected, changed or foreign tuples cannot acquire a source. The original
row/content/version-three namespaces remain strict and unchanged. Existing
AuthFetch authentication, compact binary framing, request/response bounds,
per-I/O deadlines, source guard, quotas and immutable expiry remain required.
Native source RPC stays unavailable until its separate durable guard contract is
implemented and qualified.

`RemoteSnapshotJournalFieldArchive.readFrame` verifies metadata and identity
prefixes while skipping indexed content packets. The returned page is detached
DATA. Only its actual issued frame can select `readFieldExtent`; copied frames,
changed public metadata and getter-bearing field coordinates cannot enroll.
Extents are at most64KiB and may cross packet boundaries. Every fetched packet
matches the verified directory and its content index. A zero-length extent still
checks the actual ready request without fetching content. Callers must hash a
complete field independently before admitting it to a target-owned cache.

The concrete remote lease retains one in-flight operation through identity
consumer completion, cancellation and real remote cleanup. It exposes no
`readPage`, source SQL fence, writer, activation or financial ACK. The bounded
consumer example lives in `test/consumer/snapshotJournalArchive.ts`.

Focused host cases exercise both clients, full/incremental source capture,
retries, authentication, old-peer opt-out, corruption, in-flight consumers,
cross-replica physical closure and a2MiB multichunk field. These are component
checks, not pinned-native, MySQL, packed-consumer or whole-system qualification.
Target-owned verified cache/semantic promotion and full remote primary handoff
remain implementation work. An immutable field artifact must never masquerade
as a live SQL source or supply a commit fence.

A version-three binding identifies `wallet-journal-packets/1`. It records the
actual captured source/profile/schema, exact receipt/high-water/floor, source
primary DATA and requested lower bound. A matching retained position selects
incremental capture. A different binding or collected position selects a complete
current-state bootstrap with the original closure validation. A matching future
position refuses. None of these coordinates reconstructs a live SQL actor,
renews a receipt, authorizes a destination writer or activates a primary.

A separate version-three reader tuple binds its random server nonce, immutable
deadline, byte reservation and requested binding/high-water in a distinct digest
domain. The actual authenticated offered SQL row is required before claiming a
source; a recomputed digest or absent tuple cannot create admission. Replicas
share the same durable claim, position and completion. A journal offer cannot
become a row/content capture or silently choose another incremental lower bound.
The original reader/start parsers retain their closed version-one/two contracts.
Physical source closure still precedes ready, cancellation keeps exact tuple
matching, and collected journal offers cannot be re-created by reader admission.

All thirteen scope streams and both physical global streams are captured from
the same genuine retained source. Small identity callbacks coalesce into one packet, bounded to128identities and
one MiB; a large notification set still flushes separate bounded prefixes. The
actual SQL source has an optional DATA-observer hook that may finish synchronously
or return a real prefix-flush promise. Its original asynchronous local writer
callback remains unchanged, and the DATA hook cannot borrow that reentrant SQL
writer fence. No resolved-promise yield is inserted. Its frame digest and change index bind it to the subsequent delta frame.
The SQL packet label and directory include packet kind and scope/physical stream
within the existing64-character column. This metadata enters the exact archive
hash chain. The verifier checks every receipt, exact binding JSON, identity,
network, schema, expiry and all fifteen terminal streams. A bounded frame-ordinal
index distinguishes real intake frames from zero-row identity prefixes, so a
receiver can locate its durable intake sequence without a payload/OFFSET scan.

Dates, raw binary cells, tombstones, signed 64-bit revisions and exact UTF-8
identities retain the original delta encoding. The frame codec and shared
receipt hash operate without Node's global Buffer. The receipt digest's exact
preimage remains unchanged.

The original auxiliary archive capacity accounts for both artifact kinds. Limits
remain eight archives, 128 MiB total reservation, 32 MiB per artifact, 4,096 pages
and one MiB per packet. Identity prefixes consume charged pages and bytes but
count as zero copied wallet rows. A separate fifteen-stream completion condition
seals journal artifacts; they never satisfy the thirteen-table row-archive API.
New row-archive inspect/directory/read/append/seal calls refuse journal artifacts.
An older reader's existing strict binding parser also refuses version three.

Every append still owns the original SQL capacity transaction and optional
request-owner authorization. Journal payload/context/counts are checked against
the actual durable next stream. Artifact expiry cannot exceed the original
journal receipt, including the final admission transaction; it is never extended
for a slow copy. No schema reset, new native pin or raised resource limit is
introduced.

Ready publication follows actual source verification and physical closure.
Cancellation, malformed positions and capture errors drain that real source.
Failed physical cleanup retains the reservation; a rejected read or copied DATA
cannot prove that cleanup succeeded. Ordinary staging cleanup after a proved
close preserves both original and cleanup errors. Public source coordinate
getters return detached copies of the private captured values.

`StorageClient.openSnapshotJournalArchive(identityKey, position?, options?)` and
its mobile counterpart negotiate a separate `snapshotJournalArchive` capability.
The original row/content capability and strict parsers remain unchanged. A
mixed-version peer or `snapshotArchives: false` returns no journal artifact.
The new HTTP namespace retains authenticated compact binary framing and the
existing request/response limits. The current journal receipt policy can reduce
its advertised maximum lifetime; it cannot extend the original archive limit.

Opening completes the real offer/admit/status flow and verifies the complete
ready directory before returning an owner. `readFrame(ordinal, captureIdentities)`
verifies the frame and its bounded identity prefixes against that directory.
Frame ordinals exclude prefix packets and can be replayed without recapture.
The owner retains the actual in-flight network operation and identity consumer
through cancellation, then requires the server's original physical cleanup
acknowledgement. The server rechecks the durable ready request after reading a
packet or directory. Authentication, corruption and cleanup failures do not
become compatibility fallback. Metadata getters return detached DATA.

This owner deliberately has no SQL commit/current-data fence or full-row snapshot
API. It does not acknowledge a destination write, select a primary or establish
that the immutable captured high-water is the source's current state. Those
operations require their separately admitted destination/current endpoint
protocols. Existing local source fences retain their original behavior.

Focused tests use a genuine ordinary SQLite WAL source and the actual SQL
artifact store, covering profile separation, complete stream order, retained
hard-delete tombstones, fresh rows, malformed/future positions and delayed
physical close with concurrent foreground SQL. Independent codec vectors retain
the original bytes and signed revisions. Real authenticated HTTP cases exercise
both clients, complete fifteen-stream reading, incremental hard-delete
tombstones, same-frame retries, detached metadata, unissued/foreign refusal,
disable negotiation, packet corruption and cancellation with a held consumer.
Host feedback is advisory; the full
remote, native/MySQL, platform, performance and system program remains open.

## Candidate destination DATA protocol

The separate `snapshotJournalData` advertisement permits actual authenticated
`openSnapshotJournalDataDestination(identityKey, sourceBinding, signal?)` admission.
The server resolves its current physical backend, schema, user, network, primary
epoch and durable window itself. A replacement controller recovers the binding
and checkpoint from SQL; it never deserializes an actor or trusts a supplied
schema verdict. New source scopes are bounded to eight per profile. Source primary
coordinates remain provenance DATA and cannot activate the destination.

A bounded packet may stage identity prefixes without advancing intake. A complete
frame seals their digest/index associations and commits original provenance,
staging, progress and the intake ACK atomically. The receiver refuses a row with
a different source profile. Actual proof frames pass the existing RPC active-chain
policy outside the target writer; semantic promotion independently prepares and
binds the real candidate before applying it. A refreshed proof verdict never
rewrites an integrity-bound source frame or becomes a serialized grant. The local
live-source receiver retains its original SQL fences while sharing this same
semantic promotion code, including withdrawal, lineage, retirement and cleanup.

Packets above the existing512KiB inline bound use the existing durable transfer
store in262KiB parts, with a one-MiB journal-packet bound. The original one-MiB
request,16KiB response and30s per-I/O deadlines remain. At most eight destination
operations run per controller, including the original row/content namespace.
A real provider queue owns short DATA target operations; neither HTTP nor proof
work runs inside that queue's physical writer. Transfer cache DATA is checked
against actual destination custody and cannot replace a financial ACK. Cleanup
awaits the real transfer release and exposes a retryable cleanup owner on failure.

`runSnapshotJournalArchiveReconciliation` connects a verified immutable source to
an independently admitted local or authenticated remote DATA destination. It uses
frame ordinals, sends bounded prefixes, and recovers uncertain replies from the
destination's actual status. The existing coordinator retains real source cleanup
and cancellation/progress semantics. The ordinary manager pull path uses this coordinator. Remote primary selection
remains implementation work, and full system qualification is still pending.

## Ordinary manager integration

SQL providers now expose DATA receiver negotiation, actual stored status and
manager-admitted receiver opening. Full/mobile clients expose the corresponding
authenticated operations. Status is comparison DATA; it never opens a writer.
The manager can route a negotiated remote journal artifact to its local DATA
receiver, retaining its original auth/generation/provider membership checks and
progress/observer/error/cleanup behavior. Source I/O and remote dispatch run
outside that queue. A target generation that cannot extend the requested lineage
returns an explicit bootstrap-required refusal before mutation. The manager may
then open one new complete source/closure and seek actual admission again; an
observer throwing a similar error cannot trigger that retry.

A genuine local retained source can also feed `runSnapshotJournalSourceDataReconciliation`
directly. Its real read owner remains local and is physically drained on exit;
only bounded DATA packets go to the endpoint. Neither source SQL commit nor
current-data fences are invoked across HTTP. This avoids an unnecessary local
artifact store. The existing local-to-local journal path is preserved.

Ordinary pushes retain their existing safe primary-propagation path while full
remote primary cutover is unfinished. The explicit DATA coordinator does not
activate a primary. These additions remain under focused feedback, not full
feature/system qualification. Verified large-field reuse and complete remote primary coordination still require
source work. The DATA no-change contract below remains subject to final system qualification.

## Confirmed unchanged DATA copies

The separately negotiated `snapshotJournalDataContent` capability supports a
previous actual completed journal checkpoint. A producer binds its content
revision from the same retained source used for its artifact or direct DATA
stream. The destination records pending comparison DATA during BEGIN, and
completes that record in the same physical SQL transaction as the final financial
journal ACK. It independently reads its actual postimage there. A lost completion
reply is recovered from actual SQL custody.

A later manager pull first obtains that completed receipt, physically drains a
fresh source metadata observation, then asks the destination to compare its
current postimage inside its actual admitted writer. Only matching source and
destination revisions return `SyncSessionResult.noChangeJournalReceipt`. The
result reports zero pages/inserts/updates and names the **previous** actual
journal checkpoint. The observation still owns and drains a real bounded source;
no new artifact or financial ACK is created. Cancellation, auth, root, schema,
profile and primary checks remain active.

If the source matches but the destination has drifted, the manager requests a
new complete bootstrap rather than acknowledging an empty incremental window.
A genuinely missing self row can be recreated only after both its semantic key
and old primary key are proved absent in the same physical writer. Its original
association and membership pass through the existing charged retirement path.
A reused/occupied primary key still refuses and retains its current row. Parent
identities retain their original strict verification.

The additive `2026-10-17-002 add journal DATA copy receipts` migration owns
`snapshot_sync_journal_data_receipts`; it does not change the financial schema,
old full-snapshot receipt or native baseline. Its live SQLite/MySQL definition
is revalidated before use. Older installations can continue without this
optional comparison table. Down migration verifies the exact auxiliary schema
before dropping it; it never rolls back an acknowledged wallet merge.

## Local journal quiescence and primary-aware comparison

The original live SQL journal receiver now records the copied source revision
outside destination ownership, then writes pending comparison DATA inside its
original genuine source commit fence. Final receipt completion shares the actual
financial ACK transaction. Local ordinary pulls use the same fresh source/target
comparison as DATA pulls; their actual source writer fences remain intact.

An unchanged local push or registered backup retains a fresh genuine current
source. Its `withCurrentDataFence` owns only the final short actual target
comparison, inside the real manager queue. The target independently checks its
current profile, primary, postimage and prior completed ACK. A source write after
capture declines reuse and the normal coordinator opens a new copy. The result
names the previous real checkpoint and copies zero pages; no new financial ACK
or primary selection is manufactured. Foreground operations remain available
while the source opens, and cancellation drains that real source before stopped
is reported. Observer errors retain their normal error channel.

The existing actual primary-selection writer first verifies that the copied
postimage has not drifted. If it has, selection declines and the manager repairs
another window. After a real selection, the same physical writer records its
actual new primary/postimage in the comparison record. It preserves the original
source stamp and financial ACK. This cannot stamp unrelated target drift as
successfully copied data.

`SnapshotJournalPrimaryContentProvider` is an optional local comparison contract.
It is not a remote primary capability or a wire grant. Actual remote primary
handoff and verified large-payload reuse remain unfinished, and final native,
provider, platform, performance and whole-system qualification remains required.

## Owning mutation and browser selection

The field/DATA/receipt implementation now appends coverage inputs and tests to
eleven existing mutation targets and four reviewed component selections. All97
target identities remain (61 are wallet targets); all86 other targets are
unchanged. A before/after check preserves every original mutation path, input,
test and broader-universe prefix, plus every other runner/corpus/seed/threshold
control. No campaign result is inferred from registration.

The browser bridge preserves its original60 cases/19 source files and separately
requires the packed-IDB content-receipt case, bringing the inventory to61 cases
and20 files. All22 routing tests pass. Actual native/HTTP field-cache effects
still require genuine component/functional execution and original mutation
coverage/score gates; copied actors and ordinary SQL connections cannot stand in
for the native producer. Later runtime components must extend their owning
registrations too before final qualification.

## Field receiver intake

The version-4 receiver uses the same actual target-window lifecycle as the
version-3 row receiver, through a shared internal window controller. Both retain
fresh physical schema, profile, backend, primary, nonce and allocation checks.
The row receiver still refuses field windows. A replacement field controller
resumes only its actual persisted field binding; a source metadata object
cannot create an SQL source or select the target primary.

Field intake reads the genuine authenticated archive outside target writer
admission, fences each bounded identity prefix in its actual writer, verifies
actual issued frame membership and digest, and seals/stages metadata plus intake
progress atomically. A large field remains an explicit length/hash descriptor;
its absent payload is never represented as a complete row. Intake does not
write financial rows or complete a content receipt. Deferred sync-state
provenance currently refuses until complete verified byte custody is available;
no cursor advances over omitted provenance. The complete field promoter, other
field semantic merges, remote primary handoff and full-system qualification
remain unfinished.

Field promotion now shares the original row receiver's bounded retirement,
withdrawal, bootstrap cleanup, durable partial cursor and final acknowledgement
kernel. Complete fieldless rows use the original semantic merge only after an
explicit empty-descriptor check; no missing payload is treated as a complete
row. Genuine issued archive ownership is checked before any intake prefix is
persisted, and promotion compares reopened authenticated identity prefixes with
the original sealed target capture through bounded indexed point reads.

Native transaction/output effects use actual prepared field attachments. Native
proof effects retain complete streamed transaction framing/hash, SDK Merkle and
current active-header validation outside the target writer, followed by fresh
actual current-generation checks and the original native proof write/map and
proof-artifact invalidation inside the atomic writer. Verified prepared content
feeds the cryptographic reader, permitting real cache reuse; source reentry
still touches both original field descriptors through the authenticated lease.
Prepared ownership and physical cleanup remain real and retryable on failure.

The full native request/history/notification and other payload/provenance
components, ordinary SQL large-field custody, manager field integration and
remote primary handoff remain implementation work. Unsupported field effects
refuse without advancing their financial cursor. This component is not a claim
of complete field support or final-system qualification.

Focused host receiver regressions cover complete semantic row application, ID
remapping, an independently lost reply after the actual final SQL commit, durable
ACK recovery, captured-identity tampering before financial effects and successful
resume after exact restoration. The existing selected native cache component
and complete functional pair additionally author a genuine authenticated
proof/action roundtrip with independently expected large binary/UTF8 bytes and
unchanged primary selection. Those new native financial assertions still require
pinned execution; their original cache, rollback, reuse, case/cohort and lifetime
controls remain intact.

Proof association verification accepts the exact captured TXID spelling used by
native field effects and the lowercase spelling produced by the existing
complete-row proof validator. Each is a bounded byte-exact indexed lookup and
must identify the same acknowledged physical row; no full-table case-fold scan
or source metadata rewrite is introduced. A genuine SQL regression reproduces
the former mixed-case refusal, checks both accepted spellings and rejects a
changed physical proof key.

The native journal proof reader explicitly enables the same two indexed key
spellings during preparation and final current-row checks. Existing full-snapshot
callers retain their exact-key default. Byte-identical, cryptographically equal
proofs preserve their actual current row and stored spelling; a changed proof
retains the existing physical ID and current TXID spelling. The genuine native
roundtrips independently canonicalize their current proof in real SQL before
opening the original uppercase source, then require one unchanged proof ID and
no duplicate global row. These assertions are authored, not yet executed.
