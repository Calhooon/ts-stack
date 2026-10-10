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
