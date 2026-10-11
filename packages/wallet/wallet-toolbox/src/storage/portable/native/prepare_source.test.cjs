'use strict'

// Source-preparation I/O cases only. They do not run a compiler/native engine or
// convert a source manifest into admission/qualification evidence.
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { prepareNativeSource, NativeSourceCleanupError } = require('./prepare_source.cjs')

let directory
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'native-source-data-'))
})
afterEach(async () => {
  jest.restoreAllMocks()
  await fs.rm(directory, { recursive: true, force: true })
})

test('a missing pinned dependency removes only its owned source directory and preserves neighboring input', async () => {
  const neighbor = path.join(directory, 'neighbor')
  await fs.writeFile(neighbor, 'preserved', { flag: 'wx' })
  await expect(prepareNativeSource(path.join(directory, 'missing-input'), directory)).rejects.toThrow()
  expect(await fs.readdir(directory)).toEqual(['neighbor'])
  expect(await fs.readFile(neighbor, 'utf8')).toBe('preserved')
})
test('a symlink dependency is refused before reading its target and no incomplete source manifest remains', async () => {
  const input = path.join(directory, 'sqlite-input')
  await fs.mkdir(input)
  const unrelated = path.join(directory, 'unrelated')
  await fs.writeFile(unrelated, 'preserved', { flag: 'wx' })
  await fs.symlink(unrelated, path.join(input, 'sqlite3.c'))
  await expect(prepareNativeSource(input, directory)).rejects.toThrow()
  expect((await fs.readdir(directory)).sort()).toEqual(['sqlite-input', 'unrelated'])
  expect(await fs.readFile(unrelated, 'utf8')).toBe('preserved')
})

test('a descriptor close failure retains its owned source directory until concrete retry finishes disposal', async () => {
  const originalOpen = fs.open,
    reason = new Error('synthetic descriptor-close refusal')
  let injected = false
  const opened = jest.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await originalOpen(...args)
    if (!injected && String(args[0]).endsWith('native_driver.c') && args[1] === 'wx') {
      injected = true
      const originalClose = handle.close.bind(handle)
      let first = true
      handle.close = async () => {
        if (first) {
          first = false
          throw reason
        }
        await originalClose()
      }
    }
    return handle
  })
  const failure = await prepareNativeSource(path.join(directory, 'missing-input'), directory).then(
    () => undefined,
    error => error
  )
  expect(failure).toBeInstanceOf(NativeSourceCleanupError)
  const retained = await fs.readdir(directory)
  expect(retained).toHaveLength(1)
  expect(retained[0]).toMatch(/^wallet-native-source-/)
  opened.mockRestore()
  await failure.retryCleanup()
  expect(await fs.readdir(directory)).toEqual([])
  await failure.retryCleanup()
})

// Pure recipe/source capture on the current controlled worker. These targets
// select build DATA only; no compiler, native engine or other OS is executed.
test.each([
  ['linux', 'arm64'],
  ['linux', 'x64'],
  ['darwin', 'arm64'],
  ['darwin', 'x64']
])(
  'complete %s/%s source plan includes every transitive driver file and exact pinned SQLite inputs',
  async (platform, architecture) => {
    const crypto = require('node:crypto'),
      sqliteDirectory = path.join(path.dirname(require.resolve('better-sqlite3/package.json')), 'deps/sqlite3'),
      { driverSources, windowsAddonSources, sqliteFiles, unixCompilerArguments } = require('./source_recipe.cjs'),
      prepared = await prepareNativeSource(sqliteDirectory, directory, { platform, architecture }),
      source = JSON.parse(await fs.readFile(path.join(prepared.directory, 'source.json'), 'utf8')),
      expected = [...driverSources, ...windowsAddonSources, ...sqliteFiles.map(input => input.name)]
    expect(source).toEqual(prepared.source)
    expect(source.inputs.map(input => input.name)).toEqual(expected)
    // The driver entry is independently required; matching shared lists alone
    // must not conceal a missing entry point. Its actual transitive includes
    // are checked below. SQLite amalgamation and Windows bootstrap policy have
    // separate dependency/generated-input contracts.
    expect(expected).toContain('native_driver.c')
    expect(new Set(expected).size).toBe(expected.length)
    expect(source.platform).toBe(platform)
    expect(source.architecture).toBe(architecture)
    expect(source.compiler.cwd).toBe(prepared.directory)
    expect(source.compiler.arguments).toEqual(unixCompilerArguments(platform, architecture))
    expect(source.compiled).toBe(false)
    expect(source.engineExecuted).toBe(false)
    expect(source.qualified).toBe(false)
    for (const input of source.inputs) {
      const actual = await fs.readFile(path.join(prepared.directory, input.name))
      expect(actual.length).toBe(input.bytes)
      expect(crypto.createHash('sha256').update(actual).digest('hex')).toBe(input.sha256)
      if (driverSources.includes(input.name) && input.name.endsWith('.c')) {
        for (const included of actual.toString('utf8').matchAll(/^#include "([^"/]+)"/gm))
          expect(expected).toContain(included[1])
      }
    }
    for (const dependency of sqliteFiles)
      expect(source.inputs.find(input => input.name === dependency.name)).toEqual(dependency)
    expect(crypto.createHash('sha256').update(JSON.stringify(source)).digest('hex')).toBe(prepared.manifestSha256)
    if (platform === 'darwin') {
      expect(source.compiler.arguments.slice(0, 2)).toEqual(['-arch', architecture === 'arm64' ? 'arm64' : 'x86_64'])
      expect(source.compiler.arguments).not.toContain('-ldl')
      expect(source.compiler.arguments).not.toContain('-D_GNU_SOURCE')
    } else {
      expect(source.compiler.arguments).toContain('-ldl')
      expect(source.compiler.arguments).toContain('-D_GNU_SOURCE')
    }
  }
)
test.each([
  ['win32', 'x64'],
  ['linux', 'ia32'],
  ['darwin', 'unknown'],
  ['unknown', 'arm64']
])(
  'unsupported %s/%s preparation refuses before reading input or creating source assets',
  async (platform, architecture) => {
    await expect(
      prepareNativeSource(path.join(directory, 'absent'), directory, { platform, architecture })
    ).rejects.toThrow('controlled supported Unix worker')
    expect(await fs.readdir(directory)).toEqual([])
  }
)

// Synthetic format headers are DATA only, never executable host proof.
function targetHeader(platform, architecture, kind = 'driver') {
  const bytes = Buffer.alloc(platform === 'win32' ? 200 : platform === 'linux' ? 64 : 32)
  if (platform === 'linux') {
    Buffer.from('7f454c4602010100', 'hex').copy(bytes)
    bytes.writeUInt16LE(3, 16)
    bytes.writeUInt16LE(architecture === 'arm64' ? 183 : 62, 18)
    bytes.writeUInt32LE(1, 20)
    bytes.writeUInt16LE(64, 52)
  } else if (platform === 'darwin') {
    bytes.writeUInt32LE(0xfeedfacf, 0)
    bytes.writeUInt32LE(architecture === 'arm64' ? 0x0100000c : 0x01000007, 4)
    bytes.writeUInt32LE(2, 12)
  } else {
    bytes.writeUInt16LE(0x5a4d, 0)
    bytes.writeUInt32LE(64, 60)
    bytes.writeUInt32LE(0x4550, 64)
    bytes.writeUInt16LE(architecture === 'arm64' ? 0xaa64 : 0x8664, 68)
    bytes.writeUInt16LE(112, 84)
    bytes.writeUInt16LE(kind === 'addon' ? 0x2002 : 2, 86)
    bytes.writeUInt16LE(0x20b, 88)
  }
  return bytes
}
test.each([
  ['linux', 'arm64', 'driver'],
  ['linux', 'x64', 'driver'],
  ['darwin', 'arm64', 'driver'],
  ['darwin', 'x64', 'driver'],
  ['win32', 'arm64', 'driver'],
  ['win32', 'x64', 'driver'],
  ['win32', 'arm64', 'addon'],
  ['win32', 'x64', 'addon']
])(
  'captured %s/%s/%s header matches only its actual target and complete format header',
  (platform, architecture, kind) => {
    const { assertNativeCandidateTarget: check } = require('./source_recipe.cjs'),
      bytes = targetHeader(platform, architecture, kind)
    expect(() => check(bytes, platform, architecture, kind)).not.toThrow()
    expect(() => check(bytes, platform, architecture === 'arm64' ? 'x64' : 'arm64', kind)).toThrow(
      'image differs from its build target'
    )
    for (const length of [0, 3, 31, bytes.length - 1])
      expect(() => check(bytes.subarray(0, length), platform, architecture, kind)).toThrow(
        'image differs from its build target'
      )
    if (platform === 'win32')
      expect(() => check(bytes, platform, architecture, kind === 'addon' ? 'driver' : 'addon')).toThrow(
        'image differs from its build target'
      )
  }
)
test.each([
  ['linux', 0, 'u32', 0],
  ['linux', 4, 'u8', 1],
  ['linux', 5, 'u8', 2],
  ['linux', 6, 'u8', 0],
  ['linux', 16, 'u16', 1],
  ['linux', 20, 'u32', 0],
  ['linux', 52, 'u16', 63],
  ['darwin', 0, 'u32', 0xcafebabe],
  ['darwin', 12, 'u32', 1],
  ['win32', 0, 'u16', 0],
  ['win32', 60, 'u32', 0],
  ['win32', 60, 'u32', 0xffffffff],
  ['win32', 64, 'u32', 0],
  ['win32', 84, 'u16', 0],
  ['win32', 84, 'u16', 0xffff],
  ['win32', 86, 'u16', 0],
  ['win32', 88, 'u16', 0x10b]
])('captured %s malformed target field at %i refuses a successful build receipt', (platform, offset, width, value) => {
  const { assertNativeCandidateTarget: check } = require('./source_recipe.cjs'),
    bytes = targetHeader(platform, 'arm64')
  if (width === 'u8') bytes.writeUInt8(value, offset)
  else if (width === 'u16') bytes.writeUInt16LE(value, offset)
  else bytes.writeUInt32LE(value, offset)
  expect(() => check(bytes, platform, 'arm64')).toThrow('image differs from its build target')
})
test('target checks preserve fixed ELF executable type and refuse unsupported selectors without running bytes', () => {
  const { assertNativeCandidateTarget: check } = require('./source_recipe.cjs'),
    bytes = targetHeader('linux', 'arm64')
  bytes.writeUInt16LE(2, 16)
  expect(() => check(bytes, 'linux', 'arm64')).not.toThrow()
  for (const [platform, architecture, kind] of [
    ['linux', 'ia32', 'driver'],
    ['linux', 'arm64', 'addon'],
    ['darwin', 'arm64', 'addon'],
    ['unknown', 'arm64', 'driver'],
    ['win32', 'arm64', 'unknown']
  ])
    expect(() => check(bytes, platform, architecture, kind)).toThrow('image differs from its build target')
  expect(() => check({}, 'linux', 'arm64')).toThrow('image differs from its build target')
})
