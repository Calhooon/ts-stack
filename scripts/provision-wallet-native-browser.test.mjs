import assert from 'node:assert/strict'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import test from 'node:test'
import {
  browserPin,
  nativeBrowserPlan,
  needsNativeBrowserDelivery,
  verifyBrowserFile
} from './provision-wallet-native-browser.mjs'

test('native browser delivery admits only the source-pinned real ARM64 distribution', () => {
  assert.equal(nativeBrowserPlan('linux', 'arm64'), browserPin)
  for (const [platform, architecture] of [
    ['linux', 'x64'],
    ['darwin', 'arm64'],
    ['win32', 'x64']
  ])
    assert.throws(() => nativeBrowserPlan(platform, architecture), /native Linux ARM64/)
  assert.equal(browserPin.deliveryOnly, true)
  assert.match(
    browserPin.url,
    /^https:\/\/storage\.googleapis\.com\/chrome-for-testing-public\/[0-9.]+\/linux-arm64\/chrome-linux-arm64\.zip$/
  )
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

test('enclosing native browser deadlines admit the original case and retained cleanup', () => {
  const require = createRequire(import.meta.url)
  const {
    nativeBrowserDriverTimeout,
    nativeBrowserTestTimeout
  } = require('../packages/wallet/wallet-toolbox/client/test/native-browser-driver.cjs')
  assert.ok(nativeBrowserDriverTimeout > 30000 + 30000)
  assert.ok(nativeBrowserTestTimeout > nativeBrowserDriverTimeout)
  assert.ok(nativeBrowserDriverTimeout < 120000)
})
