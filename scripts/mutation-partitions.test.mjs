import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  parseArguments,
  REPOSITORY_ROOT,
  selectAffectedMutationTargets
} from './mutation-testing.mjs'
import { buildMutationTargets } from '../governance/mutation-testing/targets.mjs'
import {
  partitionMutationTarget,
  canonicalMutationPartitions,
  selectedMutationPartition,
  mutationExecutionMatrix,
  partitionedMutationTargets,
  refineMutationPartition,
  applyPartitionComponentTests
} from './mutation-partitions.mjs'
const target = {
  mutate: [
    'src/auth/Peer.ts:5-10',
    'src/auth/Peer.ts:8-20',
    'src/auth/clients/AuthFetch.ts:1-20',
    'src/auth/clients/AuthFetch.ts:40-50',
    'src/auth/transports/SimplifiedFetchTransport.ts:5-90',
    'src/auth/FutureHelper.ts'
  ],
  runnerOptions: { jest: { config: { testMatch: ['all-original-tests'] } } }
}

test('primary sync partitions preserve complete contracts before dependencies are installed', () => {
  const canonical = buildMutationTargets(REPOSITORY_ROOT)['wallet-snapshot-sync']
  const parts = partitionMutationTarget('wallet-snapshot-sync', canonical)
  assert.deepEqual(
    parts.map(part => part.id),
    ['session', 'checkpoint', 'copy', 'storage', 'primary']
  )
  assert.deepEqual(parts.flatMap(part => part.target.mutate).sort(), [...canonical.mutate].sort())
  const owners = new Map()
  for (const part of parts) {
    assert.deepEqual(part.target, { ...canonical, mutate: part.target.mutate })
    assert.equal(part.target.runnerOptions, canonical.runnerOptions)
    for (const specification of part.target.mutate) {
      const file = specification.replace(/:\d+(?:-\d+)?$/, '')
      assert.ok(!owners.has(file) || owners.get(file) === part.id)
      owners.set(file, part.id)
    }
  }
  assert.equal(owners.get('src/storage/WalletStorageManager.ts'), 'primary')
  assert.equal(owners.get('src/storage/StorageKnex.ts'), 'storage')
  assert.equal(owners.get('src/storage/snapshot/SnapshotSync.ts'), 'session')
  const helper = 'src/storage/snapshot/FuturePrimaryHelper.ts'
  const future = partitionMutationTarget('wallet-snapshot-sync', {
    ...canonical,
    mutate: [...canonical.mutate, helper]
  })
  assert.deepEqual(future[0].target.mutate, [...parts[0].target.mutate, helper])
  assert.equal(selectedMutationPartition('wallet-snapshot-sync', canonical), canonical)
  const targets = buildMutationTargets(REPOSITORY_ROOT)
  assert.ok(mutationExecutionMatrix(Object.keys(targets), targets).include.length <= 256)
})

test('execution partitions preserve complete original specifications and identical full test configuration', () => {
  const parts = partitionMutationTarget('sdk-auth-http', target)
  assert.deepEqual(
    parts.map(part => part.id),
    ['core', 'client', 'transport']
  )
  assert.deepEqual(parts.flatMap(part => part.target.mutate).sort(), [...target.mutate].sort())
  const owner = new Map()
  for (const part of parts) {
    assert.equal(part.target.runnerOptions, target.runnerOptions)
    for (const specification of part.target.mutate) {
      const file = specification.split(':')[0]
      assert.ok(!owner.has(file) || owner.get(file) === part.id)
      owner.set(file, part.id)
    }
  }
  assert.equal(owner.get('src/auth/FutureHelper.ts'), 'core')
  assert.equal(selectedMutationPartition('sdk-auth-http', target), target)
  assert.throws(() => selectedMutationPartition('other', target, 'core'), /Unknown/)
})
test('empty, wildcard, traversing and unknown partition selections fail closed', () => {
  for (const specification of ['src/**/*.ts', '!src/auth/Peer.ts', '../outside.ts', '/outside.ts'])
    assert.throws(() => partitionMutationTarget('sdk-auth-http', { mutate: [specification] }))
  assert.throws(() => partitionMutationTarget('sdk-auth-http', { mutate: [] }))
  assert.throws(() => selectedMutationPartition('sdk-auth-http', target, 'missing'))
  assert.throws(() =>
    mutationExecutionMatrix(['sdk-auth-http', 'sdk-auth-http'], { 'sdk-auth-http': target })
  )
  assert.throws(() => mutationExecutionMatrix(['unknown'], {}))
})
test('matrix expands only canonical SDKAuth while preserving original target order and other campaigns', () => {
  assert.deepEqual(
    mutationExecutionMatrix(['before', 'sdk-auth-http', 'after'], {
      before: target,
      'sdk-auth-http': target,
      after: target
    }).include,
    [
      { target: 'before', partition: 'whole' },
      { target: 'sdk-auth-http', partition: 'core' },
      { target: 'sdk-auth-http', partition: 'client' },
      { target: 'sdk-auth-http', partition: 'transport' },
      { target: 'after', partition: 'whole' }
    ]
  )
})

test('partition command mode requires one exact target without weakening existing mode validation', () => {
  const defaults = {
    all: false,
    list: false,
    targets: [],
    affectedFile: undefined,
    base: undefined
  }
  assert.deepEqual(parseArguments(['--target', 'sdk-auth-http', '--partition', 'core']), {
    ...defaults,
    targets: ['sdk-auth-http'],
    partition: 'core'
  })
  assert.deepEqual(parseArguments(['--all']), { ...defaults, all: true })
  for (const args of [
    ['--all', '--partition', 'core'],
    ['--list', '--partition', 'core'],
    ['--affected-file', 'paths', '--partition', 'core'],
    ['--target', 'sdk-auth-http', '--target', 'other', '--partition', 'core'],
    ['--target', 'sdk-auth-http', '--base', 'HEAD'],
    ['--target', 'sdk-auth-http', '--all'],
    ['--target', 'sdk-auth-http', '--partition']
  ])
    assert.throws(() => parseArguments(args))
})

test('retained partitions preserve complete lifecycle/reader/storage unions and future additions', () => {
  const retained = {
    testRunner: 'jest',
    runnerOptions: { jest: { config: { testMatch: ['all-original-retained-tests'] } } },
    mutate: [
      'src/storage/snapshot/RetainedReadSnapshot.ts',
      'src/storage/snapshot/KnexWalletReadSnapshot.ts',
      'src/storage/StorageKnex.ts:225-275',
      'src/storage/StorageKnex.ts:250-280',
      'src/storage/StorageProvider.ts:540-562',
      'src/storage/snapshot/FutureHelper.ts'
    ]
  }
  const parts = canonicalMutationPartitions('wallet-retained-snapshot', retained)
  assert.throws(
    () => partitionMutationTarget('wallet-retained-snapshot', retained),
    /Unknown or duplicate original execution partition/
  )
  assert.deepEqual(
    parts.map(part => part.id),
    ['lifecycle', 'reader', 'storage']
  )
  assert.deepEqual(parts.flatMap(part => part.target.mutate).sort(), [...retained.mutate].sort())
  for (const part of parts) {
    assert.equal(part.target.runnerOptions, retained.runnerOptions)
    assert.equal(part.target.testRunner, retained.testRunner)
  }
  assert.deepEqual(parts[0].target.mutate, [retained.mutate[0], retained.mutate[5]])
  assert.deepEqual(parts[2].target.mutate, retained.mutate.slice(2, 5))
  for (const specification of [
    'src/**/*.ts',
    '!src/StorageKnex.ts',
    '../outside.ts',
    '/outside.ts'
  ])
    assert.throws(() =>
      partitionMutationTarget('wallet-retained-snapshot', { mutate: [specification] })
    )
  assert.throws(() => selectedMutationPartition('wallet-retained-snapshot', retained, 'missing'))
  const targets = {
    'sdk-auth-http': target,
    'wallet-retained-snapshot': buildMutationTargets(REPOSITORY_ROOT)['wallet-retained-snapshot'],
    other: { mutate: ['src/whole.ts'] }
  }
  assert.deepEqual(partitionedMutationTargets(['other'], targets), [])
  assert.deepEqual(
    partitionedMutationTargets(['wallet-retained-snapshot', 'other', 'sdk-auth-http'], targets),
    ['wallet-retained-snapshot', 'sdk-auth-http']
  )
  assert.deepEqual(partitionedMutationTargets([], targets), [])
  assert.throws(() =>
    partitionedMutationTargets(['wallet-retained-snapshot'], { 'sdk-auth-http': target })
  )
  assert.throws(() => partitionedMutationTargets(['sdk-auth-http', 'sdk-auth-http'], targets))
})

test('service execution preserves the complete canonical union and all configuration in every part', () => {
  const canonical = buildMutationTargets(REPOSITORY_ROOT)['wallet-snapshot-remote-service']
  const parts = partitionMutationTarget('wallet-snapshot-remote-service', canonical)
  assert.deepEqual(
    parts.map(part => part.id),
    ['persistence', 'controller', 'guard', 'backend']
  )
  assert.deepEqual(parts.flatMap(part => part.target.mutate).sort(), [...canonical.mutate].sort())
  assert.equal(new Set(parts.flatMap(part => part.target.mutate)).size, canonical.mutate.length)
  for (const part of parts) {
    assert.deepEqual(part.target, { ...canonical, mutate: part.target.mutate })
    assert.equal(part.target.runnerOptions, canonical.runnerOptions)
  }
  assert.deepEqual(parts[1].target.mutate, [
    'src/storage/snapshot/archive/KnexSnapshotArchiveService.ts'
  ])
  assert.deepEqual(parts[2].target.mutate, [
    'src/storage/snapshot/archive/SnapshotArchiveGuard.ts',
    'src/storage/snapshot/archive/SnapshotArchiveGuardRegistry.ts'
  ])
  assert.deepEqual(parts[3].target.mutate, [
    'src/storage/snapshot/archive/SnapshotArchiveGuardBackend.ts'
  ])
  const future = {
    ...canonical,
    mutate: [...canonical.mutate, 'src/storage/snapshot/archive/FutureHelper.ts']
  }
  const expanded = partitionMutationTarget('wallet-snapshot-remote-service', future)
  assert.equal(expanded[0].id, 'persistence')
  assert.ok(expanded[0].target.mutate.includes('src/storage/snapshot/archive/FutureHelper.ts'))
  assert.equal(selectedMutationPartition('wallet-snapshot-remote-service', canonical), canonical)
  assert.throws(() =>
    selectedMutationPartition('wallet-snapshot-remote-service', canonical, 'missing')
  )
  for (const specification of ['src/**/*.ts', '!src/helper.ts', '../outside.ts', '/outside.ts']) {
    assert.throws(() =>
      partitionMutationTarget('wallet-snapshot-remote-service', { mutate: [specification] })
    )
  }
  const targets = { before: target, 'wallet-snapshot-remote-service': canonical, after: target }
  assert.deepEqual(mutationExecutionMatrix(Object.keys(targets), targets).include, [
    { target: 'before', partition: 'whole' },
    ...['persistence', 'controller', 'guard', 'backend'].map(partition => ({
      target: 'wallet-snapshot-remote-service',
      partition,
      wallet_native: true
    })),
    { target: 'after', partition: 'whole' }
  ])
})

test('HTTP execution preserves every canonical range, full configuration and future fallback', () => {
  const canonical = buildMutationTargets(REPOSITORY_ROOT)['wallet-snapshot-remote-http']
  const parts = partitionMutationTarget('wallet-snapshot-remote-http', canonical)
  assert.deepEqual(
    parts.map(part => part.id),
    ['protocol', 'client', 'server']
  )
  const original = [...canonical.mutate].sort()
  const actual = parts.flatMap(part => part.target.mutate)
  assert.deepEqual([...actual].sort(), original)
  assert.equal(new Set(actual).size, original.length)
  for (const part of parts) {
    assert.deepEqual(part.target, { ...canonical, mutate: part.target.mutate })
    assert.equal(part.target.runnerOptions, canonical.runnerOptions)
  }
  assert.deepEqual(parts[0].target.mutate, [
    'src/storage/snapshot/archive/SnapshotArchiveProtocol.ts',
    'src/storage/snapshot/archive/KnexSnapshotArchiveRpc.ts',
    'src/storage/snapshot/archive/SnapshotArchiveTransport.ts',
    'src/storage/snapshot/RemoteSnapshotSyncContentProtocol.ts',
    'src/storage/snapshot/journal/KnexSnapshotJournalDataRpc.ts',
    'src/storage/snapshot/journal/KnexSnapshotJournalFieldRpc.ts',
    'src/storage/snapshot/journal/RemoteSnapshotJournalFieldDestination.ts',
    'src/storage/snapshot/journal/SnapshotJournalFieldRpcProtocol.ts',
    'src/storage/snapshot/journal/SnapshotJournalFieldUploadRequest.ts',
    'src/storage/snapshot/journal/openStoredSnapshotJournalFieldArchive.ts',
    'src/storage/snapshot/journal/RemoteSnapshotJournalDataDestination.ts',
    'src/storage/snapshot/journal/SnapshotJournalArchiveProtocol.ts',
    'src/storage/snapshot/journal/SnapshotJournalArchiveTransport.ts',
    'src/storage/snapshot/journal/SnapshotJournalDataProtocol.ts',
    'src/storage/snapshot/journal/openRemoteSnapshotJournalArchive.ts',
    'src/storage/snapshot/journal/SnapshotJournalFieldArchiveProtocol.ts',
    'src/storage/snapshot/journal/SnapshotJournalFieldArchiveTransport.ts',
    'src/storage/snapshot/journal/openRemoteSnapshotJournalFieldArchive.ts'
  ])
  for (const [index, file] of [
    [1, 'StorageClientBase.ts'],
    [2, 'StorageServer.ts']
  ]) {
    assert.deepEqual(
      parts[index].target.mutate,
      canonical.mutate.filter(specification =>
        specification.startsWith(`src/storage/remoting/${file}:`)
      )
    )
    assert.ok(parts[index].target.mutate.length > 1)
  }
  const helper = 'src/storage/snapshot/archive/FutureHttpHelper.ts'
  const expanded = partitionMutationTarget('wallet-snapshot-remote-http', {
    ...canonical,
    mutate: [...canonical.mutate, helper]
  })
  assert.equal(expanded[0].id, 'protocol')
  assert.deepEqual(expanded[0].target.mutate, [...parts[0].target.mutate, helper])
  assert.equal(selectedMutationPartition('wallet-snapshot-remote-http', canonical), canonical)
  assert.throws(() =>
    selectedMutationPartition('wallet-snapshot-remote-http', canonical, 'missing')
  )
  for (const specification of ['src/**/*.ts', '!src/helper.ts', '../outside.ts', '/outside.ts']) {
    assert.throws(() =>
      partitionMutationTarget('wallet-snapshot-remote-http', { mutate: [specification] })
    )
  }
  const targets = { before: target, 'wallet-snapshot-remote-http': canonical, after: target }
  assert.deepEqual(mutationExecutionMatrix(Object.keys(targets), targets).include, [
    { target: 'before', partition: 'whole' },
    ...['protocol', 'client', 'server'].map(partition => ({
      target: 'wallet-snapshot-remote-http',
      partition,
      wallet_native: true
    })),
    { target: 'after', partition: 'whole' }
  ])
})

for (const [id, expected, fallback] of [
  [
    'wallet-retained-snapshot',
    [
      'lifecycle',
      'reader',
      'profile-index',
      'relation-index',
      'certificate-index',
      'global-index',
      'global-mysql',
      'global-sqlite',
      'global-bootstrap',
      'global-triggers',
      'sqlite-identity',
      'sqlite-membership',
      'sqlite-generation',
      'sqlite-bootstrap',
      'sqlite-retirement',
      'storage'
    ],
    'lifecycle'
  ],
  [
    'wallet-snapshot-journal',
    [
      'revision',
      'page',
      'clock',
      'sqlite-observers',
      'mysql-observers',
      'bootstrap',
      'high-water',
      'mysql-source',
      'sqlite-generation',
      'mysql-intent',
      'mysql-generation',
      'receipts',
      'capture-fence',
      'connections',
      'capture-backend',
      'capture',
      'collection',
      'maintenance',
      'maintenance-fence',
      'maintenance-task'
    ],
    'revision'
  ],
  ['wallet-snapshot-archive', ['store', 'capture', 'source'], 'capture'],
  ['wallet-snapshot-remote-reader', ['admission', 'lease', 'rows', 'page'], 'admission']
]) {
  test(`${id} preserves canonical whole-file ownership, configuration and future source coverage`, () => {
    const canonical = buildMutationTargets(REPOSITORY_ROOT)[id]
    const parts = canonicalMutationPartitions(id, canonical)
    assert.deepEqual(
      parts.map(part => part.id),
      expected
    )
    assert.deepEqual(parts.flatMap(part => part.target.mutate).sort(), [...canonical.mutate].sort())
    const owners = new Map()
    for (const part of parts) {
      const { mutate } = part.target
      assert.deepEqual(part.target, { ...canonical, mutate })
      assert.equal(part.target.runnerOptions, canonical.runnerOptions)
      for (const specification of mutate) {
        const file = specification.replace(/:\d+(?:-\d+)?$/, '')
        assert.ok(!owners.has(file) || owners.get(file) === part.id)
        owners.set(file, part.id)
      }
    }
    const helper = 'src/storage/snapshot/FutureHelper.ts'
    const extended = { ...canonical, mutate: [...canonical.mutate, helper, `${helper}:1-20`] }
    const expanded = canonicalMutationPartitions(id, extended)
    assert.deepEqual(
      expanded.flatMap(part => part.target.mutate).sort(),
      [...extended.mutate].sort()
    )
    assert.deepEqual(expanded.find(part => part.id === fallback).target.mutate.slice(-2), [
      helper,
      `${helper}:1-20`
    ])
    assert.equal(selectedMutationPartition(id, canonical), canonical)
    assert.throws(() => selectedMutationPartition(id, canonical, 'missing'))
  })
}

test('native platform routing follows the actual package, including every canonical partition', () => {
  const wallet = { ...target, packageDirectory: 'packages/wallet/wallet-toolbox' }
  const values = mutationExecutionMatrix(
    ['ordinary-name', 'wallet-snapshot-sync', 'wallet-looking-name'],
    {
      'ordinary-name': wallet,
      'wallet-snapshot-sync': wallet,
      'wallet-looking-name': { ...target, packageDirectory: 'packages/sdk' }
    }
  ).include
  assert.ok(
    values
      .filter(value => value.target !== 'wallet-looking-name')
      .every(value => value.wallet_native === true)
  )
  assert.equal(
    values.find(value => value.target === 'wallet-looking-name').wallet_native,
    undefined
  )
  const targets = buildMutationTargets(REPOSITORY_ROOT)
  for (const value of mutationExecutionMatrix(Object.keys(targets), targets).include) {
    assert.equal(
      value.wallet_native === true,
      targets[value.target].packageDirectory === 'packages/wallet/wallet-toolbox'
    )
  }
})

test('canonical serializer partitions keep every complete module and the full original test configuration', () => {
  const canonical = buildMutationTargets(REPOSITORY_ROOT)['wallet-portable-canonical-chunks']
  const parts = partitionMutationTarget('wallet-portable-canonical-chunks', canonical)
  assert.deepEqual(
    parts.map(part => part.id),
    ['writer', 'helpers', 'bounds', 'value', 'parts']
  )
  assert.deepEqual(parts.flatMap(part => part.target.mutate).sort(), [...canonical.mutate].sort())
  const owners = new Set()
  for (const part of parts) {
    assert.deepEqual(part.target, { ...canonical, mutate: part.target.mutate })
    assert.equal(part.target.runnerOptions, canonical.runnerOptions)
    for (const file of part.target.mutate) {
      assert.ok(!owners.has(file))
      owners.add(file)
    }
  }
  const helper = 'src/storage/portable/FutureCanonicalHelper.ts'
  const future = partitionMutationTarget('wallet-portable-canonical-chunks', {
    ...canonical,
    mutate: [...canonical.mutate, helper]
  })
  assert.deepEqual(future.find(part => part.id === 'helpers').target.mutate, [
    'src/utility/promiseFromSync.ts',
    'src/utility/utf16CodeUnitAt.ts',
    helper
  ])
  assert.equal(selectedMutationPartition('wallet-portable-canonical-chunks', canonical), canonical)
  const targets = buildMutationTargets(REPOSITORY_ROOT)
  assert.ok(mutationExecutionMatrix(Object.keys(targets), targets).include.length <= 256)
})

function refinementFixture() {
  const source = Buffer.from('const one = 1\n\n// no mutant here\nconst two = 2\n'),
    base = {
      id: 'whole',
      target: {
        packageDirectory: 'package',
        mutate: ['src/code.ts'],
        runnerOptions: { jest: { config: { testMatch: ['all-original-tests'] } } }
      }
    },
    unit = {
      packageDirectory: 'package',
      originalMutate: ['src/code.ts'],
      sourceHashes: { 'src/code.ts': createHash('sha256').update(source).digest('hex') },
      canonicalCount: 2,
      parts: [
        { id: 'range-001', count: 1, mutate: ['src/code.ts:1-1'] },
        { id: 'range-002', count: 1, mutate: ['src/code.ts:4-4'] }
      ]
    }
  return { source, base, unit }
}
test('source-bound refinements retain the identical full runner and own future helpers in full', () => {
  const { source, base, unit } = refinementFixture()
  const parts = refineMutationPartition(base, unit, () => source)
  assert.deepEqual(
    parts.map(part => part.id),
    ['range-001', 'range-002']
  )
  for (const part of parts) {
    assert.equal(part.target.runnerOptions, base.target.runnerOptions)
    assert.deepEqual({ ...part.target, mutate: base.target.mutate }, base.target)
  }
  const future = refineMutationPartition(
    { ...base, target: { ...base.target, mutate: [...base.target.mutate, 'src/FutureHelper.ts'] } },
    unit,
    () => source
  )
  assert.deepEqual(future[0].target.mutate, ['src/code.ts:1-1', 'src/FutureHelper.ts'])
  assert.deepEqual(future[1].target.mutate, parts[1].target.mutate)
})
test('stale source, changed original specifications and malformed or overlapping ranges fail closed', () => {
  const { source, base, unit } = refinementFixture()
  assert.throws(
    () =>
      refineMutationPartition(base, unit, () => Buffer.concat([source, Buffer.from('// changed')])),
    /source changed/
  )
  assert.throws(
    () =>
      refineMutationPartition(
        { ...base, target: { ...base.target, mutate: ['src/code.ts:1-2'] } },
        unit,
        () => source
      ),
    /specifications changed/
  )
  for (const change of [
    value => {
      value.parts[1].mutate = ['src/code.ts:1-4']
    },
    value => {
      value.parts[1].mutate = ['src/code.ts:4-99']
    },
    value => {
      value.parts[1].mutate = ['../outside.ts:1-1']
    },
    value => {
      value.parts[1].mutate = ['src/*.ts']
    },
    value => {
      value.parts[1].mutate = ['src/code.ts:0-1']
    },
    value => {
      value.parts[1].mutate = ['src/code.ts:4-3']
    },
    value => {
      value.parts[1].id = value.parts[0].id
    },
    value => {
      value.parts[1].id = 'whole'
    },
    value => {
      value.parts[1].count = 0
    },
    value => {
      value.parts[1].mutate = []
    },
    value => {
      value.canonicalCount = 3
    },
    value => {
      value.sourceHashes['src/extra.ts'] = value.sourceHashes['src/code.ts']
    },
    value => {
      delete value.sourceHashes['src/code.ts']
    },
    value => {
      value.sourceHashes['src/code.ts'] = 'x'.repeat(64)
    },
    value => {
      value.packageDirectory = '../outside'
    }
  ]) {
    const changed = structuredClone(unit)
    change(changed)
    assert.throws(() => refineMutationPartition(base, changed, () => source))
  }
})

test('sqlite bootstrap components change only that source-bound partition and retain the full functional universe', () => {
  const canonical = buildMutationTargets(REPOSITORY_ROOT)['wallet-retained-snapshot']
  const parts = partitionMutationTarget('wallet-retained-snapshot', canonical)
  const children = parts.filter(part => /^sqlite-bootstrap-\d{3}$/.test(part.id))
  assert.equal(children.length, 6)
  const selected = children[0].target
  assert.deepEqual(
    selectAffectedMutationTargets({ 'wallet-retained-snapshot': canonical }, [
      'scripts/mutation-partitions.mjs'
    ]),
    ['wallet-retained-snapshot']
  )
  assert.deepEqual(
    selectAffectedMutationTargets({ 'wallet-retained-snapshot': canonical }, [
      'scripts/mutation-partitions.mjs.extra'
    ]),
    []
  )
  assert.equal(selected.runnerOptions.jest.config.testMatch.length, 9)
  assert.ok(
    selected.runnerOptions.jest.config.testMatch.includes(
      '<rootDir>/src/storage/snapshot/RetainedReadSnapshot.property.test.ts'
    )
  )
  for (const child of children) assert.deepEqual(child.target.runnerOptions, selected.runnerOptions)
  for (const part of parts.filter(part => !children.includes(part)))
    assert.equal(part.target.runnerOptions, canonical.runnerOptions)
  assert.equal(selectedMutationPartition('wallet-retained-snapshot', canonical), canonical)
  const original = canonicalMutationPartitions('wallet-retained-snapshot', canonical)
  assert.deepEqual(
    parts
      .filter(part => !children.includes(part))
      .flatMap(part => part.target.mutate)
      .sort(),
    original
      .filter(part => part.id !== 'sqlite-bootstrap')
      .flatMap(part => part.target.mutate)
      .sort()
  )
  assert.deepEqual(selected.runnerOptions, {
    ...canonical.runnerOptions,
    jest: {
      ...canonical.runnerOptions.jest,
      config: {
        ...canonical.runnerOptions.jest.config,
        testMatch: selected.runnerOptions.jest.config.testMatch
      }
    }
  })
})

test('component topology refuses stale source, missing properties, unknown suites and another partition', () => {
  const canonical = buildMutationTargets(REPOSITORY_ROOT)['wallet-retained-snapshot']
  const base = canonicalMutationPartitions('wallet-retained-snapshot', canonical).find(
    part => part.id === 'sqlite-bootstrap'
  )
  const selection = canonical.componentTestPartitions['sqlite-bootstrap']
  const read = file => readFileSync(join(REPOSITORY_ROOT, canonical.packageDirectory, file))
  for (const patch of [
    { mutate: [...selection.mutate, 'src/future.ts'] },
    { sourceHashes: {} },
    { sourceHashes: { ...selection.sourceHashes, 'src/extra.ts': 'a'.repeat(64) } },
    { tests: [] },
    { tests: [...selection.tests, selection.tests[0]] },
    {
      tests: selection.tests.filter(file => !file.endsWith('RetainedReadSnapshot.property.test.ts'))
    },
    ...[
      '../escape.test.ts',
      '/outside.test.ts',
      'src/**/*.test.ts',
      'src/unknown.test.ts',
      canonical.requiredFunctionalTests[0]
    ].map(file => ({ tests: [...selection.tests, file] }))
  ])
    assert.throws(() => applyPartitionComponentTests(base, { ...selection, ...patch }, read))
  assert.throws(
    () => applyPartitionComponentTests(base, selection, () => Buffer.from('changed source')),
    /source changed/
  )
  assert.throws(
    () =>
      partitionMutationTarget('wallet-retained-snapshot', {
        ...canonical,
        componentTestPartitions: { missing: selection }
      }),
    /Unknown component/
  )
  const before = JSON.stringify(canonical)
  applyPartitionComponentTests(base, selection, read)
  assert.equal(JSON.stringify(canonical), before)
})
