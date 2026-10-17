# Candidate journal artifacts

The unpublished #569 implementation now has a distinct immutable journal artifact
producer, SQL storage, durable offered requests and authenticated HTTP source
transport for full and mobile clients. Destination receiver integration, payload
reuse and remote primary reconciliation are still required. This component alone
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
