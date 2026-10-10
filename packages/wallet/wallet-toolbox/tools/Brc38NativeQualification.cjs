'use strict'
// Maintainer qualification/delivery only. The caller must provision and attest
// the isolated worker. This tool never enrolls a wallet, changes a runtime pin,
// publishes, deploys, or treats component checks as full provider qualification.
const fs = require('node:fs/promises')
const { constants } = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const cp = require('node:child_process')
const { NativeCandidateBuildCleanupError, sources, sqlite } = require('./Brc38NativeCandidateBuild.cjs')
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

/** Bounded failure DATA for inspection; never a candidate or authority grant. */
function qualificationFailureData(cause) {
  const seen = new Set()
  let remaining = 8
  const visit = (value, depth) => {
    if (value === undefined) return undefined
    if (value === null || typeof value !== 'object') return String(value).slice(-1024)
    if (depth > 4 || remaining-- <= 0 || seen.has(value)) return '[diagnostic bound]'
    seen.add(value)
    const data = {}
    for (const key of ['name', 'message', 'stack', 'stdout', 'stderr'])
      if (typeof value[key] === 'string') data[key] = value[key].slice(-2048)
    for (const key of ['code', 'signal', 'processGroup', 'processGroupGone', 'stopped', 'bytes', 'seconds'])
      if (['string', 'number', 'boolean'].includes(typeof value[key])) data[key] = value[key]
    for (const key of ['cause', 'failure', 'record'])
      if (value[key] !== undefined) data[key] = visit(value[key], depth + 1)
    if (Array.isArray(value.errors)) data.errors = value.errors.slice(0, 4).map(error => visit(error, depth + 1))
    return data
  }
  return visit(cause, 0)
}

function parseQualificationArguments(args) {
  if (args.length !== 4 || args[0] !== '--sqlite-source' || args[2] !== '--destination')
    throw new Error('Usage: --sqlite-source /absolute/sqlite3.c --destination /private/absolute/native-contract')
  for (const value of [args[1], args[3]])
    if (typeof value !== 'string' || !path.isAbsolute(value) || path.normalize(value) !== value || value.includes('\0'))
      throw new Error('Qualification paths must be normalized absolute paths')
  if (args[1] === args[3]) throw new Error('Qualification destination must differ from its SQLite input')
  return Object.freeze({ sqliteSource: args[1], destination: args[3] })
}

/** One bounded actual file, not a pathname verdict or build-receipt grant. */
async function readActual(filename, maximum, digestOnly = false) {
  const file = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
  let failed = false,
    failure,
    bytes
  try {
    const before = await file.stat({ bigint: true })
    if (!before.isFile() || before.nlink !== 1n || before.size < 1n || before.size > BigInt(maximum))
      throw new Error('Qualification file extent or identity differs')
    const extent = Number(before.size),
      hash = crypto.createHash('sha256')
    bytes = Buffer.alloc(digestOnly ? Math.min(65536, extent) : extent)
    for (let offset = 0; offset < extent;) {
      const current = await file.read(bytes, digestOnly ? 0 : offset, Math.min(65536, extent - offset), offset)
      if (current.bytesRead === 0) throw new Error('Qualification file truncated during read')
      if (digestOnly) hash.update(bytes.subarray(0, current.bytesRead))
      offset += current.bytesRead
    }
    const after = await file.stat({ bigint: true })
    if (
      ['dev', 'ino', 'size', 'mode', 'mtimeNs', 'ctimeNs', 'nlink'].some(key => before[key] !== after[key]) ||
      (await file.read(Buffer.alloc(1), 0, 1, extent)).bytesRead !== 0
    )
      throw new Error('Qualification file changed during read')
    if (digestOnly) bytes = { bytes: extent, sha256: hash.digest('hex') }
  } catch (cause) {
    failed = true
    failure = cause
  }
  try {
    await file.close()
  } catch (cleanup) {
    throw new NativeCandidateBuildCleanupError(failed ? failure : undefined, cleanup, () => file.close())
  }
  if (failed) throw failure
  return bytes
}

/** Keep compilation buffers outside the component-launch parent. The original
 * worker owner must physically stop the worker if a build is interrupted;
 * killing this preparation group alone does not prove compiler-tree drainage. */
async function isolatedBuild(sqliteSource, root, calendar) {
  calendar.check()
  const child = cp.spawn(
    process.execPath,
    ['--max-old-space-size=1536', path.join(__dirname, 'Brc38NativeCandidateBuildWorker.cjs'), sqliteSource, root],
    {
      cwd: root,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }
    }
  )
  let stdout = '',
    stderr = '',
    bytes = 0,
    failure,
    stopped = false
  const present = () => {
    if (child.pid === undefined) return false
    try {
      process.kill(-child.pid, 0)
      return true
    } catch (cause) {
      if (cause.code === 'ESRCH') return false
      throw cause
    }
  }
  const stop = cause => {
    stopped = true
    if (cause !== undefined) failure = cause
    if (child.pid === undefined) return
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch (error) {
      if (error.code !== 'ESRCH') failure = error
    }
  }
  const timer = setTimeout(() => stop(new Error('Original native preparation deadline exceeded')), 180000)
  const utc = setInterval(() => {
    try {
      calendar.check()
    } catch (cause) {
      stop(cause)
    }
  }, 100)
  const collect = stream => chunk => {
    bytes += chunk.length
    if (bytes > 16777216) stop(new Error('Original native preparation output bound exceeded'))
    else if (stream === 'stdout') stdout += chunk
    else stderr += chunk
  }
  child.stdout.on('data', collect('stdout'))
  child.stderr.on('data', collect('stderr'))
  child.on('error', stop)
  const result = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })))
  clearTimeout(timer)
  clearInterval(utc)
  if (present()) {
    stop(new Error('Original preparation process group remains'))
    const deadline = performance.now() + 5000
    while (present() && performance.now() < deadline) await delay(25)
  }
  const processGroupGone = !present()
  if (stopped || failure || !processGroupGone || result.code !== 0 || result.signal !== null)
    throw new Error('Native preparation failed; original worker shutdown required', {
      cause: {
        failure,
        record: { ...result, stdout, stderr, bytes, stopped, processGroup: child.pid, processGroupGone }
      }
    })
  calendar.check()
  const receipt = JSON.parse(stdout)
  if (
    receipt.protocol !== 'brc38-native-candidate-build/v1' ||
    typeof receipt.candidate?.path !== 'string' ||
    path.dirname(path.dirname(receipt.candidate.path)) !== root ||
    path.basename(receipt.candidate.path) !== 'native-candidate'
  )
    throw new Error('Original preparation build data differs')
  return { ...receipt, preparation: { processGroup: child.pid, processGroupGone } }
}

async function privateDirectory(directory, expected) {
  const actual = await fs.lstat(directory, { bigint: true })
  if (
    !actual.isDirectory() ||
    actual.isSymbolicLink() ||
    actual.uid !== BigInt(process.getuid()) ||
    (actual.mode & 0o077n) !== 0n ||
    (expected && ['dev', 'ino', 'mode', 'uid'].some(key => actual[key] !== expected[key]))
  )
    throw new Error('Qualification requires its original private directory')
  return actual
}

/** Runs the original pinned inode, retaining its descriptor until real close.
 * A timeout/error is never interpreted as drainage or intentional writer loss. */
async function originalComponent(owner, file, cwd, name, args, calendar, committedKill = false) {
  calendar.check()
  const launchParentPeakRSSBytes = process.resourceUsage().maxRSS * 1024
  const launch = await owner.pinnedNativeLaunchPath(file),
    child = cp.spawn(launch, args, {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ignore', file.fd],
      env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }
    }),
    started = performance.now()
  let bytes = 0,
    stdout = '',
    stderr = '',
    committedInput = '',
    stopped = false,
    failure,
    intentionalKill = false
  const signal = value => {
    if (child.pid === undefined) return
    try {
      process.kill(-child.pid, value)
    } catch (cause) {
      if (cause.code !== 'ESRCH') failure = cause
    }
  }
  const present = () => {
    if (child.pid === undefined) return false
    try {
      process.kill(-child.pid, 0)
      return true
    } catch (cause) {
      if (cause.code === 'ESRCH') return false
      throw cause
    }
  }
  const stop = cause => {
    stopped = true
    if (cause !== undefined) failure = cause
    signal('SIGKILL')
  }
  const timer = setTimeout(() => stop(new Error('Original component deadline exceeded')), 30000)
  const utc = setInterval(() => {
    try {
      calendar.check()
    } catch (cause) {
      stop(cause)
    }
  }, 100)
  child.stdout.on('data', chunk => {
    bytes += chunk.length
    if (bytes > 16777216) {
      stop(new Error('Original component output bound exceeded'))
      return
    }
    stdout += chunk
    if (committedKill && !intentionalKill && !stopped) {
      committedInput += chunk
      const lines = committedInput.split('\n')
      committedInput = lines.pop()
      try {
        for (const line of lines) {
          const record = JSON.parse(line)
          if (record.phase !== 'committed' || record.value !== 41 || record.pid !== child.pid)
            throw new Error('Independent committed writer identity differs')
          if (intentionalKill) throw new Error('Independent committed writer repeated its acknowledgement')
          intentionalKill = true
          signal('SIGKILL')
        }
      } catch (cause) {
        stop(cause)
      }
    }
  })
  child.stderr.on('data', chunk => {
    bytes += chunk.length
    if (bytes > 16777216) stop(new Error('Original component output bound exceeded'))
    else stderr += chunk
  })
  const result = await new Promise(resolve => {
    child.on('error', cause => stop(cause))
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
  clearTimeout(timer)
  clearInterval(utc)
  if (present()) {
    stopped = true
    signal('SIGKILL')
    const deadline = performance.now() + 5000
    while (present() && performance.now() < deadline) await delay(25)
  }
  const processGroupGone = !present(),
    passed =
      !stopped &&
      failure === undefined &&
      processGroupGone &&
      !/SIGSEGV|SIGBUS|SIGABRT|Segmentation fault|Bus error|Illegal instruction|core dumped/.test(stdout + stderr) &&
      (committedKill
        ? intentionalKill && result.code === null && result.signal === 'SIGKILL'
        : result.code === 0 && result.signal === null),
    record = {
      name,
      args,
      launchParentPeakRSSBytes,
      processGroup: child.pid,
      ...result,
      stdout,
      stderr,
      bytes,
      stopped,
      intentionalKill,
      processGroupGone,
      seconds: performance.now() / 1000 - started / 1000,
      passed
    }
  if (!passed) throw new Error('Original native component failed: ' + name, { cause: { failure, record } })
  calendar.check()
  await owner.pinnedNativeLaunchPath(file)
  return record
}

/** No platform substitution or execution from a receipt-selected candidate.
 * Exact static build DATA must match; original runtime and all eleven contracts
 * run against the genuine pinned descriptor before exclusive delivery. */
async function qualifyBrc38NativeCandidate(options) {
  if (
    process.platform !== 'linux' ||
    process.arch !== 'arm64' ||
    process.version !== 'v24.18.0' ||
    process.versions.modules !== '137'
  )
    throw new Error('Native qualification requires its admitted Linux ARM64 Node24.18.0 ABI137 worker')
  const parsed = parseQualificationArguments([
      '--sqlite-source',
      options.sqliteSource,
      '--destination',
      options.destination
    ]),
    parent = path.dirname(parsed.destination),
    parentIdentity = await privateDirectory(parent),
    utcDeadline = Date.now() + 360000,
    monotonicDeadline = performance.now() + 360000,
    calendar = {
      check() {
        if (Date.now() >= utcDeadline || performance.now() >= monotonicDeadline)
          throw new Error('Native qualification original finite calendar exceeded')
      }
    }
  // Existing and dangling-symlink destinations refuse before compilation.
  try {
    await fs.lstat(parsed.destination)
    throw new Error('Native qualification destination already exists')
  } catch (cause) {
    if (cause.code !== 'ENOENT') throw cause
  }
  const owner = require('../out/src/storage/portable/Brc38NativeExecutable.cjs'),
    pin = owner.componentBuild
  if (pin.platform !== process.platform || pin.architecture !== process.arch)
    throw new Error('Native qualification static component platform differs')
  const inputs = { sqliteSource: { filename: parsed.sqliteSource, bytes: sqlite.bytes, sha256: sqlite.sha256 } }
  for (const name of sources) {
    const filename = path.join(__dirname, '../src/storage/portable/native', name),
      digest = await readActual(filename, 1048576, true)
    inputs[name] = { filename, ...digest }
  }
  const checkInputs = async () => {
    calendar.check()
    await privateDirectory(parent, parentIdentity)
    for (const input of Object.values(inputs)) {
      const digest = await readActual(input.filename, input.bytes, true)
      if (digest.bytes !== input.bytes || digest.sha256 !== input.sha256)
        throw new Error('Native qualification original source changed')
    }
  }
  await checkInputs()
  const root = await fs.mkdtemp(path.join(parent, 'brc38-qualification-')),
    rootIdentity = await privateDirectory(root),
    fixture = path.join(root, 'fixtures')
  await fs.mkdir(fixture, { mode: 0o700 })
  const fixtureIdentity = await privateDirectory(fixture)
  let executable,
    build,
    failed = false,
    failure,
    delivered,
    pendingTarget
  const records = []
  try {
    build = await isolatedBuild(parsed.sqliteSource, root, calendar)
    if (
      build.candidate.bytes !== pin.bytes ||
      build.candidate.sha256 !== pin.sha256 ||
      build.engineExecuted !== false ||
      build.runtimePinChanged !== false
    )
      throw new Error('Native candidate differs from the independently qualified static pin')
    for (const [name, input] of Object.entries(build.inputs)) {
      const original = name === 'sqlite3.c' ? inputs.sqliteSource : inputs[name]
      if (!original || input.bytes !== original.bytes || input.sha256 !== original.sha256)
        throw new Error('Native build captured different original source')
    }
    if (Object.keys(build.inputs).length !== sources.length + 1)
      throw new Error('Native build source cohort is incomplete')
    await checkInputs()
    executable = await owner.openPinnedNativeExecutable(build.candidate.path)
    records.push(
      await originalComponent(owner, executable, fixture, 'original-runtime', ['--runtime-contract'], calendar)
    )
    if (!records[0].stdout.includes('PASS native runtime resource contracts'))
      throw new Error('Original runtime assertion receipt differs')
    records.push(
      await originalComponent(owner, executable, fixture, 'original-wal-delete-memory-descriptor', [], calendar)
    )
    records.push(
      await originalComponent(owner, executable, fixture, 'original-profile-families', ['--profile'], calendar)
    )
    records.push(
      await originalComponent(
        owner,
        executable,
        fixture,
        'original-private-stage-recovery-purpose',
        ['--private-stage-contract'],
        calendar
      )
    )
    records.push(await originalComponent(owner, executable, fixture, 'original-native-range', ['--range'], calendar))
    records.push(
      await originalComponent(
        owner,
        executable,
        fixture,
        'healthy-committed-writer-loss',
        ['--process-loss-writer'],
        calendar,
        true
      )
    )
    records.push(
      await originalComponent(
        owner,
        executable,
        fixture,
        'independent-committed-wal-recovery',
        ['--process-loss-recovery'],
        calendar
      )
    )
    const wal = records[1].stdout.trim().split('\n').map(JSON.parse),
      recovered = records[6].stdout.trim().split('\n').map(JSON.parse)
    // The original descriptor exhaustion loop checks each synthetic close.
    // Our still-open executable at fd4 consumes one slot compared with the
    // independently qualified pathname launch (358). All fixed assertions and
    // the original 32-FD bound remain unchanged; require exactly this launch.
    const walAssertionsWithRetainedExecutable = 358 - 1
    if (
      !wal.some(
        record =>
          record.assertions === walAssertionsWithRetainedExecutable &&
          record.wal === true &&
          record.rollback === true &&
          record.descriptorIdentity === true &&
          record.fixturesDrained === true
      ) ||
      !records[2].stdout.includes(
        'PASS profile checks=1196 unchangedAggregate=1048576 unchangedWrapperHandles=8 families=3'
      ) ||
      !records[3].stdout.includes('private-stage owner/VFS checks=215 synthetic-only') ||
      !records[4].stdout
        .trim()
        .split('\n')
        .map(JSON.parse)
        .some(
          record =>
            record.stage === 'native-original-range-contract' && record.assertions === 70 && record.passed === true
        ) ||
      !recovered.some(
        record =>
          record.phase === 'recovered' &&
          record.assertions === 25 &&
          record.value === 42 &&
          record.fixturesDrained === true
      )
    )
      throw new Error('Original independent component assertion receipts differ')
    records.push(
      await originalComponent(
        owner,
        executable,
        fixture,
        'shared-quota-dispatch',
        ['--shared-quota-contract'],
        calendar
      )
    )
    if (records[7].stdout !== 'PASS shared-quota dispatch independent guards and rollback checks=306\n')
      throw new Error('Independent shared quota dispatch receipt differs')
    records.push(
      await originalComponent(
        owner,
        executable,
        fixture,
        'independent-cell-change',
        ['--cell-change-contract'],
        calendar
      )
    )
    if (records[8].stdout !== 'PASS independent cell comparison checks=1152 argumentLimit=1000 fixturesDrained=true\n')
      throw new Error('Independent native contract receipt differs: independent-cell-change')
    records.push(
      await originalComponent(
        owner,
        executable,
        fixture,
        'independent-local-observer',
        ['--local-observer-contract'],
        calendar
      )
    )
    if (records[9].stdout !== 'PASS independent local observer forms checks=93 fixturesDrained=true\n')
      throw new Error('Independent native contract receipt differs: independent-local-observer')
    records.push(
      await originalComponent(
        owner,
        executable,
        fixture,
        'independent-local-pointer-projection',
        ['--local-pointer-projection-contract'],
        calendar
      )
    )
    if (
      records[10].stdout !==
      'PASS independent pointer projection coordinates=20 transitions=40 checks=641 fixturesDrained=true\n'
    )
      throw new Error('Independent native contract receipt differs: independent-local-pointer-projection')
    records.push(
      await originalComponent(
        owner,
        executable,
        fixture,
        'independent-local-pointer-group',
        ['--local-pointer-group-contract'],
        calendar
      )
    )
    if (
      records[11].stdout !==
      'PASS independent grouped pointers coordinates=32 transitions=64 checks=994 fixturesDrained=true\n'
    )
      throw new Error('Independent native contract receipt differs: independent-local-pointer-group')
    records.push(
      await originalComponent(
        owner,
        executable,
        fixture,
        'independent-local-observer-names',
        ['--local-observer-names-contract'],
        calendar
      )
    )
    if (
      records[12].stdout !==
      'PASS independent compact observer names sources=47 transitions=423 checks=2784 fixturesDrained=true\n'
    )
      throw new Error('Independent native contract receipt differs: independent-local-observer-names')
    await checkInputs()
    await privateDirectory(root, rootIdentity)
    await privateDirectory(fixture, fixtureIdentity)
    if ((await fs.readdir(fixture)).length !== 0) throw new Error('Original native fixtures remain owned')
    const bytes = await readActual(build.candidate.path, pin.bytes)
    if (bytes.length !== pin.bytes || sha(bytes) !== pin.sha256) throw new Error('Native candidate postimage differs')
    await owner.closePinnedNativeExecutable(executable)
    executable = undefined
    const target = await fs.open(
      parsed.destination,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o500
    )
    pendingTarget = target
    delivered = await target.stat({ bigint: true })
    let writeFailed = false,
      writeFailure
    try {
      await target.writeFile(bytes)
      await target.sync()
      const actual = await target.stat({ bigint: true })
      if (
        actual.ino !== delivered.ino ||
        actual.dev !== delivered.dev ||
        actual.nlink !== 1n ||
        actual.size !== BigInt(pin.bytes)
      )
        throw new Error('Native exclusive delivery inode differs')
      delivered = actual
    } catch (cause) {
      writeFailed = true
      writeFailure = cause
    }
    try {
      await target.close()
      pendingTarget = undefined
    } catch (cleanup) {
      throw new NativeCandidateBuildCleanupError(writeFailed ? writeFailure : undefined, cleanup, () => target.close())
    }
    if (writeFailed) throw writeFailure
    executable = await owner.openPinnedNativeExecutable(parsed.destination)
    await owner.closePinnedNativeExecutable(executable)
    executable = undefined
    await checkInputs()
    const receipt = {
      protocol: 'brc38-native-component-delivery/v1',
      finishedAt: new Date().toISOString(),
      inputs,
      build,
      pin,
      records,
      originalRuntimePassed: true,
      originalComponentsPassed: 6,
      additionalSharedQuotaPassed: true,
      additionalSharedQuotaChecks: 306,
      additionalCellChangePassed: true,
      additionalCellChangeChecks: 1152,
      additionalLocalObserverPassed: true,
      additionalLocalObserverChecks: 93,
      additionalPointerProjectionPassed: true,
      additionalPointerProjectionCoordinates: 20,
      additionalPointerProjectionChecks: 641,
      additionalPointerGroupPassed: true,
      additionalPointerGroupCoordinates: 32,
      additionalPointerGroupChecks: 994,
      additionalObserverNamesPassed: true,
      additionalObserverNamesSources: 47,
      additionalObserverNamesTransitions: 423,
      additionalObserverNamesChecks: 2784,
      originalFixturesDrained: true,
      destination: parsed.destination,
      destinationSha256: pin.sha256,
      outerWorkerAttested: false,
      wholeOsProcessTreeQualified: false,
      physicalRSSQualified: false,
      providerQualified: false,
      fullSystemQualified: false,
      runtimePinChanged: false,
      publicationOrDeployment: false
    }
    await fs.writeFile(path.join(root, 'component-delivery-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o400
    })
    return receipt
  } catch (cause) {
    failed = true
    failure = cause
  }
  const cleanup = []
  if (pendingTarget !== undefined) {
    try {
      await pendingTarget.close()
      pendingTarget = undefined
    } catch (cause) {
      const retained = pendingTarget
      cleanup.push(new NativeCandidateBuildCleanupError(undefined, cause, () => retained.close()))
    }
  }
  if (executable !== undefined) {
    try {
      await owner.closePinnedNativeExecutable(executable)
    } catch (cause) {
      cleanup.push(cause)
    }
  }
  if (delivered !== undefined && pendingTarget === undefined && cleanup.length === 0) {
    try {
      await privateDirectory(parent, parentIdentity)
      const actual = await fs.lstat(parsed.destination, { bigint: true })
      if (actual.isSymbolicLink() || actual.dev !== delivered.dev || actual.ino !== delivered.ino)
        throw new Error('Failed native delivery path was replaced; original worker cleanup required')
      await fs.unlink(parsed.destination)
    } catch (cause) {
      cleanup.push(cause)
    }
  }
  // Retain the source/build/fixture root on failure for the original worker's
  // physical shutdown and inspection; never delete a possibly live subtree.
  try {
    await privateDirectory(root, rootIdentity)
    await fs.writeFile(
      path.join(root, 'component-delivery-failure.json'),
      JSON.stringify(
        {
          protocol: 'brc38-native-component-delivery-failure/v1',
          inputs,
          build,
          pin,
          records,
          failure: qualificationFailureData(failure),
          cleanup: cleanup.map(qualificationFailureData),
          delivered: false,
          providerQualified: false,
          fullSystemQualified: false
        },
        null,
        2
      ) + '\n',
      { flag: 'wx', mode: 0o400 }
    )
  } catch (cause) {
    cleanup.push(cause)
  }
  if (failed)
    throw new AggregateError(
      [failure, ...cleanup],
      'Native qualification failed; original evidence retained at ' + root,
      { cause: failure }
    )
}

module.exports = { parseQualificationArguments, qualifyBrc38NativeCandidate }
if (require.main === module) {
  Promise.resolve()
    .then(() => qualifyBrc38NativeCandidate(parseQualificationArguments(process.argv.slice(2))))
    .then(receipt => process.stdout.write(JSON.stringify(receipt) + '\n'))
    .catch(cause => {
      process.stderr.write(JSON.stringify(qualificationFailureData(cause)) + '\n')
      process.exitCode = 1
    })
}
