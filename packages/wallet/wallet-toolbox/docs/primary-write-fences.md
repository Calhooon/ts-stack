# Primary write fences

The unpublished candidate adds an internal operation fence for ordinary Knex
`createAction`, `internalizeAction`, abort, action-batch SQL phases, BRC-177
expiry setup/arming, certificate insertion/relinquishment and output relinquishment. It reads the actual authenticated user, database storage
identity, network and database-owned `snapshot_sync_primary_epochs` value before
asynchronous preparation. It retains comparison values only, with no SQL
transaction, connection or global manager writer during preparation.

Each participating SQL commit takes the actual user/epoch locks before its read
view (or SQLite's real writer reservation), checks the current role and exact
installed ABA trigger, performs the bounded SQL work, and rechecks before commit.
A primary change away and back still rejects an old operation. Role changes made
inside that writer roll back the complete transaction. Only a live transaction
issued by that same captured operation can be nested; copied or escaped tokens
do not establish ownership. The fence creates no source actor, primary grant,
financial acknowledgement or new operational sync state from DATA.

`createAction` shares the original epoch through funding/output writes, known
input claims and failure cleanup. Proof preparation remains outside SQL writers.
An obsolete request cannot perform cleanup against a later primary generation.
`internalizeAction` carries the same epoch through its own financial/ownership
commits, including post-network recipient publication and rollback of spent-input
transitions. Its durable receipt claim remains a separate actual ownership check.
Certificate and output relinquishment use the same operation boundary.

Abort captures before its chain-status lookup. Batch begin/extension, renewal,
resume, manifest persistence, packed/blob uploads and abort use the same
original-epoch SQL boundary. Digest-based commit passes its original capture
through the commit helper; completed-result persistence after network work is
fenced too. Expiry pre-funding and activation pass the original capture through
createAction rather than recapturing after height/anchor preparation. Arming
captures before signature/height work and rechecks inside its final CAS writer.

These checks are restrictions on real SQL operations. `AuthId.isActive` supplied
by a caller does not grant permission; user ID and identity must match the actual
current row. Another profile's role change does not revoke this profile's write.
The source/target sync/import paths keep their separate actual writer admission
and financial semantics; they do not use an ordinary primary write fence to
pretend that an import activates a restored primary.

## Migration and compatibility

No new schema, wire field, native ABI, quota or persisted authority is added.
Supported migrated SQLite/MySQL stores use their existing durable epoch table
and exact trigger. Partial or changed installation fails closed. A supported
older store without that migration, an explicitly disabled snapshot capability,
or a custom provider retains the existing serialized fallback. The internal
transaction callback is additive and cannot be selected by wire data. PostgreSQL
and IndexedDB retain their current behavior until their own implementation is
completed and qualified; this change does not advertise a new capability there.

## Remaining integration and validation

The role transition itself must still demote/fence the old primary before a new
primary becomes writable, with durable recovery for an uncertain remote reply.
These ordinary writer restrictions do not implement that distributed handoff.
Remaining processAction, shared broadcast/notification, background batch
cleanup and expiry/proof-monitor writers still need their own original-epoch
integration, including cross-user proof notifications and publication follow-up. The shared broadcast helper is not
claimed to be fully fenced by this change. Previously committed old-primary work
must be reconciled through actual target state; a caller's failure log is not a
new financial acknowledgement or permission to undo it on another primary.

The owning SQLite regressions exercise a separate controller's role change,
away-and-back ABA, atomic rollback, foreign/escaped tokens, identity mismatch,
profile independence, actual trigger removal/change, a relinquishment suspended
at lookup, real create/internalize/abort preparation races, and old batch
begin/renew/resume/extend/abort requests across an ABA transition. Existing funding
performance assertions retain their one physical transaction oracle. These
component tests do not qualify remote handoff, native/MySQL/IndexedDB behavior,
process crash, full-system performance or production readiness. Complete all
features and integration before the original full qualification campaign.
