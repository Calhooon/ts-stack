import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'
import {
  rootCopyCaseNames,
  rootCopyTestFile,
  validateRootCopyReport
} from './wallet-native-root-copy-ci.mjs'

function complete() {
  return {
    success: true,
    numTotalTestSuites: 1,
    numPassedTestSuites: 1,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    numTotalTests: 8,
    numPassedTests: 8,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    testResults: [
      {
        name: resolve(rootCopyTestFile),
        status: 'passed',
        assertionResults: rootCopyCaseNames.map(fullName => ({ fullName, status: 'passed' }))
      }
    ]
  }
}
test('all eight original root-copy cases are mandatory even when aggregate success is asserted', () => {
  assert.deepEqual(validateRootCopyReport(complete(), process.cwd()), {
    originalCases: 8,
    passed: 8
  })
  for (const defect of [
    'missing',
    'duplicate',
    'pending',
    'failed',
    'foreign-file',
    'wrong-count',
    'todo'
  ]) {
    const report = complete(),
      suite = report.testResults[0]
    if (defect === 'missing') suite.assertionResults.pop()
    if (defect === 'duplicate')
      suite.assertionResults[1].fullName = suite.assertionResults[0].fullName
    if (defect === 'pending') suite.assertionResults[0].status = 'pending'
    if (defect === 'failed') suite.assertionResults[0].status = 'failed'
    if (defect === 'foreign-file') suite.name += '.foreign'
    if (defect === 'wrong-count') report.numPassedTests = 7
    if (defect === 'todo') report.numTodoTests = 1
    assert.throws(() => validateRootCopyReport(report, process.cwd()), undefined, defect)
  }
})
