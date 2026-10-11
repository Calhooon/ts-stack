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
delivery tool. In a separately attested Linux ARM64/x64 Node24.18.0 ABI137 worker
with an existing qualified static build for that exact target,
its delivery CLI accepts only `--sqlite-source /absolute/sqlite3.c` and
`--destination /private/absolute/native-contract`. The destination parent must
be owned/private; existing destinations refuse. Ordinary source build/copier
output is required before using the compiled static pin and descriptor launcher.
`--check-host` is a separate preflight mode: it checks the actual Node target and
static registry, then emits only its Docker target (`linux/arm64` or
`linux/amd64`). Provisioning compares that target with the actual kernel
architecture before private allocation, dependency downloads or compiler work.
This metadata check does not attest worker isolation or enroll a missing build.
Linux ARM64 and x64 have independently qualified, distinct static component
entries. The original x64 source build passes all thirteen contracts with exact
Node24.18.0, GCC12.2.0 and SQLite3.53.4 inputs, followed by actual original-worker
task/cgroup drainage. Its 1381576 bytes have SHA256
`64384ba37ba21adb443830876658097890d476182086a89b32a8a2cc4cf7266b`.
Missing Darwin/Windows entries still refuse before filesystem/compiler work.
Component qualification does not attest a future worker or the complete provider.
The provisioner selects build and run targets from the actual worker, with no
caller override or emulated-platform substitution. Native resource limits,
original thirteen contract modes and exclusive pinned-descriptor delivery stay
unchanged. No consumer API, wire or database migration is introduced.
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
Pure plans cover Linux and Darwin on ARM64/x64. Darwin selects the worker
architecture explicitly with `-arch arm64` or `-arch x86_64` and omits the Linux
`-D_GNU_SOURCE` and `-ldl` flags. Linux compiler arguments remain unchanged.
The controlled preparation worker accepts those actual Unix platforms/architectures
with the unchanged Node24.18.0/ABI137 requirement. Windows source capture uses the
same driver/addon cohort through its separate original qualified-toolchain route.
These are source/build paths; source plans never enroll a host, change a runtime
pin or qualify a wallet. Exact native17 LinuxARM pin remains unchanged. Other host
artifacts/toolchains/supervisors and real qualification remain required. New
regressions inspect every actual captured source/SQLite digest and transitive
include, plus unsupported-target refusal before filesystem work. Compilers and
other operating systems are not executed by those pure plan regressions.

Candidate builders also check the architecture and executable kind encoded in
actual captured ELF64, thin Mach-O64 or PE32+ image headers before recording a
successful build receipt. Windows checks the staged driver's/addon's actual
bytes against its captured hash and requires the matching executable/DLL kind.
This catches compiler target mismatches, including a Darwin compiler default
that differs from a Node worker running under Rosetta. Header checks are a build
consistency check; they neither fully validate a loadable image nor grant runtime
admission. Synthetic format regressions provide no foreign-host qualification.
The existing runtime pins, protected-path checks and real host qualification
remain required.

### Windows first-artifact bootstrap

`tools/Brc38WindowsBootstrapBuild.cjs` separates first-artifact preparation from
the normal qualified Windows candidate builder. `prepareWindowsBootstrapSource`
captures all actual driver/addon C inputs, fixed SQLite source, bounded exact
Node24.18.0/ABI137 header/import-library inputs and the generated immutable MSVC
policy. It rejects missing/duplicate headers and checks captured Node version
macros. This preparation is pure source DATA on every host and runs no compiler or OS
helper. Before actual Windows compilation the authored PowerShell helper creates a protected actor-only NTFS
build directory before source bytes exist, refusing reparse ancestors and
unprotected or differently owned build parents. Its pathname/ACL observations
are build storage checks, not the runtime native HANDLE identity boundary.

`buildWindowsBootstrap` requires the actual Windows ARM64/x64 Node worker and
compiles the fixed supervisor and addon recipes directly through the reviewed
MSVC path. It uses explicit arguments and environment, no shell, bounded parent
output/deadlines and actual postimage/target checks. It does not require an addon
or supervisor that has not yet been built, and it never runs the new candidates.
The independently controlled isolated Windows worker must already enforce
compiler-tree resources, a finite outer deadline and physical shutdown. A parent
close or termination is explicitly not a compiler-tree drain receipt; every root
is retained even on successful compilation until the original worker physically
stops. A failed child prevents further work and requires that original shutdown.
Preparation-only failure cleanup retries actual retained descriptors before
removing only its own uncompiled source directory.

Bootstrap receipts remain unqualified build DATA: no runtime/artifact/toolchain
registry is populated, no host is enrolled, and no wallet capability is granted.
Actual Windows compiler, DACL/helper, complete process tree, addon/supervisor,
image/handle replacement and runtime cases must be qualified on that host before
fixed artifact entries are committed. Pure capture regressions use real authored
C/SQLite and explicitly synthetic Node dependency DATA, not Windows execution.
The source recipe does not claim an end-to-end or production-qualified Windows
route until the independent worker and actual platform qualification are proved.

### Unix first-artifact contract bootstrap

In an independently controlled Linux or Darwin ARM64/x64 Node24.18.0 ABI137 worker,
`node tools/Brc38NativeBootstrapQualification.cjs --sqlite-source /input/sqlite3.c --output-parent /private/work`
builds the reviewed pinned source and runs the same thirteen original contracts
used by native delivery. It captures and rechecks the actual immutable executable
descriptor, retains failed cleanup for concrete retry, and leaves a bounded
exclusive receipt in its owned root. The worker owner must inspect the evidence
and physically stop the worker before releasing its roots.

Linux launches its retained proc-fd. Darwin compares its actual private build
pathname and private directory to the still-open inode before and after each
contract. The isolated worker owner must exclude other actors with its UID:
these comparisons are not atomic pathname protection or a wallet installation.
The existing macOS runtime still requires its protected root-owned chain. Real
Darwin compilation, contract execution, resource behavior and protected delivery
remain unqualified.

This unpublished maintainer tool resolves first-artifact testing without an
existing runtime pin. Its receipt is comparison data: it installs nothing,
enrolls no host, and cannot authorize wallet execution. Real architecture-specific
resource and worker qualification, reviewed static pins, and protected delivery
remain required. Normal delivery still refuses an absent or mismatched pin.
Limits remain attached to their named resources; first-artifact evidence does
not establish production sizing or justify tighter arbitrary caps.

### Darwin root copy and ordinary-actor qualification

The maintainer source route now separates root file preparation from ordinary
wallet execution. After genuine first-artifact qualification and an explicitly
reviewed fixed Darwin entry, an independently admitted worker can run
`tools/Brc38DarwinNativeInstall.cjs --source /absolute/native-candidate` as root
with Node24.18.0 ABI137. A missing platform pin refuses before filesystem work.
The destination is derived internally:
`/Library/Application Support/BSV Wallet/native/<architecture>/<sha256>/native-contract`.
There is no destination, platform or pin override. Root-owned directory identity,
exclusive creation, streamed exact source/target bytes and immutable mode555 are
checked. Existing files never change. Failed files remain as evidence; failed
actual descriptor closure keeps a concrete retry owner and blocks another copy.
These root/POSIX checks and comparison DATA do not attest Darwin ACLs or enroll a
runtime, host or wallet. Privileged installation requires separate authorization.

The non-root wallet actor then runs
`tools/Brc38DarwinNativeQualification.cjs --sqlite-source /absolute/sqlite3.c --output-parent /private/absolute/directory`.
It selects its actual Darwin architecture and fixed registry entry internally,
refuses an unsafe installed image through the original SDK factory before
compilation, retains that same original protected descriptor across its fresh
source build and all thirteen unchanged contracts, and checks the source and
installed launch postimages before closing it. It does not create or replace an
installed executable. The original SDK checks effective ordinary-actor writes,
including ACLs, and the root-owned path chain at launch; file-copy metadata is not
an ACL or launch verdict. Both phases require the original worker owner's
resource/network/lifetime isolation and verified physical drainage. Source and
Linux private filesystem regressions do not establish actual Darwin behavior.
No Darwin pin, actual root installation, foreign-host execution, production
budget change or completed platform/full-system qualification is supplied here.

### Existing Hyper-V outer worker for Windows bootstrap

`tools/Brc38WindowsBootstrapHyperV.ps1 -Configuration C:\Private\host-options.json -GuestCredential (Get-Credential)` is a maintainer source route for an independently admitted Windows Hyper-V host. It requires an already prepared disposable guest: exact VM GUID, name `ts569-native-windows-bootstrap-<fresh run UUID>` and Notes `brc38-bootstrap/<same UUID>`, initially Off with no VM worker process. It creates no VM, disk, account, runtime pin or paid capacity. The guest's retained local disk and all failure/build directories remain available for inspection.

The host work order uses protocol `brc38-windows-bootstrap-host-work-order/v1` and exactly these fields: `protocol`, `runId`, `vmId`, `architecture`, `guestActorSid`, `hostController`, `guestController`, and `guestConfiguration`. All three source inputs carry integer `bytes` and exact `sha256`; the two guest inputs also carry their canonical local `filename`. The guest controller basename must be `Brc38WindowsBootstrapController.ps1`. `tools/Brc38WindowsBootstrapHost.cjs` validates and freezes this bounded comparison DATA; it cannot authorize a host or SDK descriptor. Actual source/configuration files are separately held read-only and rechecked by the host/guest controllers. Credentials are supplied as a private in-memory PSCredential and never serialized into the work order or receipt.

Before starting that original guest, the host checks static16GiB memory, four CPUs, no virtual NIC, nested virtualization or checkpoints, local file-backed disks without pass-through/reparse paths, disabled guest file-copy integration and disabled enhanced sessions. This adapter currently requires the documented English integration-service name; other host locales and actual architecture availability remain qualification work. It uses [PowerShell Direct](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/powershell-direct), which does not depend on a guest network, to check the actual guest OS architecture and an ordinary, non-System, non-elevated actor SID before launching any existing bootstrap helper or managed compiler preparation.

A fresh SYSTEM scheduled watchdog is registered and read back before VM start, independently of the host controller and guest. Its20-minute deadline encloses startup, PowerShell/.NET preparation and the original nested600-second Node/compiler Job. The controller also checks its own monotonic/UTC deadline, fixed VM settings and watchdog while waiting. Every outcome stops only the same owned VM, observes actual Off state and absence of the captured original VM process using PID plus creation time, and removes its watchdog only after that proof. A failed or unproved shutdown keeps the watchdog and fails; a scheduled task or process-tree receipt alone never proves physical VM shutdown. A30-second shutdown request wait and separate30-second observation window are bounded independently. No VHD, VM, original build root or another actor's task is removed.

The16GiB/four-CPU outer allowance preserves4GiB of OS/controller headroom around the existing12GiB inner Job. The20-minute preparation allowance and60-second watchdog action bound are provisional qualification containment, not measured Windows demand or production recommendations. Actual startup/compiler/controller/recovery/resource/network/token/physical-stop proof, watchdog crash and failed-stop behavior, genuine source/toolchain/artifact provenance and the Windows addon/supervisor/runtime contracts remain mandatory before qualification. This source has not run on Windows or Hyper-V. Linux work-order/filesystem regressions cannot substitute for those results, cannot establish ARM64 Hyper-V availability, and cannot populate the empty Windows registries. The full goal remains unqualified.

### Architecture-specific Linux browser delivery

The source-owned browser delivery CLI now selects a fixed Chrome for Testing
155.0.8059.39 archive from the actual Node Linux ARM64 or x64 architecture. The
existing ARM64 pin and `browserPin` export remain unchanged. The separate x64
pin records the genuine official `linux64` archive:198195769 bytes,309 entries
and416502722 expanded bytes, with the297680200-byte x64 ELF executable. Exact
archive and executable digests are checked before delivery; extraction stays
inside the architecture-specific archive root. Another platform or architecture
refuses before creating a private delivery directory. There is no fallback to
another browser or inferred artifact pin.

Both archives are listed by [Google Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/).
A delivered artifact is data, with `runtimeQualified:false` and
`processTreeQualified:false`. The actual browser catalogue, worker, resource and
physical process-tree checks remain mandatory on an admitted native worker.
The ARM64 CI lane and all case/cleanup bounds are unchanged; source support and
artifact capture do not qualify the complete x64 Docker provisioning script or
the full system. That script requires an actual Docker-capable Linux worker; an
existing containerd-only worker cannot be silently substituted.
