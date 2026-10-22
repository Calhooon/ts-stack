import { describe, expect, it } from '@jest/globals'
import { ColorStore, type TxRecord } from '../store.js'
import { C0, FakeStore } from './profileFixtures.js'

// A txid whose wire (reversed) order differs from its display order.
const TXID = '11'.repeat(31) + '22'
const HEADER = '01010101' + '22' + '11'.repeat(31)
const ATTESTATION = {
  txid: C0.TXID,
  outputs: [...C0.OUTPUTS],
  signer: C0.SIGNER,
  signature: C0.LOW_S
}

const valid = (): Record<string, unknown> => ({
  v: 1,
  assetId: C0.ASSET,
  rawTx: '0100',
  atomicBEEF: HEADER + '00',
  role: 'handover',
  state: 'credited',
  labels: ['color'],
  inputs: [`${C0.TXID}.1`],
  outputs: [0, 4294967295],
  offChainValues: 'e0',
  attestations: [ATTESTATION]
})

async function readBack(record: unknown): Promise<TxRecord | undefined> {
  const fake = new FakeStore()
  await fake.set(`color.v1.tx.${TXID}`, JSON.stringify(record))
  return await new ColorStore(fake).getTx(TXID)
}

describe('ColorStore tx records', () => {
  it('reads back a well-formed record with its parsed attestations', async () => {
    expect(await readBack(valid())).toEqual(valid())
    const { state: _state, labels: _labels, ...minimal } = valid()
    expect(await readBack({ ...minimal, attestations: [] })).toEqual({
      ...minimal,
      attestations: []
    })
  })

  const torn: Record<string, (record: Record<string, unknown>) => void> = {
    'an unknown member': record => {
      record.extra = 1
    },
    'another version': record => {
      record.v = 2
    },
    'a non-canonical asset id': record => {
      record.assetId = C0.ASSET.toUpperCase()
    },
    'an asset id that is not a string': record => {
      record.assetId = 7
    },
    'an empty rawTx': record => {
      record.rawTx = ''
    },
    'an odd-length rawTx': record => {
      record.rawTx = '010'
    },
    'a rawTx that is not a string': record => {
      record.rawTx = [1]
    },
    'an unknown role': record => {
      record.role = 'issuer'
    },
    'a role that is not a string': record => {
      record.role = 1
    },
    'an unknown state': record => {
      record.state = 'settled'
    },
    'a state that is not a string': record => {
      record.state = true
    },
    'labels that are not strings': record => {
      record.labels = ['color', 2]
    },
    'an input that is not an outpoint': record => {
      record.inputs = [C0.TXID]
    },
    'an output beyond uint32': record => {
      record.outputs = [4294967296]
    },
    'a negative output': record => {
      record.outputs = [-1]
    },
    'uppercase offChainValues': record => {
      record.offChainValues = 'E0'
    },
    'attestations that are not an array': record => {
      record.attestations = ATTESTATION
    },
    'an attestation that does not parse': record => {
      record.attestations = [ATTESTATION, { ...ATTESTATION, outputs: [2, 0] }]
    },
    'an AtomicBEEF naming another subject': record => {
      record.atomicBEEF = '01010101' + '11'.repeat(32)
    }
  }

  for (const [name, edit] of Object.entries(torn)) {
    it(`reads a record with ${name} as absent (fail safe)`, async () => {
      const record = valid()
      edit(record)
      expect(await readBack(record)).toBeUndefined()
    })
  }

  it('lists a torn record’s txid, but its settle markers count only when readable', async () => {
    const fake = new FakeStore()
    const store = new ColorStore(fake)
    await fake.set(`color.v1.tx.${TXID}`, '{')
    await fake.set(`color.v1.settled.${TXID}`, JSON.stringify({ outputs: [0] }))
    await fake.set(`color.v1.refused.${TXID}`, JSON.stringify({ code: 'X', description: 1 }))
    expect(await store.txids()).toEqual([TXID])
    expect(await store.getTx(TXID)).toBeUndefined()
    expect(await store.settledSet()).toEqual(new Set())
    expect(await store.refusedSet()).toEqual(new Set())
  })
})
