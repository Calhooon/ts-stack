import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const rootCopyTestFile =
  'packages/wallet/wallet-toolbox/src/storage/portable/native/RootNativeCopyContracts.test.cjs'
export const rootCopyCaseNames = Object.freeze([
  'actual Linux root file-copy fixture preserves exact bytes, closes descriptors and conveys no Darwin ACL grant',
  ...['symlink', 'writable', 'hard-link', 'truncated', 'corrupted'].map(
    kind => `actual root-copy ${kind} source refuses; only a newly created failed file may remain`
  ),
  'a replaced root-copy parent refuses before creating a file in either directory',
  'root-copy failed close retains the actual descriptor and blocks another copy until idempotent retry'
])
function compareNames(first, second) {
  if (first < second) return -1
  if (first > second) return 1
  return 0
}
export function validateRootCopyReport(report, repositoryRoot = root) {
  assert.equal(report.success, true)
  assert.equal(report.numTotalTestSuites, 1)
  assert.equal(report.numPassedTestSuites, 1)
  assert.equal(report.numFailedTestSuites, 0)
  assert.equal(report.numPendingTestSuites, 0)
  assert.equal(report.numTotalTests, rootCopyCaseNames.length)
  assert.equal(report.numPassedTests, rootCopyCaseNames.length)
  assert.equal(report.numFailedTests, 0)
  assert.equal(report.numPendingTests, 0)
  assert.equal(report.numTodoTests, 0)
  assert.equal(report.testResults.length, 1)
  const suite = report.testResults[0]
  assert.equal(suite.name, resolve(repositoryRoot, rootCopyTestFile))
  assert.equal(suite.status, 'passed')
  assert.equal(suite.assertionResults.length, rootCopyCaseNames.length)
  assert.ok(suite.assertionResults.every(value => value.status === 'passed'))
  assert.deepEqual(
    suite.assertionResults.map(value => value.fullName).sort(compareNames),
    [...rootCopyCaseNames].sort(compareNames)
  )
  return { originalCases: rootCopyCaseNames.length, passed: rootCopyCaseNames.length }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 3)
  assert.ok(statSync(process.argv[2]).size <= 67108864)
  console.log(
    JSON.stringify(validateRootCopyReport(JSON.parse(readFileSync(process.argv[2], 'utf8'))))
  )
}
