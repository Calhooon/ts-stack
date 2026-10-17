# Candidate journal artifacts

The unpublished #569 implementation now has a distinct immutable journal artifact
producer, SQL storage, durable offered requests and authenticated HTTP source
transport for full and mobile clients. A destination-owned DATA receiver and explicit coordinator are now assembled
in source; their authenticated integration is still under focused feedback.
Ordinary manager integration, verified large-payload reuse and full remote
primary reconciliation remain required. This component alone
does not complete #544 or establish production readiness.

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
and cancellation/progress semantics. This explicit candidate does not yet wire
ordinary manager copies or remote primary selection; those remain implementation
work, and full system qualification is still pending.

## Ordinary manager integration in progress

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
feature/system qualification. Verified large-field reuse, DATA no-change receipt
integration and complete remote primary coordination still require source work.
