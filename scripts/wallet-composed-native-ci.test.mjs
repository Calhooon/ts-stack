import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import * as nativeRouting from './wallet-composed-native-ci.mjs'
import {
  composedNativeTestFile,
  composedNativeCohorts,
  composedNativeCaseNames,
  walletCoverageMatrix,
  validateComposedNativeReport,
  validateComposedNativeReceipts,
  validateComposedNativeReceiptReport,
  nativePairTestFile,
  nativePairCohorts,
  nativePairCaseNames,
  validateNativePairReport,
  validateNativePairReceipts,
  validateNativePairReceiptReport
} from './wallet-composed-native-ci.mjs'

function makeReport(cohort, testFile, names) {
  return {
    success: true,
    numTotalTestSuites: 1,
    numPassedTestSuites: 1,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    numTotalTests: names.length,
    numPassedTests: cohort.cases,
    numFailedTests: 0,
    numPendingTests: names.length - cohort.cases,
    numTodoTests: 0,
    testResults: [
      {
        name: '/repo/' + testFile,
        assertionResults: names.map(fullName => ({
          fullName,
          status: fullName === cohort.name ? 'passed' : 'pending',
          failureMessages: []
        }))
      }
    ]
  }
}

const report = cohort => makeReport(cohort, composedNativeTestFile, composedNativeCaseNames)

test('routing preserves all21 original cases including both identical completed names and existing coverage lanes', () => {
  assert.equal(composedNativeCaseNames.length, 21)
  assert.equal(composedNativeCohorts.length, 20)
  const matrix = walletCoverageMatrix().include
  assert.equal(matrix.length, 50)
  assert.equal(new Set(matrix.map(value => value.id)).size, 50)
  assert.deepEqual(
    matrix.filter(value => value.shard).map(value => value.shard),
    [1, 2, 3, 4]
  )
  assert.deepEqual(
    matrix.filter(value => value.latency !== undefined).map(value => value.latency),
    [0, 1000]
  )
  for (const cohort of composedNativeCohorts) {
    const names = composedNativeCaseNames.filter(value => new RegExp(cohort.pattern).test(value))
    assert.equal(names.length, cohort.cases)
    assert.ok(names.every(value => value === cohort.name))
    assert.equal(new RegExp(cohort.pattern).test(cohort.name + ' changed'), false)
    assert.equal(validateComposedNativeReport(report(cohort), cohort.id).passedCases, cohort.cases)
  }
})

test('all6 original native merge contracts have disjoint mandatory lanes and bounded allowances', () => {
  assert.equal(nativeRouting.nativeMergeCohorts?.length, 6)
  assert.equal(nativeRouting.nativeMergeCaseNames.length, 6)
  assert.equal(new Set(nativeRouting.nativeMergeCaseNames).size, 6)
  const selected = walletCoverageMatrix().include.filter(value => value.native_merge_cohort)
  assert.deepEqual(
    selected.map(value => value.native_merge_cohort),
    nativeRouting.nativeMergeCohorts.map(value => value.id)
  )
  for (const cohort of nativeRouting.nativeMergeCohorts) {
    assert.deepEqual(
      nativeRouting.nativeMergeCaseNames.filter(name => new RegExp(cohort.pattern).test(name)),
      [cohort.name]
    )
    assert.equal(new RegExp(cohort.pattern).test(cohort.name + ' changed'), false)
    assert.equal(cohort.minutes, cohort.id.startsWith('proof-') ? 40 : 90)
    assert.equal(
      selected.find(value => value.native_merge_cohort === cohort.id).native_merge_minutes,
      cohort.minutes
    )
  }
})

test('all18 independent original pair cases have disjoint mandatory lanes', () => {
  assert.equal(nativePairCohorts.length, 18)
  assert.equal(nativePairCaseNames.length, 18)
  assert.equal(new Set(nativePairCaseNames).size, 18)
  assert.deepEqual(
    walletCoverageMatrix()
      .include.filter(value => value.native_pair_cohort)
      .map(value => value.native_pair_cohort),
    nativePairCohorts.map(value => value.id)
  )
  for (const cohort of nativePairCohorts) {
    assert.deepEqual(
      nativePairCaseNames.filter(name => new RegExp(cohort.pattern).test(name)),
      [cohort.name]
    )
    assert.equal(new RegExp(cohort.pattern).test(cohort.name + ' changed'), false)
  }
})

for (const family of [
  {
    label: 'composed',
    file: composedNativeTestFile,
    cohorts: composedNativeCohorts,
    names: composedNativeCaseNames,
    report: validateComposedNativeReport,
    receipts: validateComposedNativeReceipts,
    bytes: validateComposedNativeReceiptReport
  },
  {
    label: 'pair',
    file: nativePairTestFile,
    cohorts: nativePairCohorts,
    names: nativePairCaseNames,
    report: validateNativePairReport,
    receipts: validateNativePairReceipts,
    bytes: validateNativePairReceiptReport
  },
  {
    label: 'merge',
    file: nativeRouting.nativeMergeTestFile,
    cohorts: nativeRouting.nativeMergeCohorts,
    names: nativeRouting.nativeMergeCaseNames,
    report: nativeRouting.validateNativeMergeReport,
    receipts: nativeRouting.validateNativeMergeReceipts,
    bytes: nativeRouting.validateNativeMergeReceiptReport
  }
]) {
  const composedNativeTestFile = family.file
  const composedNativeCohorts = family.cohorts
  const composedNativeCaseNames = family.names
  const validateComposedNativeReport = family.report
  const validateComposedNativeReceipts = family.receipts
  const validateComposedNativeReceiptReport = family.bytes
  const report = cohort => makeReport(cohort, family.file, family.names)
  test(`${family.label}: an empty, missing, duplicate, renamed or wrong-file inventory cannot pass a cohort`, () => {
    const cohort = composedNativeCohorts[0]
    const mutations = [
      value => {
        value.testResults = []
      },
      value => {
        value.testResults[0].assertionResults.pop()
      },
      value => {
        value.testResults[0].assertionResults[0].fullName = 'another case'
      },
      value => {
        value.testResults[0].assertionResults[0] = value.testResults[0].assertionResults[1]
      },
      value => {
        value.testResults[0].name = '/repo/Another.test.ts'
      },
      value => {
        value.testResults[0].name = '/another-directory/' + composedNativeTestFile.split('/').at(-1)
      }
    ]
    for (const mutate of mutations) {
      const value = report(cohort)
      mutate(value)
      assert.throws(() => validateComposedNativeReport(value, cohort.id))
    }
    assert.throws(() => validateComposedNativeReport(report(cohort), 'unknown'))
  })

  test(`${family.label}: selected skips, extra execution, failures, TODOs and inflated counts fail despite success true`, () => {
    const cohort = composedNativeCohorts[0]
    const mutations = [
      value => {
        value.testResults[0].assertionResults.find(item => item.fullName === cohort.name).status =
          'pending'
      },
      value => {
        value.testResults[0].assertionResults.find(item => item.fullName !== cohort.name).status =
          'passed'
      },
      value => {
        value.testResults[0].assertionResults[0].failureMessages.push('failure')
      },
      value => {
        value.numFailedTests = 1
      },
      value => {
        value.numPassedTests++
      },
      value => {
        value.numTodoTests = 1
      },
      value => {
        value.numPendingTests--
      }
    ]
    for (const mutate of mutations) {
      const value = report(cohort)
      mutate(value)
      assert.throws(() => validateComposedNativeReport(value, cohort.id))
    }
  })

  test(`${family.label}: the global union requires every cohort once at the current head, test source and plan`, () => {
    const identity = {
      head: 'current-head',
      testFileSha256: 'current-source',
      planSha256: 'current-plan'
    }
    const receipts = composedNativeCohorts.map(cohort => ({
      ...validateComposedNativeReport(report(cohort), cohort.id),
      identity,
      reportSha256: 'a'.repeat(64)
    }))
    assert.equal(validateComposedNativeReceipts(receipts, identity), composedNativeCaseNames.length)
    assert.throws(() => validateComposedNativeReceipts(receipts.slice(1), identity))
    const duplicate = structuredClone(receipts)
    duplicate[0] = duplicate[1]
    assert.throws(() => validateComposedNativeReceipts(duplicate, identity))
    for (const field of Object.keys(identity)) {
      const stale = structuredClone(receipts)
      stale[0].identity[field] = 'stale'
      assert.throws(() => validateComposedNativeReceipts(stale, identity))
    }
    if (family.label === 'composed') {
      const completed = structuredClone(receipts)
      completed.find(value => value.cohort === 'completed').passedCases = 1
      assert.throws(() => validateComposedNativeReceipts(completed, identity))
    }
  })

  test(`${family.label}: aggregate verification rereads the original runtime report rather than trusting receipt counts`, () => {
    const cohort = composedNativeCohorts[0]
    const bytes = Buffer.from(JSON.stringify(report(cohort)))
    const receipt = {
      ...validateComposedNativeReport(report(cohort), cohort.id),
      reportSha256: createHash('sha256').update(bytes).digest('hex')
    }
    assert.equal(validateComposedNativeReceiptReport(receipt, bytes).passedCases, 1)
    assert.throws(() =>
      validateComposedNativeReceiptReport(receipt, Buffer.concat([bytes, Buffer.from(' ')]))
    )
    assert.throws(() => validateComposedNativeReceiptReport({ ...receipt, passedCases: 0 }, bytes))
    const skipped = report(cohort)
    skipped.testResults[0].assertionResults.find(value => value.fullName === cohort.name).status =
      'pending'
    const changed = Buffer.from(JSON.stringify(skipped))
    assert.throws(() =>
      validateComposedNativeReceiptReport(
        {
          ...receipt,
          reportSha256: createHash('sha256').update(changed).digest('hex')
        },
        changed
      )
    )
  })
}
