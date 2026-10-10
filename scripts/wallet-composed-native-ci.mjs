#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

export const composedNativeTestFile =
  'packages/wallet/wallet-toolbox/src/storage/portable/Brc39ComposedNativeRecoveryNode.test.ts'

const phases = ['READY', 'DELETE_ACTIVATING', 'DELETE_ACTIVE', 'WAL_ACTIVATING', 'WAL', 'COMPLETED']
const retiredName = (phase, recovery) =>
  `actual retired ${phase} target resumes through ${recovery} without changing original limits`
const simpleCases = [
  [
    'customer',
    'actual occupied import, current restart and repeat import preserve a later full TEXT customer write'
  ],
  [
    'cancel-authenticated',
    'cancellation after drained AUTHENTICATED work preserves the serving wallet'
  ],
  ['cancel-import', 'cancellation after drained IMPORT work preserves the serving wallet'],
  [
    'failed-close',
    'failed READY target cleanup retains its concrete owner until retry, then named recovery completes'
  ],
  [
    'inactive-retry',
    'inactive composed retry withdraws the original copy and preserves its reservation, limits and semantic postimage'
  ],
  [
    'occupied-history',
    'retained occupied history callback replays independent legacy bytes and revokes escaped readers'
  ],
  ['request-writer', 'actual native request writer preserves omitted legacy broadcast counters'],
  [
    'physical-coordinate',
    'actual composed current transaction field selection preserves its physical coordinate'
  ],
  [
    'request-identity',
    'actual occupied native request identity reuses the original legacy archive spelling'
  ]
]
const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// COMPLETED has the same original name for live and expired admissions. Keep
// both in one cohort, with multiplicity two; neither original case is renamed.
export const composedNativeCohorts = Object.freeze(
  [
    ...simpleCases.map(([id, name]) => ({ id, name, cases: 1 })),
    ...phases.flatMap(phase =>
      phase === 'COMPLETED'
        ? [{ id: 'completed', name: retiredName(phase, 'COMPLETED_CURRENT'), cases: 2 }]
        : ['LIVE_PENDING', 'EXPIRED_PENDING'].map(recovery => ({
            id: `${phase.toLowerCase()}-${recovery.toLowerCase()}`,
            name: retiredName(phase, recovery),
            cases: 1
          }))
    )
  ].map(value => Object.freeze({ ...value, pattern: `^${escapePattern(value.name)}$` }))
)

export const composedNativeCaseNames = Object.freeze(
  composedNativeCohorts.flatMap(cohort => Array(cohort.cases).fill(cohort.name)).sort()
)

export function walletCoverageMatrix() {
  return {
    include: [
      ...[1, 2, 3, 4].map(shard => ({ id: `shard-${shard}`, shard })),
      ...[0, 1000].map(latency => ({ id: `sync-http-${latency}`, latency })),
      ...composedNativeCohorts.map(cohort => ({
        id: `native-${cohort.id}`,
        native_cohort: cohort.id
      }))
    ]
  }
}

export function composedNativeCohort(id) {
  const cohort = composedNativeCohorts.find(value => value.id === id)
  if (cohort === undefined) throw new Error('Unknown composed native cohort')
  return cohort
}

export function validateComposedNativeReport(report, cohortId) {
  const cohort = composedNativeCohort(cohortId)
  const suite = report?.testResults?.[0]
  const assertions = suite?.assertionResults
  if (
    report?.success !== true ||
    report.numTotalTestSuites !== 1 ||
    report.numPassedTestSuites !== 1 ||
    report.numFailedTestSuites !== 0 ||
    report.numPendingTestSuites !== 0 ||
    report.testResults.length !== 1 ||
    !suite.name?.replaceAll('\\', '/').endsWith('/' + composedNativeTestFile) ||
    !Array.isArray(assertions) ||
    assertions.length !== composedNativeCaseNames.length ||
    !isDeepStrictEqual(assertions.map(value => value.fullName).sort(), composedNativeCaseNames)
  )
    throw new Error('Composed native report lacks the complete original case inventory')
  for (const value of assertions) {
    const selected = value.fullName === cohort.name
    if (value.status !== (selected ? 'passed' : 'pending') || value.failureMessages?.length !== 0)
      throw new Error('Composed native selected case failed, skipped or differs from its cohort')
  }
  if (
    report.numTotalTests !== composedNativeCaseNames.length ||
    report.numPassedTests !== cohort.cases ||
    report.numFailedTests !== 0 ||
    report.numPendingTests !== composedNativeCaseNames.length - cohort.cases ||
    report.numTodoTests !== 0 ||
    assertions.filter(value => value.status === 'passed').length !== cohort.cases
  )
    throw new Error('Composed native selected execution count differs')
  return {
    cohort: cohort.id,
    passedCases: cohort.cases,
    originalCaseCount: composedNativeCaseNames.length
  }
}

export function validateComposedNativeReceipts(receipts, identity) {
  if (!Array.isArray(receipts) || receipts.length !== composedNativeCohorts.length)
    throw new Error('Missing complete composed native cohort receipts')
  const seen = new Set()
  let total = 0
  for (const receipt of receipts) {
    const cohort = composedNativeCohort(receipt.cohort)
    if (
      seen.has(cohort.id) ||
      !isDeepStrictEqual(receipt.identity, identity) ||
      receipt.passedCases !== cohort.cases ||
      receipt.originalCaseCount !== composedNativeCaseNames.length ||
      typeof receipt.reportSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(receipt.reportSha256)
    )
      throw new Error('Duplicate, stale or incomplete composed native cohort receipt')
    seen.add(cohort.id)
    total += receipt.passedCases
  }
  if (total !== composedNativeCaseNames.length)
    throw new Error('Composed native case union differs')
  return total
}

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
export function validateComposedNativeReceiptReport(receipt, bytes) {
  if (receipt.reportSha256 !== digest(bytes))
    throw new Error('Composed native runtime report changed')
  const actual = validateComposedNativeReport(JSON.parse(bytes.toString('utf8')), receipt.cohort)
  if (
    actual.passedCases !== receipt.passedCases ||
    actual.originalCaseCount !== receipt.originalCaseCount
  )
    throw new Error('Composed native receipt differs from actual runtime report')
  return actual
}
function identity(root) {
  return {
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    testFileSha256: digest(fs.readFileSync(path.join(root, composedNativeTestFile))),
    planSha256: digest(fs.readFileSync(fileURLToPath(import.meta.url)))
  }
}
function receiptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) return receiptFiles(filename)
    return entry.isFile() && entry.name.endsWith('.composed-native.json') ? [filename] : []
  })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const [command, ...args] = process.argv.slice(2)
    const root = fileURLToPath(new URL('..', import.meta.url))
    if (command === 'matrix' && args.length === 0) {
      console.log(JSON.stringify(walletCoverageMatrix()))
    } else if (command === 'pattern' && args.length === 1) {
      console.log(composedNativeCohort(args[0]).pattern)
    } else if (command === 'capture' && args.length === 3) {
      const bytes = fs.readFileSync(args[1])
      const report = JSON.parse(bytes.toString('utf8'))
      const verified = validateComposedNativeReport(report, args[0])
      fs.writeFileSync(args[2] + '.jest.json', bytes, { flag: 'wx' })
      fs.writeFileSync(
        args[2],
        JSON.stringify(
          { ...verified, identity: identity(root), reportSha256: digest(bytes) },
          null,
          2
        ) + '\n',
        { flag: 'wx' }
      )
    } else if (command === 'verify' && args.length === 1) {
      const receipts = receiptFiles(args[0]).map(filename => {
        const receipt = JSON.parse(fs.readFileSync(filename, 'utf8'))
        validateComposedNativeReceiptReport(receipt, fs.readFileSync(filename + '.jest.json'))
        return receipt
      })
      console.log(
        `All ${validateComposedNativeReceipts(receipts, identity(root))} original composed native cases passed`
      )
    } else
      throw new Error(
        'Expected matrix, pattern <cohort>, capture <cohort> <report> <receipt>, or verify <directory>'
      )
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause))
    process.exitCode = 1
  }
}
