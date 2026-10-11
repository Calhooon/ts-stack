import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { buildMutationTargets } from '../governance/mutation-testing/targets.mjs'

const wallet = resolve(import.meta.dirname, '../packages/wallet/wallet-toolbox')
const require = createRequire(join(wallet, 'package.json'))
const { createTransformer } = require('ts-jest').default

test('wallet TypeScript transform retains its compiler configuration in a relocated mutation sandbox', async () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'wallet-jest-config-'))
  try {
    // Mirror the copied package's relative extends: it is invalid at this depth.
    // A transform that discovers this file from the relocated root must fail.
    writeFileSync(
      join(sandbox, 'tsconfig.json'),
      JSON.stringify({ extends: './missing-shared-config.json' })
    )
    copyFileSync(join(wallet, 'jest.config.cjs'), join(sandbox, 'jest.config.cjs'))
    copyFileSync(join(wallet, 'tsconfig.jest.json'), join(sandbox, 'tsconfig.jest.json'))
    const copiedConfig = await require(join(sandbox, 'jest.config.cjs'))()
    const target = buildMutationTargets(resolve(import.meta.dirname, '..'))[
      'wallet-current-brc38-authenticated-private-stage-node'
    ]
    const config = { ...copiedConfig, ...target.runnerOptions.jest.config, rootDir: sandbox }
    const source = 'export const result: number = 6 * 7'
    const filename = join(sandbox, 'example.ts')
    writeFileSync(filename, source)
    const options = {
      config,
      configString: JSON.stringify(config),
      cacheFS: new Map(),
      instrument: false,
      supportsDynamicImport: false,
      supportsExportNamespaceFrom: false,
      supportsStaticESM: false,
      supportsTopLevelAwait: false
    }
    const [, compiler] = config.transform['^.+\\.ts$']
    const transformed = createTransformer(compiler).process(source, filename, options)
    const exports = {}
    runInNewContext(transformed.code, { exports })
    assert.equal(exports.result, 42)
    const copiedOptions = { ...copiedConfig, rootDir: sandbox }
    const [, copiedCompiler] = copiedConfig.transform['^.+\\.ts$']
    assert.throws(
      () =>
        createTransformer(copiedCompiler).process(source, filename, {
          ...options,
          config: copiedOptions,
          configString: JSON.stringify(copiedOptions)
        }),
      /missing-shared-config/
    )
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})
