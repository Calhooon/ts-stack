import path from 'node:path'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const executionPlanPath = 'governance/mutation-testing/execution-partitions.json'

const partitionFile = specification => specification.replace(/:\d+(?:-\d+)?$/, '')
const plans = new Map([
  [
    'wallet-portable-canonical-chunks',
    {
      fallback: 'helpers',
      files: new Map([
        ['src/storage/portable/CanonicalPortableBounds.ts', 'bounds'],
        ['src/storage/portable/CanonicalPortableValue.ts', 'value'],
        ['src/storage/portable/CanonicalPortableParts.ts', 'parts'],
        ['src/storage/portable/CanonicalPortableChunks.ts', 'writer']
      ])
    }
  ],
  [
    'sdk-auth-http',
    {
      fallback: 'core',
      files: new Map([
        ['src/auth/clients/AuthFetch.ts', 'client'],
        ['src/auth/transports/SimplifiedFetchTransport.ts', 'transport']
      ])
    }
  ],
  [
    'wallet-snapshot-sync',
    {
      fallback: 'session',
      files: new Map([
        ['src/utility/runInSeries.ts', 'session'],
        ['src/storage/sync/syncSession.ts', 'session'],
        ['src/storage/snapshot/SnapshotSync.ts', 'session'],
        ['src/storage/sync/syncCheckpoint.ts', 'checkpoint'],
        ['src/storage/snapshot/runSnapshotSyncSession.ts', 'copy'],
        ['src/storage/StorageKnex.ts', 'storage'],
        ['src/storage/WalletStorageManager.ts', 'primary']
      ])
    }
  ],
  [
    'wallet-retained-snapshot',
    {
      fallback: 'lifecycle',
      files: new Map([
        ['src/storage/snapshot/KnexWalletReadSnapshot.ts', 'reader'],
        ['src/storage/schema/snapshotProfileIndexMigration.ts', 'profile-index'],
        ['src/storage/schema/snapshotRelationIndexMigration.ts', 'relation-index'],
        ['src/storage/schema/snapshotCertificateIndexMigration.ts', 'certificate-index'],
        ['src/storage/schema/snapshotGlobalIndexMigration.ts', 'global-index'],
        ['src/storage/schema/snapshotGlobalIndexModel.ts', 'global-index'],
        ['src/storage/schema/snapshotGlobalIndexMysql.ts', 'global-mysql'],
        ['src/storage/schema/snapshotGlobalIndexSqlite.ts', 'global-sqlite'],
        ['src/storage/schema/snapshotSqliteSchemaObservations.ts', 'global-sqlite'],
        ['src/storage/schema/snapshotGlobalIndexBootstrap.ts', 'global-bootstrap'],
        ['src/storage/schema/snapshotGlobalIndexTriggers.ts', 'global-triggers'],
        ['src/storage/schema/snapshotSqliteIdentity.ts', 'sqlite-identity'],
        ['src/storage/schema/snapshotSqliteIdentityObservations.ts', 'sqlite-identity'],
        ['src/storage/schema/snapshotSqliteMembership.ts', 'sqlite-membership'],
        ['src/storage/schema/snapshotSqliteIndexGeneration.ts', 'sqlite-generation'],
        ['src/storage/schema/snapshotSqliteIndexBootstrap.ts', 'sqlite-bootstrap'],
        ['src/storage/schema/snapshotSqliteIndexState.ts', 'sqlite-bootstrap'],
        ['src/storage/schema/snapshotSqliteIndexRetirement.ts', 'sqlite-retirement'],
        ['src/storage/schema/snapshotSqliteLegacyOwnership.ts', 'sqlite-generation'],
        ['src/storage/schema/snapshotSqliteIndexMigration.ts', 'sqlite-retirement'],
        ['src/storage/StorageKnex.ts', 'storage'],
        ['src/storage/StorageProvider.ts', 'storage']
      ])
    }
  ],
  [
    'wallet-snapshot-journal',
    {
      fallback: 'revision',
      files: new Map([
        ['src/storage/snapshot/journal/SnapshotJournalRevision.ts', 'revision'],
        ['src/storage/snapshot/journal/SnapshotJournalRevisionSql.ts', 'revision'],
        ['src/storage/snapshot/journal/SnapshotJournalPage.ts', 'page'],
        ['src/storage/snapshot/journal/SnapshotJournalSqliteClock.ts', 'clock'],
        ['src/storage/snapshot/journal/SnapshotJournalMysqlClock.ts', 'clock'],
        ['src/storage/snapshot/journal/SnapshotJournalSqliteObservers.ts', 'sqlite-observers'],
        ['src/storage/snapshot/journal/SnapshotJournalMysqlObservers.ts', 'mysql-observers'],
        ['src/storage/snapshot/journal/SnapshotJournalBootstrap.ts', 'bootstrap'],
        ['src/storage/snapshot/journal/SnapshotJournalHighWater.ts', 'high-water'],
        ['src/storage/snapshot/journal/SnapshotJournalMysqlSource.ts', 'mysql-source'],
        ['src/storage/snapshot/journal/SnapshotJournalSqliteGeneration.ts', 'sqlite-generation'],
        ['src/storage/snapshot/journal/SnapshotJournalMysqlIntent.ts', 'mysql-intent'],
        ['src/storage/snapshot/journal/SnapshotJournalMysqlGeneration.ts', 'mysql-generation'],
        ['src/storage/snapshot/journal/SnapshotJournalReceipt.ts', 'receipts'],
        ['src/storage/snapshot/journal/SnapshotJournalCaptureFence.ts', 'capture-fence'],
        ['src/storage/snapshot/journal/SnapshotJournalConnections.ts', 'connections'],
        ['src/storage/snapshot/journal/SnapshotJournalCaptureBackend.ts', 'capture-backend'],
        ['src/storage/snapshot/journal/SnapshotJournalCapture.ts', 'capture'],
        ['src/storage/snapshot/journal/SnapshotJournalCollection.ts', 'collection'],
        ['src/storage/snapshot/journal/SnapshotJournalMaintenance.ts', 'maintenance'],
        ['src/storage/snapshot/journal/SnapshotJournalMaintenanceFence.ts', 'maintenance-fence'],
        ['src/storage/snapshot/journal/SnapshotJournalMaintenanceTask.ts', 'maintenance-task']
      ])
    }
  ],
  [
    'wallet-snapshot-archive',
    {
      fallback: 'capture',
      files: new Map([
        ['src/storage/snapshot/archive/KnexSnapshotArchiveStore.ts', 'store'],
        ['src/storage/schema/snapshotArchiveMigration.ts', 'store'],
        ['src/storage/snapshot/archive/KnexSnapshotArchiveSource.ts', 'source'],
        ['src/storage/snapshot/archive/KnexSnapshotArchiveClosure.ts', 'source']
      ])
    }
  ],
  [
    'wallet-snapshot-remote-http',
    {
      fallback: 'protocol',
      files: new Map([
        ['src/storage/remoting/StorageServer.ts', 'server'],
        ['src/storage/remoting/StorageClientBase.ts', 'client']
      ])
    }
  ],
  [
    'wallet-snapshot-remote-service',
    {
      fallback: 'persistence',
      files: new Map([
        ['src/storage/snapshot/archive/KnexSnapshotArchiveService.ts', 'controller'],
        ['src/storage/snapshot/archive/SnapshotArchiveGuard.ts', 'guard'],
        ['src/storage/snapshot/archive/SnapshotArchiveGuardRegistry.ts', 'guard'],
        ['src/storage/snapshot/archive/SnapshotArchiveGuardBackend.ts', 'backend']
      ])
    }
  ],
  [
    'wallet-snapshot-remote-reader',
    {
      fallback: 'admission',
      files: new Map([
        ['src/storage/snapshot/archive/RemoteSnapshotLease.ts', 'lease'],
        ['src/storage/snapshot/archive/RemoteSnapshotRows.ts', 'rows'],
        ['src/storage/snapshot/archive/RemoteSnapshotPageReader.ts', 'page'],
        ['src/storage/snapshot/archive/openRemoteSnapshot.ts', 'page'],
        ['src/storage/snapshot/SnapshotCursor.ts', 'page']
      ])
    }
  ]
])

// Keep each file's complete original range union in exactly one execution part.
// New canonical files join the target's fallback; a future helper cannot disappear.
export function canonicalMutationPartitions(targetId, target) {
  const plan = plans.get(targetId)
  if (!plan) return [{ id: 'whole', target }]
  const groups = new Map()
  for (const specification of target.mutate) {
    const file = partitionFile(specification)
    if (/[!*?{}[\]]/.test(file) || path.posix.isAbsolute(file) || file.split('/').includes('..'))
      throw new Error('Mutation partition requires explicit canonical source paths')
    const id = plan.files.get(file) ?? plan.fallback
    const mutate = groups.get(id) ?? []
    mutate.push(specification)
    groups.set(id, mutate)
  }
  if (groups.size === 0) throw new Error('Empty canonical mutation source union')
  return [...groups].map(([id, mutate]) => ({ id, target: { ...target, mutate } }))
}

function sourceSpecification(specification) {
  if (typeof specification !== 'string') throw new Error('Invalid execution source specification')
  const match = /^(.*?)(?::([1-9]\d*)(?:-([1-9]\d*))?)?$/.exec(specification)
  const file = match?.[1]
  if (
    !file ||
    file.includes('\\') ||
    /[!*?{}[\]:]/.test(file) ||
    path.posix.isAbsolute(file) ||
    file.split('/').includes('..')
  )
    throw new Error('Execution refinements require explicit canonical source paths')
  const start = match[2] === undefined ? 1 : Number(match[2])
  const end = match[2] === undefined ? Infinity : Number(match[3] ?? match[2])
  if (
    !Number.isSafeInteger(start) ||
    start < 1 ||
    (end !== Infinity && !Number.isSafeInteger(end)) ||
    end < start
  )
    throw new Error('Invalid execution source range')
  return { file, start, end }
}

// Configuration validation only. The installed-engine replay and unchanged
// complete canonical aggregate prove mutant ownership, not these line numbers.
export function refineMutationPartition(base, unit, readSource) {
  if (
    unit.packageDirectory !== base.target.packageDirectory ||
    !Array.isArray(unit.originalMutate) ||
    !unit.sourceHashes ||
    typeof unit.sourceHashes !== 'object' ||
    Array.isArray(unit.sourceHashes) ||
    !Array.isArray(unit.parts) ||
    unit.parts.length === 0 ||
    !Number.isSafeInteger(unit.canonicalCount) ||
    unit.canonicalCount < 1
  )
    throw new Error('Invalid source-bound execution refinement')
  const known = new Set(
    unit.originalMutate.map(specification => sourceSpecification(specification).file)
  )
  if (
    !isDeepStrictEqual(
      [...known].sort((left, right) => left.localeCompare(right)),
      Object.keys(unit.sourceHashes).sort((left, right) => left.localeCompare(right))
    )
  )
    throw new Error('Execution source hash inventory differs from original specifications')
  const actual = base.target.mutate.map(specification => ({
    specification,
    ...sourceSpecification(specification)
  }))
  if (
    !isDeepStrictEqual(
      actual.filter(value => known.has(value.file)).map(value => value.specification),
      unit.originalMutate
    )
  )
    throw new Error(
      'Canonical execution specifications changed; regenerate the reviewed execution plan'
    )
  const lines = new Map()
  for (const file of known) {
    const bytes = readSource(file),
      expected = unit.sourceHashes[file]
    if (
      typeof expected !== 'string' ||
      !/^[a-f0-9]{64}$/.test(expected) ||
      createHash('sha256').update(bytes).digest('hex') !== expected
    )
      throw new Error(`Execution source changed: ${file}; regenerate the reviewed execution plan`)
    lines.set(file, bytes.toString('utf8').split('\n').length)
  }
  const owners = new Map(),
    ids = new Set(),
    covered = new Set()
  let count = 0
  const parts = unit.parts.map(part => {
    if (
      typeof part.id !== 'string' ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(part.id) ||
      part.id === 'whole' ||
      ids.has(part.id) ||
      !Array.isArray(part.mutate) ||
      part.mutate.length === 0 ||
      !Number.isSafeInteger(part.count) ||
      part.count < 1
    )
      throw new Error('Missing or duplicate execution refinement identity')
    ids.add(part.id)
    count += part.count
    for (const specification of part.mutate) {
      const { file, start, end } = sourceSpecification(specification)
      if (
        !known.has(file) ||
        start > lines.get(file) ||
        (end !== Infinity && end > lines.get(file))
      )
        throw new Error('Execution range lies outside its complete canonical source')
      const previous = owners.get(file) ?? []
      if (previous.some(value => value.id !== part.id && start <= value.end && value.start <= end))
        throw new Error('Execution source ranges overlap across partitions')
      previous.push({ start, end, id: part.id })
      owners.set(file, previous)
      covered.add(file)
    }
    return { id: part.id, target: { ...base.target, mutate: [...part.mutate] } }
  })
  if (count !== unit.canonicalCount || covered.size !== known.size)
    throw new Error('Execution refinement omits canonical source or mutant inventory')
  // Future canonical helpers remain owned in full; they cannot silently vanish.
  parts[0].target.mutate.push(
    ...actual.filter(value => !known.has(value.file)).map(value => value.specification)
  )
  return parts
}

// A component selection is bound to one complete original source partition.
// The canonical target keeps its entire test universe for affected selection and
// independent CI; only this partition's repeated mutation execution changes.
export function applyPartitionComponentTests(base, selection, readSource) {
  const target = base.target
  if (
    !selection ||
    typeof selection !== 'object' ||
    !isDeepStrictEqual(selection.mutate, target.mutate) ||
    !selection.sourceHashes ||
    typeof selection.sourceHashes !== 'object' ||
    Array.isArray(selection.sourceHashes) ||
    !Array.isArray(selection.tests) ||
    selection.tests.length === 0 ||
    new Set(selection.tests).size !== selection.tests.length
  )
    throw new Error('Invalid source-bound component selection')
  const files = [...new Set(target.mutate.map(value => sourceSpecification(value).file))].sort(
    (left, right) => left.localeCompare(right)
  )
  if (
    !isDeepStrictEqual(
      files,
      Object.keys(selection.sourceHashes).sort((left, right) => left.localeCompare(right))
    )
  )
    throw new Error('Component source inventory differs')
  for (const file of files) {
    const expected = selection.sourceHashes[file]
    if (
      typeof expected !== 'string' ||
      !/^[a-f0-9]{64}$/.test(expected) ||
      createHash('sha256').update(readSource(file)).digest('hex') !== expected
    )
      throw new Error('Component source changed; review its selection and coverage')
  }
  const config = target.runnerOptions?.jest?.config
  const property = target.propertyTest?.slice(target.packageDirectory.length + 1)
  if (
    !config ||
    !Array.isArray(config.testMatch) ||
    !selection.tests.includes(property) ||
    selection.tests.some(
      file =>
        typeof file !== 'string' ||
        file.includes('\\') ||
        path.posix.isAbsolute(file) ||
        /[!*?{}[\]:]/.test(file) ||
        file.split('/').some(part => part === '.' || part === '..') ||
        target.requiredFunctionalTests?.includes(file) ||
        !config.testMatch.some(pattern => path.matchesGlob('<rootDir>/' + file, pattern))
    )
  )
    throw new Error('Component tests omit a property or escape the original universe')
  return {
    ...base,
    target: {
      ...target,
      runnerOptions: {
        ...target.runnerOptions,
        jest: {
          ...target.runnerOptions.jest,
          config: {
            ...config,
            testMatch: selection.tests.map(file => '<rootDir>/' + file)
          }
        }
      }
    }
  }
}

export function partitionMutationTarget(targetId, target) {
  const original = canonicalMutationPartitions(targetId, target)
  const selections = target.componentTestPartitions ?? {}
  if (
    typeof selections !== 'object' ||
    Array.isArray(selections) ||
    Object.keys(selections).some(id => !original.some(part => part.id === id))
  )
    throw new Error('Unknown component execution partition')
  const base = original.map(part =>
    selections[part.id] === undefined
      ? part
      : applyPartitionComponentTests(part, selections[part.id], file =>
          fs.readFileSync(path.join(ROOT, target.packageDirectory, file))
        )
  )
  const plan = JSON.parse(fs.readFileSync(path.join(ROOT, executionPlanPath), 'utf8'))
  if (plan.schemaVersion !== 1 || plan.engine !== '9.6.1' || !Array.isArray(plan.units))
    throw new Error('Missing reviewed execution refinement manifest')
  const units = plan.units.filter(unit => unit.target === targetId)
  const identities = new Set(units.map(unit => unit.existingPartition))
  if (
    identities.size !== units.length ||
    units.some(unit => !base.some(part => part.id === unit.existingPartition))
  )
    throw new Error('Unknown or duplicate original execution partition')
  const parts = base.flatMap(part => {
    const unit = units.find(value => value.existingPartition === part.id)
    return unit === undefined
      ? [part]
      : refineMutationPartition(part, unit, file =>
          fs.readFileSync(path.join(ROOT, target.packageDirectory, file))
        )
  })
  if (new Set(parts.map(part => part.id)).size !== parts.length)
    throw new Error('Execution refinement identities collide')
  return parts
}

export function partitionedMutationTargets(selected, targets) {
  return [
    ...new Set(
      mutationExecutionMatrix(selected, targets)
        .include.filter(value => value.partition !== 'whole')
        .map(value => value.target)
    )
  ]
}

export function selectedMutationPartition(targetId, target, partition = 'whole') {
  if (partition === 'whole') return target
  const selected = partitionMutationTarget(targetId, target).find(value => value.id === partition)
  if (!selected) throw new Error(`Unknown mutation execution partition ${targetId}/${partition}`)
  return selected.target
}

export function mutationExecutionMatrix(selected, targets) {
  if (!Array.isArray(selected) || new Set(selected).size !== selected.length)
    throw new Error('Missing or duplicate canonical target selection')
  return {
    include: selected.flatMap(targetId => {
      if (!Object.hasOwn(targets, targetId)) throw new Error('Unknown canonical mutation target')
      return partitionMutationTarget(targetId, targets[targetId]).map(({ id }) => ({
        target: targetId,
        partition: id,
        ...(targets[targetId].packageDirectory === 'packages/wallet/wallet-toolbox'
          ? { wallet_native: true }
          : {})
      }))
    })
  }
}
