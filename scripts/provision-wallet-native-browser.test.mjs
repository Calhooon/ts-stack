import assert from 'node:assert/strict'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import test from 'node:test'
import {
  browserPin,
  browserPins,
  nativeBrowserPlan,
  needsNativeBrowserDelivery,
  verifyBrowserFile,
  cleanupNativeBrowserDelivery
} from './provision-wallet-native-browser.mjs'

test('native browser delivery selects the exact source-pinned ARM64 or x64 distribution', () => {
  assert.equal(nativeBrowserPlan('linux', 'arm64'), browserPin)
  assert.equal(nativeBrowserPlan('linux', 'x64'), browserPins.x64)
  assert.equal(Object.isFrozen(browserPins), true)
  for (const architecture of ['arm64', 'x64']) {
    const pin = nativeBrowserPlan('linux', architecture)
    assert.equal(Object.isFrozen(pin), true)
    assert.equal(pin.deliveryOnly, true)
    assert.equal(pin.buildId, browserPin.buildId)
    const distribution = architecture === 'arm64' ? 'linux-arm64' : 'linux64'
    assert.equal(pin.platform, distribution)
    assert.equal(
      pin.url,
      'https://storage.googleapis.com/chrome-for-testing-public/' +
        pin.buildId +
        '/' +
        distribution +
        '/chrome-' +
        distribution +
        '.zip'
    )
    assert.equal(pin.executableRelativePath, 'chrome-' + distribution + '/chrome')
    assert.match(pin.archiveSha256, /^[a-f0-9]{64}$/)
    assert.match(pin.executableSha256, /^[a-f0-9]{64}$/)
    assert.ok(Number.isSafeInteger(pin.archiveBytes) && pin.archiveBytes > 0)
    assert.ok(Number.isSafeInteger(pin.executableBytes) && pin.executableBytes > 0)
  }
  assert.notEqual(browserPins.x64.archiveSha256, browserPin.archiveSha256)
  assert.notEqual(browserPins.x64.executableSha256, browserPin.executableSha256)
  for (const [platform, architecture] of [
    ['linux', 'ia32'],
    ['linux', 'constructor'],
    ['linux', '__proto__'],
    ['darwin', 'arm64'],
    ['darwin', 'x64'],
    ['win32', 'x64']
  ])
    assert.throws(() => nativeBrowserPlan(platform, architecture), /native Linux ARM64\/x64/)
})
test('browser setup follows actual selected execution without downloading for node-only targets', () => {
  const target = selected => ({
    packageDirectory: 'packages/wallet/wallet-toolbox',
    testRunner: 'jest',
    runnerOptions: { jest: { config: { testMatch: selected } } }
  })
  assert.equal(needsNativeBrowserDelivery(target(['<rootDir>/src/component.test.ts'])), false)
  for (const file of [
    'src/storage/portable/Brc38NativeBrowserComponents.test.cjs',
    'src/utility/BrowserArgon2idWorker.native.test.cjs',
    'src/storage/snapshot/PackedIdbCurrentStructuredRead.test.ts'
  ])
    assert.equal(needsNativeBrowserDelivery(target(['<rootDir>/' + file])), true)
  for (const pattern of [
    '<rootDir>/src/**/*.test.{ts,cjs}',
    '<rootDir>/src/storage/portable/Brc38*.test.cjs',
    'src/utility/*.native.test.cjs',
    '<rootDir>/src/storage/snapshot/PackedIdb*.test.ts'
  ])
    assert.equal(needsNativeBrowserDelivery(target([pattern])), true, pattern)
  for (const patterns of [
    [],
    ['<rootDir>/src/schema/**/*.test.ts'],
    ['<rootDir>/src/**/*.test.ts', '!<rootDir>/src/storage/snapshot/PackedIdb*.test.ts'],
    ['!<rootDir>/src/**/*.test.{ts,cjs}'],
    ['<rootDir>/src/**/*.test.{ts,cjs}', '!<rootDir>/src/**']
  ])
    assert.equal(needsNativeBrowserDelivery(target(patterns)), false, String(patterns))
  assert.equal(
    needsNativeBrowserDelivery(
      target(['!<rootDir>/src/**', '<rootDir>/src/utility/*.native.test.cjs'])
    ),
    true
  )
  assert.equal(needsNativeBrowserDelivery(target(undefined)), true)
  assert.equal(
    needsNativeBrowserDelivery({ ...target(undefined), packageDirectory: 'packages/other' }),
    false
  )
})
test('browser delivery rejects changed bytes, incorrect lengths and symlink substitutes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'browser-delivery-contract-'))
  try {
    const file = join(directory, 'artifact'),
      alias = join(directory, 'alias')
    const original = Buffer.from('original artifact bytes'),
      hash = createHash('sha256').update(original).digest('hex')
    await writeFile(file, original)
    await verifyBrowserFile(file, original.length, hash)
    await assert.rejects(verifyBrowserFile(file, original.length + 1, hash), /bytes/)
    await writeFile(file, Buffer.from('replaced artifact bytes'))
    await assert.rejects(verifyBrowserFile(file, original.length, hash), /digest/)
    await symlink(file, alias)
    await assert.rejects(verifyBrowserFile(alias, original.length, hash), /regular owned file/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('measured browser admission preserves all other original case and cleanup bounds', () => {
  const require = createRequire(import.meta.url)
  const {
    nativeBrowserCaseTimeout,
    nativeBrowserDriverTimeout,
    nativeBrowserTestTimeout,
    nativeBrowserProtocolTimeout
  } = require('../packages/wallet/wallet-toolbox/client/test/native-browser-budgets.cjs')
  const catalogue = readFileSync(
    new URL(
      '../packages/wallet/wallet-toolbox/client/test/portable-program-browser.ts',
      import.meta.url
    ),
    'utf8'
  )
  const cases = [...catalogue.matchAll(/id: '([^']+)',/g)].map(match => match[1])
  assert.equal(cases.length, 60)
  for (const id of cases) {
    const inner = nativeBrowserCaseTimeout(id)
    assert.equal(inner, id === 'verifyIdbSnapshotSyncProvenTxReqs' ? 90000 : 30000)
    assert.ok(nativeBrowserDriverTimeout(id) >= inner + 30000 + 30000)
    assert.ok(nativeBrowserTestTimeout(id) > nativeBrowserDriverTimeout(id))
    assert.ok(nativeBrowserProtocolTimeout > inner)
    assert.ok(nativeBrowserTestTimeout(id) <= 160000)
  }
  assert.equal(nativeBrowserCaseTimeout(), 30000)
})

test('browser cleanup requires its explicit delivery receipt instead of adopting an ambient Chrome executable', async () => {
  assert.deepEqual(await cleanupNativeBrowserDelivery(), { allocated: false })
})
