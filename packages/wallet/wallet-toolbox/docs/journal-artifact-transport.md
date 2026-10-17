# Candidate journal artifacts

The unpublished #569 implementation now has a distinct immutable journal artifact
producer and SQL storage path. Authenticated remote admission, verified directory
reading, receiver integration, payload reuse and remote primary reconciliation
are still required. This component alone does not complete #544 or establish
production readiness.

A version-three binding identifies `wallet-journal-packets/1`. It records the
actual captured source/profile/schema, exact receipt/high-water/floor, source
primary DATA and requested lower bound. A matching retained position selects
incremental capture. A different binding or collected position selects a complete
current-state bootstrap with the original closure validation. A matching future
position refuses. None of these coordinates reconstructs a live SQL actor,
renews a receipt, authorizes a destination writer or activates a primary.

All thirteen scope streams and both physical global streams are captured from
the same genuine retained source. Each bounded identity prefix is written
separately; even a large notification set does not become an aggregate JavaScript
map. Its frame digest and change index bind it to the subsequent delta frame.
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

Focused tests use a genuine ordinary SQLite WAL source and the actual SQL
artifact store, covering profile separation, complete stream order, retained
hard-delete tombstones, fresh rows, malformed/future positions and delayed
physical close with concurrent foreground SQL. Independent codec vectors retain
the original bytes and signed revisions. Host feedback is advisory; the full
remote, native/MySQL, platform, performance and system program remains open.
