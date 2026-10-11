# #544 candidate delivery and rollback

This guide describes the unpublished Toolbox 2.15.0 source candidate. It is not
a release or qualification receipt. PR569 remains open and unmerged. The
[implementation map](./implementation-544.md) names the source components and
authored coverage. Complete that graph and its qualification selectors before
executing the qualification sequence below.

## Artifact and compatibility boundary

Deliver matching Node, client and mobile packages from one reviewed commit.
Build emitted declarations, examples, the dedicated browser Argon2 worker and
native/CJS assets through the ordinary package commands. Consumers import public
entry points rather than private schemas. Device backup preferences are shared
only at device level; identity, network, active storage and recovery checkpoints
belong to each profile. `examples/deviceBackup.ts` shows explicit host lifecycle
calls and preference persistence.

Snapshot and raw-binary capabilities are negotiated with the actual peer. Older
providers keep serialized sync and base64 JSON. Postgres retains ordinary wallet
storage and legacy sync; candidate SQLite/MySQL auxiliary migrations are no-ops
there. Unsupported snapshots must refuse an explicitly required coherent export
instead of presenting an incomplete archive as complete. BRC-38/39 formats and
root-key versus wallet-data recovery remain unchanged.

`test/compatibility/releasedWalletSync.cjs` selects isolated installed artifacts:
released Toolbox 2.14.5 and candidate 2.15.0, SDK 2.8.11 and 3.2.1, both server and
client directions, Node/client/mobile consumers, and ordinary/raw transport.
Its 48 combinations compare all12 replica families and exclude archived source
sync-state rows from replica checkpoints. It installs nothing. Record package
integrities, installation paths, resolved module/declaration/worker assets and
the exact current candidate commit before invoking it. Additional current release
cohorts supplement this preserved matrix when release metadata changes.

## Persistence and forward rollback

Apply source-owned migrations through the migrator; do not rewrite deployed
migration entries or reset existing wallet data. SQL auxiliary indexes and
journals preserve ordinary wallet tables and legacy checkpoints. A partially
installed generation resumes through its original durable migration/recovery
state. An unsupported or incomplete capability retains the serialized fallback.

The unpublished native generation's `brc38-native-sqlite-source/v1:` record binds
the complete source JSON with SHA256. Its forward protocol verifies every current
source and observer definition before conditionally replacing a historical full
record in the same writer. Standard SQLite keeps the full JSON representation.
Retirement shrinks only the verified, already dropped legacy portion of the
existing array receipt. These internal records establish no profile admission;
older code must retain the existing refusal to downgrade native generations.

Fresh genuine native generations store the eighteen derived snapshot tables as
`WITHOUT ROWID`; operational tables and incremental-BLOB chunks retain their
physical rowids. Existing derived generations keep their exact historical shape.
Local baseline journal/v3 shares observer SQL through an empty view guarded by
the native driver's fresh exact source-trigger comparison. Current code also
reads the complete historical journal/v2 schema without converting it. A prior
driver does not implement that v3 event boundary: retain its refusal to use a v3
profile and use the documented forward fallback, rather than dropping guards or
rewriting persistent data for downgrade. Component checks do not establish full
provider qualification or authorize activation.

Packed IndexedDB v7 has a new namespace. Copy through the negotiated provider
path, independently verify complete records, and retain the original v6 database
for rollback. It is not an in-place conversion. Never point old code at a v7
private profile or delete the original database to force migration.

Native import keeps the archive and composed candidate inactive until explicit
fenced publication/selection. It preserves original source provenance and local
operational state. Incoming-ID reservation advances source AUTOINCREMENT floors;
these bounded holes survive cancellation. Expired-ledger collection does not
lower the floors. Repeated imports/resumes retain the original reservation,
limits, consumed IDs and expiry. Current selection and full data fences must be
rechecked before source retirement or target activation.

The supported operational rollback is forward: set `snapshotSync: false`, retain
the auxiliary schemas/data and use the serialized contract. A native publication
or primary transition that already committed must follow the named durable
recovery path; it cannot be undone by changing an in-memory selector. Do not
downgrade a live database across a migration that explicitly refuses reversal.
Retain source archives and unselected profiles until recovery and cleanup are
verified; a failed physical drain retains its concrete cleanup owner and charge.

## Qualification after source completion

Freeze exact source, compiled siblings, browser assets, native candidates,
declarations, original cases, added selectors and actor/resource inputs. Record
actual host/toolchain identities, original deadlines, memory/process/temporary
storage budgets, and the owner responsible for physical shutdown. Artifact hashes
identify inputs; they do not authorize a process or establish platform behavior.

Use the repository's unchanged required local gates and property/mutation
policies. The ordinary package `build`, `typecheck`, `test`, and `test:property`
commands retain their existing requirements. The client `test:browser` command
includes the complete native browser catalogue and delivered worker. Required
archive/journal crash and MySQL fixtures retain their existing selectors.

Run `bench:snapshot-program` from the core and client packages for the fixed
small, large and large-record matrix. Qualify SQLite, real browser IDB and
authenticated HTTP separately, then in composition: cold, unchanged, incremental,
export/import, high latency, disconnection, cancellation and committed lost ACK.
Compare independent complete data/relationships/tombstones/bytes and preserved
policy values. Record foreground p50/p95/p99, queue/cancellation/ACK times,
wire/query counts, CPU and peak memory. Transaction wall time is not SQL lock
time, and browser heap or a child-close event does not prove process-tree limits.

Build native candidates on their actual host with the source-owned Unix/Windows
recipes. Qualification must bind the exact ABI, executable, addon, supervisor,
filesystem privacy, quota and physical cleanup behavior before populating runtime
pins. Mac, Windows, Linux and mobile suspension/disk-pressure evidence are
separate requirements; another host's binary or a browser fixture cannot replace
them. An unqualified platform refuses native admission and retains supported
legacy/remote behavior.

Reconcile main after local source qualification, rerun checks affected by that
reconciliation, and push the held569 branch. Resolve exact-head CI and reviews to
terminal green. All11 acceptance records need evidence before claiming #544
complete. Package publication, provider rollout and a funded restore/spend require
their explicit operational authorization and infrastructure availability gates.
Keep PR569 unmerged throughout this task.

Fresh native packed versions, field pointers, garbage and prepared lifetimes
use `WITHOUT ROWID` metadata. Physical incremental-BLOB chunks and operational
rows remain ordinary rowid tables. Historical complete schemas remain a
separate exact read variant; mixed definitions refuse. No occupied profile is
rewritten, and a failed candidate must retain the original forward fallback
and retirement protocol. The browser's branch-only 30 percent allowance does
not change native resource or page-geometry limits.

`tools/Brc38NativeQualification.cjs` is an unpublished maintainer component
delivery tool. In a separately attested Linux ARM64 Node24.18.0 ABI137 worker,
its intended CLI accepts only `--sqlite-source /absolute/sqlite3.c` and
`--destination /private/absolute/native-contract`. The destination parent must
be owned/private; existing destinations refuse. Ordinary source build/copier
output is required before using the compiled static pin and descriptor launcher.
The tool runs the original runtime and six independent components, retains
failed evidence, and never edits a pin or enrolls a wallet. Its source and
negative cases now pass all16 in a separately frozen Linux cohort with0skip.
Actual tool runs1/2 fail the original native
RSS assertion after runtime preflight; bounded diagnostics identify the failure.
The current source isolates preparation buffers in a bounded actual build child
and streams digest checks. Interrupted preparation still requires the original
worker owner's physical shutdown; a drained preparation group alone cannot
prove compiler-tree drainage. Run3 passes the runtime and six native components;
delivery still refuses its receipt comparison. The source now requires357 WAL
assertions for the retained fd4 launch (358 pathname-launch assertions minus
one synthetic descriptor close). The original32-FD limit and all fixed native
assertions remain unchanged. Run4 passes the corrected path, including actual
exclusive delivery of the fixed candidate, original runtime and six components,
committed writer loss/recovery, fixture cleanup and independently checked process
group/container drainage. The source/frozen inputs and foreign containers remain
unchanged. The component path is not yet a qualified hosted delivery
path, publication or production activation procedure.

### Complete native source recipes

Native driver source inputs, the exact SQLite dependency cohort, Windows addon
source inputs and original Unix compiler arguments share one immutable internal
`native/source_recipe.cjs`. Source preparation previously omitted four included
local observer/pointer contract files; it now captures the complete same driver
cohort as candidate compilation and packaged artifact copying. Every source plan
records platform, architecture and owned compiler working directory; its relative
arguments use the original candidate recipe and stay within the captured root.
Pure plans cover Linux and Darwin on ARM64/x64. Darwin omits only the Linux
`-D_GNU_SOURCE` and `-ldl` flags, preserving its existing candidate-build behavior.
The controlled preparation worker accepts those actual Unix platforms/architectures
with the unchanged Node24.18.0/ABI137 requirement. Windows source capture uses the
same driver/addon cohort through its separate original qualified-toolchain route.
These are source/build paths; source plans never enroll a host, change a runtime
pin or qualify a wallet. Exact native17 LinuxARM pin remains unchanged. Other host
artifacts/toolchains/supervisors and real qualification remain required. New
regressions inspect every actual captured source/SQLite digest and transitive
include, plus unsupported-target refusal before filesystem work. Compilers and
other operating systems are not executed by those pure plan regressions.
