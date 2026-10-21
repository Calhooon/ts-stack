import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildMutationTargets } from '../../governance/mutation-testing/targets.mjs'
import {
  partitionMutationTarget,
  canonicalMutationPartitions,
  applyPartitionComponentTests
} from '../mutation-partitions.mjs'
import { targetEvidence } from '../mutation-final-qualification.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const tuple = mutant =>
  JSON.stringify([
    mutant.fileName,
    mutant.mutatorName,
    mutant.replacement,
    mutant.location.start.line,
    mutant.location.start.column,
    mutant.location.end.line,
    mutant.location.end.column,
    mutant.status,
    mutant.statusReason
  ])
const targets = buildMutationTargets(root)
for (const id of ['sdk-auth-http', 'wallet-retained-snapshot'].filter(id =>
  Object.hasOwn(targets, id)
))
  test(`actual pinned ${id} partitions exhaust the original canonical mutant inventory and complete test configuration`, async () => {
    const target = targets[id]
    const canonical = await targetEvidence(root, target, id)
    const bootstrap =
      id === 'wallet-retained-snapshot'
        ? applyPartitionComponentTests(
            canonicalMutationPartitions(id, target).find(part => part.id === 'sqlite-bootstrap'),
            target.componentTestPartitions['sqlite-bootstrap'],
            file => readFileSync(join(root, target.packageDirectory, file))
          ).target
        : undefined
    const parts = await Promise.all(
      partitionMutationTarget(id, target).map(async part => ({
        ...part,
        evidence: await targetEvidence(root, part.target, id, part.id)
      }))
    )
    const actual = parts.flatMap(part => part.evidence.mutants.map(tuple)).sort()
    assert.deepEqual(actual, canonical.mutants.map(tuple).sort())
    assert.equal(new Set(actual).size, actual.length)
    const children = parts.filter(
      part => id === 'wallet-retained-snapshot' && /^sqlite-bootstrap-\d{3}$/.test(part.id)
    )
    assert.equal(children.length, bootstrap === undefined ? 0 : 6)
    for (const part of parts) {
      const component = children.includes(part)
      assert.deepEqual(
        part.target.runnerOptions,
        component ? bootstrap.runnerOptions : target.runnerOptions
      )
      const expectedConfig = component
        ? {
            ...canonical.config,
            jest: {
              ...canonical.config.jest,
              config: {
                ...canonical.config.jest.config,
                testMatch: bootstrap.runnerOptions.jest.config.testMatch
              }
            }
          }
        : canonical.config
      const comparable = ({ mutate: _mutate, jsonReporter: _reporter, ...config }) => config
      assert.deepEqual(comparable(part.evidence.config), comparable(expectedConfig))
    }
  })
