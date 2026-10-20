import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const partitionFile = specification => specification.replace(/:\d+(?:-\d+)?$/, '')
const plans = new Map([
  [
    'sdk-auth-http',
    {
      fallback: 'core',
      files: new Map([
        ['src/auth/Peer.ts', 'peer'],
        ['src/auth/clients/AuthFetch.ts', 'client'],
        ['src/auth/transports/SimplifiedFetchTransport.ts', 'transport']
      ])
    }
  ],
  [
    'wallet-retained-snapshot',
    {
      fallback: 'lifecycle',
      files: new Map([
        ['src/storage/snapshot/KnexWalletReadSnapshot.ts', 'reader'],
        ['src/storage/StorageKnex.ts', 'storage'],
        ['src/storage/StorageProvider.ts', 'storage']
      ])
    }
  ],
  [
    'brc52-envelope',
    {
      fallback: 'envelope-1',
      lines: new Map([
        [
          'src/brc52/envelope.ts',
          [
            ['envelope-1', null],
            ['envelope-2', 'function exactKeys('],
            ['envelope-3', 'function strictSignature('],
            ['envelope-4', 'function graph('],
            ['envelope-5', 'export function validateBRC52Disclosure('],
            ['envelope-6', 'export function parseBRC52Envelope(']
          ]
        ]
      ])
    }
  ],
  [
    'brc52-status',
    {
      fallback: 'status-1',
      lines: new Map([
        [
          'src/brc52/status.ts',
          [
            ['status-1', null],
            ['status-2', 'function snapshotObservation(']
          ]
        ]
      ])
    }
  ],
  [
    'brc52-disclosure',
    {
      fallback: 'disclosure-1',
      lines: new Map([
        [
          'src/brc52/disclosure.ts',
          [
            ['disclosure-1', null],
            ['disclosure-2', 'function validateReceipt(']
          ]
        ]
      ])
    }
  ],
  [
    'air-gap-codec',
    {
      fallback: 'support',
      files: new Map([['src/encoder.ts', 'encoder']]),
      lines: new Map([
        [
          'src/decoder.ts',
          [
            ['decoder-1', null],
            ['decoder-2', '  private enterSession(']
          ]
        ]
      ])
    }
  ],
  [
    'mandala-encoding',
    {
      fallback: 'mandala',
      files: new Map([
        ['src/strictCbor.ts', 'cbor'],
        ['src/Bsv21Binary.ts', 'bsv21']
      ])
    }
  ],
  [
    'webrtpay-frames',
    {
      fallback: 'frames-1',
      lines: new Map([
        [
          'src/channel/frames.ts',
          [
            ['frames-1', null],
            ['frames-2', 'class StructureCounts {']
          ]
        ]
      ])
    }
  ],
  [
    'webrtpay-codes',
    {
      fallback: 'codes',
      files: new Map([['src/codec/sdp.ts', 'sdp']])
    }
  ]
])

function specificationLines(specification, lineCount) {
  const range = /:(\d+)(?:-(\d+))?$/.exec(specification)
  if (!range) return [1, lineCount]
  return [Number(range[1]), Number(range[2] ?? range[1])]
}

// A line plan cuts one file at explicit declaration markers. Each marker must
// start exactly one source line, so an edit that moves or duplicates it fails
// closed instead of silently shifting mutants between execution parts.
function lineSegments(target, file, cuts) {
  if (typeof target.packageDirectory !== 'string')
    throw new Error('Line-split mutation partition requires a package directory')
  const lines = readFileSync(path.resolve(ROOT, target.packageDirectory, file), 'utf8').split('\n')
  if (cuts.length < 2 || cuts[0][1] !== null)
    throw new Error('Line-split mutation partition must start at the first source line')
  const starts = cuts.map(([id, marker]) => {
    if (marker === null) return { id, line: 1 }
    const matches = lines.flatMap((line, index) => (line.startsWith(marker) ? [index + 1] : []))
    if (matches.length !== 1)
      throw new Error(`Mutation partition marker must start exactly one line in ${file}: ${marker}`)
    return { id, line: matches[0] }
  })
  for (let index = 1; index < starts.length; index += 1)
    if (starts[index].line <= starts[index - 1].line)
      throw new Error(`Mutation partition markers are out of order in ${file}`)
  return {
    lineCount: lines.length,
    segments: starts.map((start, index) => ({
      id: start.id,
      first: start.line,
      last: index + 1 < starts.length ? starts[index + 1].line - 1 : lines.length
    }))
  }
}

// Keep each file's complete original range union across its execution parts.
// File plans keep a whole file in one part; line plans intersect every original
// range with contiguous segments that cover the file. New canonical files join
// the target's fallback; a future helper cannot disappear.
export function partitionMutationTarget(targetId, target) {
  const plan = plans.get(targetId)
  if (!plan) return [{ id: 'whole', target }]
  const groups = new Map()
  const add = (id, specification) => {
    const mutate = groups.get(id) ?? []
    mutate.push(specification)
    groups.set(id, mutate)
  }
  const split = new Map()
  for (const specification of target.mutate) {
    const file = partitionFile(specification)
    if (/[!*?{}[\]]/.test(file) || path.posix.isAbsolute(file) || file.split('/').includes('..'))
      throw new Error('Mutation partition requires explicit canonical source paths')
    const cuts = plan.lines?.get(file)
    if (!cuts) {
      add(plan.files?.get(file) ?? plan.fallback, specification)
      continue
    }
    if (!split.has(file)) split.set(file, lineSegments(target, file, cuts))
    const { lineCount, segments } = split.get(file)
    const [first, last] = specificationLines(specification, lineCount)
    for (const segment of segments) {
      const from = Math.max(first, segment.first)
      const to = Math.min(last, segment.last)
      if (from <= to) add(segment.id, `${file}:${from}-${to}`)
    }
  }
  if (groups.size === 0) throw new Error('Empty canonical mutation source union')
  return [...groups].map(([id, mutate]) => ({ id, target: { ...target, mutate } }))
}

export function partitionedMutationTargets(selected, targets) {
  return [
    ...new Set(
      mutationExecutionMatrix(selected, targets)
        .include.filter(value => value.partition !== 'whole')
        .map(value => value.target)
    )
  ]
}

export function selectedMutationPartition(targetId, target, partition = 'whole') {
  if (partition === 'whole') return target
  const selected = partitionMutationTarget(targetId, target).find(value => value.id === partition)
  if (!selected) throw new Error(`Unknown mutation execution partition ${targetId}/${partition}`)
  return selected.target
}

export function mutationExecutionMatrix(selected, targets) {
  if (!Array.isArray(selected) || new Set(selected).size !== selected.length)
    throw new Error('Missing or duplicate canonical target selection')
  return {
    include: selected.flatMap(targetId => {
      if (!Object.hasOwn(targets, targetId)) throw new Error('Unknown canonical mutation target')
      return partitionMutationTarget(targetId, targets[targetId]).map(({ id }) => ({
        target: targetId,
        partition: id
      }))
    })
  }
}

export function partitionedTargetIds() {
  return [...plans.keys()]
}
