# Candidate durable primary handoff control

This unpublished component implements local SQL preparation and source retirement.
It does not yet implement complete target activation, manager/RPC recovery or
complete #544 delivery. Do not use this partial control for an operational switch.
The actual destination financial receipt and postimage must be integrated before
a target may activate; DATA claiming retirement or completion is insufficient.

## Local control and compatibility

`StorageProvider.getPrimaryHandoffControl()` returns an optional capability.
Migrated supported Knex stores expose `status`, `prepareSource`, `prepareTarget`
and `retireSource`; older/disabled/unsupported providers return no capability.
No new control RPC or remote support is advertised by this component. The methods
own short real SQL transactions, bind the actual provider/root/network/user, copy
authentication primitives before awaiting, and ignore caller `isActive` claims.
No SQL connection, transaction or manager admission survives a method call.

A source prepares a unique operation/target against its current actual primary
epoch. A bounded canonical plan binds up to eight source identities and original
epochs to one target. Preparation reserves a durable intent; it does not stop
source financial work. Target preparation parks an existing writable target on a
participating source, fencing old target operations. Source retirement takes the
same actual user/epoch lock order as ordinary financial writers, changes its
actual selection and epoch, and commits the original intent. Repeated commands
are idempotent; a competing operation, target or epoch refuses. Other profiles
remain independent. No method here activates a target or issues a financial ACK.

Status/plan objects are comparison metadata, not serialized backend permission.
Retirement cannot auto-reactivate after an uncertain reply. Activation, completion,
post-retirement copies, durable ACK/postimage checking, manager inactive-cutover
admission, remote control and restart recovery remain required.

## Forward schema and enrollment

`2026-10-18-001 add durable primary handoff control` adds only the auxiliary
`wallet_primary_handoffs` table and two exact role-control triggers on `users`.
SQLite/MySQL migration installation is recoverable after interruption; partial or
changed schema/trigger definitions refuse control. Postgres retains the existing
explicit no-op migration/serialized compatibility contract. Native support still
requires original actual-backend qualification; no C/ABI/pins change is implied.

Migration alone enrolls no profiles. Calling preparation explicitly enrolls that
profile. Unenrolled users retain legacy role updates; enrolled users cannot change
primary selection through old `setActive`, generic DATA merge or an old binary's
raw user update. The actual control writer supplies a one-use role transition in
its own SQL transaction; the database consumes it during that same update. A
failed statement rolls back role, epoch and intent together. No-op replication of
the actual selected primary remains valid. Operational intent is not BRC-38/39
wallet DATA and must not be imported to mint primary control.

Keep enrolled profiles on control-aware software for future primary changes.
Ordinary operations on their actual selected primary remain compatible. Schema
removal is refused even when currently empty: MySQL DDL commits implicitly, so an
emptiness check cannot fence concurrent enrollment through trigger removal. Use
forward recovery and preserve intents/guards. Complete activation/recovery and
provider/old-client compatibility probes before any rollout or enrollment.

## Evidence still required

Current SQLite component cases cover independent controllers, idempotent source
retirement, target parking, conflicting intents, original-epoch refusal, actual
legacy database guard enforcement, rollback, authentication isolation, changed
triggers and a genuine wallet createAction suspended across retirement. They do
not qualify target activation, RPC, production deployment, native/MySQL behavior
or the full fault/performance/platform programme. Those remain required along
with complete diff review and exact-head CI after full feature assembly.
