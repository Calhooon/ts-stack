#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { appendFile, chmod, copyFile, lstat, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildMutationTargets } from '../governance/mutation-testing/targets.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const browserPin = Object.freeze(
  JSON.parse(readFileSync(new URL('./wallet-native-browser.json', import.meta.url), 'utf8'))
)
export function nativeBrowserPlan(platform = process.platform, architecture = process.arch) {
  if (platform !== 'linux' || architecture !== 'arm64')
    throw new Error('Pinned browser delivery requires the native Linux ARM64 worker')
  return browserPin
}
export function needsNativeBrowserDelivery(target) {
  if (target.packageDirectory !== 'packages/wallet/wallet-toolbox' || target.testRunner !== 'jest')
    return false
  const selected = target.runnerOptions?.jest?.config?.testMatch
  return (
    selected === undefined ||
    selected.some(
      file =>
        file.endsWith('/Brc38NativeBrowserComponents.test.cjs') ||
        file.endsWith('/BrowserArgon2idWorker.native.test.cjs') ||
        file.endsWith('/PackedIdbCurrentStructuredRead.test.ts')
    )
  )
}
export async function verifyBrowserFile(file, bytes, sha256) {
  const info = await lstat(file)
  assert.ok(
    info.isFile() && !info.isSymbolicLink(),
    'Browser artifact must be a regular owned file'
  )
  assert.equal(info.size, bytes, 'Browser artifact bytes differ from the source pin')
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(file)) digest.update(chunk)
  assert.equal(digest.digest('hex'), sha256, 'Browser artifact digest differs from the source pin')
}
function execute(program, args, timeout, maximum = 65536) {
  const result = spawnSync(program, args, {
    encoding: 'utf8',
    timeout,
    maxBuffer: maximum,
    killSignal: 'SIGTERM'
  })
  if (result.error || result.status !== 0 || result.signal !== null)
    throw new Error('Native browser delivery step failed or exceeded its bound', {
      cause: result.error
    })
  return result.stdout
}
export async function provisionNativeBrowser({
  archive,
  parent = process.env.RUNNER_TEMP ?? tmpdir()
} = {}) {
  const pin = nativeBrowserPlan()
  const privateRoot = await mkdtemp(join(parent, 'ts-wallet-native-browser-'))
  await chmod(privateRoot, 0o700)
  let delivered = false
  try {
    const ownedArchive = join(privateRoot, 'chrome.zip')
    if (archive !== undefined) {
      const info = await lstat(archive)
      assert.ok(
        info.isFile() && !info.isSymbolicLink(),
        'A supplied archive must be a regular file'
      )
      await copyFile(archive, ownedArchive, constants.COPYFILE_EXCL)
    } else {
      execute(
        'curl',
        [
          '--fail',
          '--silent',
          '--show-error',
          '--location',
          '--proto',
          '=https',
          '--max-time',
          '150',
          '--max-filesize',
          String(pin.archiveBytes),
          '--output',
          ownedArchive,
          pin.url
        ],
        180000
      )
    }
    await chmod(ownedArchive, 0o400)
    await verifyBrowserFile(ownedArchive, pin.archiveBytes, pin.archiveSha256)
    const entries = execute('unzip', ['-Z', '-1', ownedArchive], 10000, 1048576).trim().split('\n')
    assert.equal(entries.length, pin.archiveEntries)
    assert.ok(
      entries.every(
        entry =>
          entry.startsWith('chrome-linux-arm64/') &&
          !entry.split('/').includes('..') &&
          !entry.includes('\\')
      )
    )
    execute('unzip', ['-q', ownedArchive, '-d', privateRoot], 60000)
    const executable = join(privateRoot, pin.executableRelativePath)
    await verifyBrowserFile(executable, pin.executableBytes, pin.executableSha256)
    await chmod(executable, 0o500)
    await rm(ownedArchive)
    const sourceSha = execute('git', ['-C', root, 'rev-parse', 'HEAD'], 5000).trim()
    assert.match(sourceSha, /^[a-f0-9]{40}$/)
    const receipt = {
      kind: 'native-browser-delivery',
      sourceSha,
      ...pin,
      executable,
      runtimeQualified: false,
      processTreeQualified: false
    }
    await writeFile(
      join(privateRoot, 'component-delivery.json'),
      JSON.stringify(receipt, null, 2) + '\n',
      { mode: 0o600, flag: 'wx' }
    )
    delivered = true
    return receipt
  } finally {
    // Retain a delivered artifact for the enclosing job's actual browser work.
    // A delivery receipt grants no runtime, process-tree or host qualification.
    if (!delivered) await rm(privateRoot, { recursive: true, force: true })
  }
}
async function main() {
  const args = process.argv.slice(2)
  let archive, targetId
  while (args.length) {
    const flag = args.shift(),
      value = args.shift()
    if (!value || !['--archive', '--target'].includes(flag))
      throw new Error('Expected an exact --archive path or --target ID')
    if (flag === '--archive') {
      assert.equal(archive, undefined)
      archive = value
    } else {
      assert.equal(targetId, undefined)
      targetId = value
    }
  }
  if (targetId !== undefined) {
    const target = buildMutationTargets(root)[targetId]
    assert.ok(target, 'Unknown canonical mutation target')
    if (!needsNativeBrowserDelivery(target)) return
  }
  const receipt = await provisionNativeBrowser({ archive })
  if (process.env.GITHUB_ENV)
    await appendFile(process.env.GITHUB_ENV, 'CHROME_BIN=' + receipt.executable + '\n')
  console.log(JSON.stringify(receipt))
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error(
      'Pinned native browser delivery failed; no browser may be substituted or skipped.'
    )
    process.exitCode = 1
  })
}
