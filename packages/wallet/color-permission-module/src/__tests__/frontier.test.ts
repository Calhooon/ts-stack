import { LockingScript, MerklePath, PrivateKey, type Transaction } from '@bsv/sdk'
import { toArray, toHex } from '@bsv/sdk/primitives/utils'
import { OneColor } from '@bsv/templates'
import { validateFrontier, type FrontierInput } from '../frontier.js'
import type { ColorAttestation } from '../profiles.js'
import { readTokenOutput } from '../tokenOutputs.js'
import { graph, type GraphBuilder } from './profileFixtures.js'

const K = new PrivateKey(5555)
const KEY = K.toPublicKey().toString()
const R = new PrivateKey(6666)
const qualifies = (signer: string): boolean => signer === KEY

const id = (tx: Transaction): string => tx.id('hex')
const at = (tx: Transaction, vout: number): string => `${id(tx)}.${vout}`

/** A FrontierInput over every body the graph built, minus `omit`. */
function frontier(
  g: GraphBuilder,
  tip: Transaction,
  attestations: ColorAttestation[],
  options: {
    outputs?: number[]
    omit?: Transaction[]
    declarationTx?: Transaction
    qualifies?: (signer: string) => boolean
    maxTransactions?: number
  } = {}
): FrontierInput {
  const bodies = new Map(g.bodies)
  for (const tx of options.omit ?? []) bodies.delete(id(tx))
  return {
    assetId: g.assetId,
    declarationTx: options.declarationTx ?? g.bodies.get(g.assetId.slice(0, 64))!,
    tip,
    start: { outputs: options.outputs ?? [0] },
    bodies,
    attestations,
    qualifies: options.qualifies ?? qualifies,
    maxTransactions: options.maxTransactions
  }
}

const rejects = (input: FrontierInput, reason: string | RegExp): void => {
  let caught: unknown
  try {
    validateFrontier(input)
  } catch (error) {
    caught = error
  }
  expect(caught).toMatchObject({ name: 'AttestationEvidenceError' })
  expect((caught as { reason: string }).reason).toMatch(reason)
}

/** A BRC-161 JSON transfer inscription of `amt` of `assetId`. */
function jsonTransfer(assetId: string, amt: string): LockingScript {
  const push = (bytes: number[]): string =>
    (bytes.length > 75 ? '4c' : '') + bytes.length.toString(16).padStart(2, '0') + toHex(bytes)
  const json = toArray(`{"p":"bsv-20","op":"transfer","id":"${assetId}","amt":"${amt}"}`, 'utf8')
  return LockingScript.fromHex(
    '0063' +
      push(toArray('ord', 'utf8')) +
      '51' +
      push(toArray('application/bsv-20', 'utf8')) +
      '00' +
      push(json) +
      '68' +
      '76a914' +
      '11'.repeat(20) +
      '88ac'
  )
}

describe('complete token frontier', () => {
  it('anchors an attested parent and validates the unattested tip', async () => {
    const g = graph()
    const deploy = g.deploy(1000n)
    // The attested deploy declares req, which the 0.1.0 reader refuses: the frontier reads profiles.
    expect(() =>
      readTokenOutput(deploy.tx.outputs[0].lockingScript, { txid: id(deploy.tx), vout: 0 })
    ).toThrow()
    const A = await g.spend([{ tx: deploy.tx, vout: 0 }], [1000n])
    const tip = await g.spend([{ tx: A, vout: 0 }], [600n, 400n])
    const result = validateFrontier(
      frontier(g, tip, [await g.attest(K, A, [0])], { outputs: [0, 1] })
    )
    expect(result.anchors).toEqual([{ outpoint: at(A, 0), signers: [KEY] }])
    expect(result.pending).toEqual([id(tip)])
  })

  it('an attested tip output is itself the anchor and nothing is pending', async () => {
    const g = graph()
    const deploy = g.deploy(1000n)
    const tip = await g.spend([{ tx: deploy.tx, vout: 0 }], [1000n])
    const result = validateFrontier(frontier(g, tip, [await g.attest(K, tip, [0])]))
    expect(result).toEqual({ anchors: [{ outpoint: at(tip, 0), signers: [KEY] }], pending: [] })
  })

  it('an attested deploy anchors even when only declarationTx carries it', async () => {
    const g = graph()
    const deploy = g.deploy(1000n)
    const tip = await g.spend([{ tx: deploy.tx, vout: 0 }], [1000n])
    const input = frontier(g, tip, [await g.attest(K, deploy.tx, [0])], { omit: [deploy.tx] })
    input.declarationTx = deploy.tx
    expect(validateFrontier(input)).toEqual({
      anchors: [{ outpoint: at(deploy.tx, 0), signers: [KEY] }],
      pending: [id(tip)]
    })
  })

  it('C19 diamond: a shared ancestor is validated once', async () => {
    const g = graph()
    const deploy = g.deploy(1000n)
    const A = await g.spend([{ tx: deploy.tx, vout: 0 }], [1000n])
    const D = await g.spend([{ tx: A, vout: 0 }], [500n, 500n])
    const B = await g.spend([{ tx: D, vout: 0 }], [500n])
    const C = await g.spend([{ tx: D, vout: 1 }], [500n])
    const tip = await g.spend(
      [
        { tx: B, vout: 0 },
        { tx: C, vout: 0 }
      ],
      [1000n]
    )
    const result = validateFrontier(frontier(g, tip, [await g.attest(K, A, [0])]))
    expect(result.pending).toEqual([id(D), id(B), id(C), id(tip)])
    expect(result.anchors).toEqual([{ outpoint: at(A, 0), signers: [KEY] }])
  })

  it('C20 competing branches consuming one outpoint are rejected', async () => {
    const g = graph()
    const deploy = g.deploy(1000n)
    const A = await g.spend([{ tx: deploy.tx, vout: 0 }], [1000n])
    const D = await g.spend([{ tx: A, vout: 0 }], [500n, 500n])
    const B = await g.spend([{ tx: D, vout: 0 }], [500n])
    const C = await g.spend([{ tx: D, vout: 0 }], [400n])
    const tip = await g.spend(
      [
        { tx: B, vout: 0 },
        { tx: C, vout: 0 }
      ],
      [900n]
    )
    rejects(frontier(g, tip, [await g.attest(K, A, [0])]), 'duplicate spend')
  })

  it('two attested transactions consuming one outpoint are a duplicate spend too', async () => {
    const g = graph()
    const deploy = g.deploy(1000n)
    const A = await g.spend([{ tx: deploy.tx, vout: 0 }], [1000n])
    const B = await g.spend([{ tx: A, vout: 0 }], [1000n])
    const C = await g.spend([{ tx: A, vout: 0 }], [1000n])
    const tip = await g.spend(
      [
        { tx: B, vout: 0 },
        { tx: C, vout: 0 }
      ],
      [2000n]
    )
    rejects(
      frontier(g, tip, [await g.attest(K, B, [0]), await g.attest(K, C, [0])]),
      'duplicate spend'
    )
  })

  it('C21 an omitted branch is rejected even if the other input suffices', async () => {
    const g = graph()
    const deploy = g.deploy(1000n)
    const A = await g.spend([{ tx: deploy.tx, vout: 0 }], [1000n])
    const E = await g.spend([{ tx: A, vout: 0 }], [1000n])
    const tip = await g.spend(
      [
        { tx: A, vout: 0 },
        { tx: E, vout: 0 }
      ],
      [1000n]
    )
    rejects(frontier(g, tip, [await g.attest(K, A, [0])], { omit: [E] }), /missing/)
  })

  it('C22 a mined but unattested parent is not an anchor', async () => {
    const g = graph()
    const deploy = g.deploy(1000n)
    const A = await g.spend([{ tx: deploy.tx, vout: 0 }], [1000n])
    const P = await g.spend([{ tx: A, vout: 0 }], [1000n])
    const Q = await g.spend([{ tx: P, vout: 0 }], [1000n])
    Q.merklePath = new MerklePath(800000, [[{ offset: 0, hash: id(Q), txid: true }]])
    const tip = await g.spend([{ tx: Q, vout: 0 }], [1000n])
    rejects(frontier(g, tip, [await g.attest(K, A, [0])], { omit: [P] }), /missing/)
  })

  it('C24 an attestation for output 0 does not cover output 2', async () => {
    const g = graph()
    const deploy = g.deploy(1000n)
    const A = await g.spend([{ tx: deploy.tx, vout: 0 }], [1000n])
    const T = await g.spend([{ tx: A, vout: 0 }], [500n, 'plain', 500n])
    const tip = await g.spend([{ tx: T, vout: 2 }], [500n])
    const attestation = await g.attest(K, T, [0])
    rejects(frontier(g, tip, [attestation], { omit: [A] }), /missing/)
    // The same graph with T.2 attested anchors there.
    expect(
      validateFrontier(frontier(g, tip, [await g.attest(K, T, [0, 2])], { omit: [A] })).anchors
    ).toEqual([{ outpoint: at(T, 2), signers: [KEY] }])
  })

  it('C25 no quantity bypass', async () => {
    const g = graph()
    const deploy = g.deploy(20n)
    const A = await g.spend([{ tx: deploy.tx, vout: 0 }], [20n])
    const tip = await g.spend([{ tx: A, vout: 0 }], [21n])
    rejects(frontier(g, tip, [await g.attest(K, A, [0])]), 'value outputs exceed inputs')
  })

  it('C26 an authority branch is validated as well', async () => {
    const g = graph()
    const deploy = g.deploy(0n)
    const X = await g.spend([{ tx: deploy.tx, vout: 0 }], [0n])
    const attestation = await g.attest(K, X, [0])
    const good = await g.spend([{ tx: X, vout: 0 }], [0n])
    const mint = await g.spend([{ tx: good, vout: 0 }], [0n, 1000n])
    expect(validateFrontier(frontier(g, mint, [attestation], { outputs: [0, 1] }))).toEqual({
      anchors: [{ outpoint: at(X, 0), signers: [KEY] }],
      pending: [id(good), id(mint)]
    })
    // F's unlocking script is signed by the wrong key: script validation fails on F.
    const F = await g.spend([{ tx: X, vout: 0, key: R }], [0n])
    const tip = await g.spend([{ tx: F, vout: 0 }], [0n, 1000n])
    rejects(frontier(g, tip, [attestation], { outputs: [1] }), /does not unlock/)
  })

  it('C27 consuming an anchor in this graph is normal ancestry', async () => {
    const g = graph()
    const deploy = g.deploy(1000n)
    const A = await g.spend([{ tx: deploy.tx, vout: 0 }], [600n, 400n])
    const B = await g.spend([{ tx: A, vout: 0 }], [600n])
    const tip = await g.spend(
      [
        { tx: B, vout: 0 },
        { tx: A, vout: 1 }
      ],
      [1000n]
    )
    const result = validateFrontier(frontier(g, tip, [await g.attest(K, A, [0, 1])]))
    expect(result.anchors).toEqual([
      { outpoint: at(A, 0), signers: [KEY] },
      { outpoint: at(A, 1), signers: [KEY] }
    ])
    expect(result.pending).toEqual([id(B), id(tip)])
  })

  it('anchors carry every qualifying signer once, and skip non-qualifying ones', async () => {
    const g = graph()
    const deploy = g.deploy(1000n)
    const A = await g.spend([{ tx: deploy.tx, vout: 0 }], [1000n])
    const tip = await g.spend([{ tx: A, vout: 0 }], [1000n])
    const Q = new PrivateKey(7777)
    const QKEY = Q.toPublicKey().toString()
    const attestations = [
      await g.attest(K, A, [0]),
      await g.attest(K, A, [0]),
      await g.attest(Q, A, [0]),
      await g.attest(R, A, [0])
    ]
    const result = validateFrontier(
      frontier(g, tip, attestations, { qualifies: s => s === KEY || s === QKEY })
    )
    expect(result.anchors).toEqual([{ outpoint: at(A, 0), signers: [KEY, QKEY] }])
  })

  it('an unanchored deploy fails', async () => {
    const g = graph()
    const deploy = g.deploy(1000n)
    const tip = await g.spend([{ tx: deploy.tx, vout: 0 }], [1000n])
    rejects(frontier(g, tip, []), 'unanchored deploy')
  })

  it('a deploy body that differs from declarationTx fails', async () => {
    const g = graph()
    const deploy = g.deploy(1000n)
    const A = await g.spend([{ tx: deploy.tx, vout: 0 }], [1000n])
    const tip = await g.spend([{ tx: A, vout: 0 }], [1000n])
    const attestation = await g.attest(K, A, [0])
    rejects(frontier(g, tip, [attestation], { declarationTx: g.fund() }), /declarationTx/)
    // A body supplied under the deploy's txid must be the declaration's exact bytes.
    const input = frontier(g, tip, [attestation])
    input.bodies = new Map(input.bodies).set(deploy.assetId.slice(0, 64), g.fund())
    rejects(input, /deploy body/)
  })

  it('declarationTx must carry the asset deploy at output 0', async () => {
    const g = graph()
    g.deploy(1000n)
    const plain = g.fund()
    const tip = await g.spend([{ tx: plain, vout: 0 }], ['plain'])
    const input = frontier(g, tip, [], { declarationTx: plain })
    input.assetId = `${id(plain)}_0`
    rejects(input, /declarationTx/)
  })

  it('an attestation naming a missing or foreign-asset output fails', async () => {
    const g = graph()
    const deploy = g.deploy(1000n)
    const A = await g.spend([{ tx: deploy.tx, vout: 0 }], [1000n, 'plain'])
    const tip = await g.spend([{ tx: A, vout: 0 }], [1000n])
    const ok = await g.attest(K, A, [0])
    rejects(frontier(g, tip, [ok, await g.attest(K, A, [1])]), /names an output/)
    rejects(frontier(g, tip, [ok, await g.attest(K, A, [7])]), /names an output/)
    const elsewhere = await g.spend([{ tx: g.fund(), vout: 0 }], ['plain'])
    const absent = await g.attest(K, elsewhere, [0])
    rejects(frontier(g, tip, [ok, absent], { omit: [elsewhere] }), /names an output that cannot/)
  })

  it('an invalid signature fails instead of being ignored', async () => {
    const g = graph()
    const deploy = g.deploy(1000n)
    const A = await g.spend([{ tx: deploy.tx, vout: 0 }], [1000n])
    const tip = await g.spend([{ tx: A, vout: 0 }], [1000n])
    const ok = await g.attest(K, A, [0])
    const other = await g.attest(K, tip, [0])
    rejects(frontier(g, tip, [ok, { ...ok, signature: other.signature }]), 'invalid attestation')
    // Even a non-qualifying signer's bad signature is refused.
    const stranger = await g.attest(R, A, [0])
    rejects(
      frontier(g, tip, [ok, { ...stranger, signature: other.signature }]),
      'invalid attestation'
    )
  })

  it('a non-qualifying valid signer is ignored for coverage', async () => {
    const g = graph()
    const deploy = g.deploy(1000n)
    const A = await g.spend([{ tx: deploy.tx, vout: 0 }], [1000n])
    const B = await g.spend([{ tx: A, vout: 0 }], [1000n])
    const tip = await g.spend([{ tx: B, vout: 0 }], [1000n])
    rejects(frontier(g, tip, [await g.attest(R, B, [0])], { omit: [A] }), /missing/)
  })

  it('bounds work by maxTransactions', async () => {
    const g = graph()
    const deploy = g.deploy(1000n)
    const A = await g.spend([{ tx: deploy.tx, vout: 0 }], [1000n])
    const B = await g.spend([{ tx: A, vout: 0 }], [1000n])
    const C = await g.spend([{ tx: B, vout: 0 }], [1000n])
    const tip = await g.spend([{ tx: C, vout: 0 }], [1000n])
    const attestation = await g.attest(K, A, [0])
    rejects(frontier(g, tip, [attestation], { maxTransactions: 2 }), 'graph exceeds work limit')
    expect(
      validateFrontier(frontier(g, tip, [attestation], { maxTransactions: 3 })).pending
    ).toEqual([id(B), id(C), id(tip)])
  })

  it('a long unattested chain is bounded by the work limit, not the call stack', async () => {
    const g = graph()
    const deploy = g.deploy(1000n)
    const A = await g.spend([{ tx: deploy.tx, vout: 0 }], [1000n])
    let tip = A
    for (let hop = 0; hop < 300; hop++) tip = await g.spend([{ tx: tip, vout: 0 }], [1000n])
    const attestation = await g.attest(K, A, [0])
    expect(validateFrontier(frontier(g, tip, [attestation])).pending).toHaveLength(300)
    rejects(frontier(g, tip, [attestation], { maxTransactions: 299 }), 'graph exceeds work limit')
  })

  it('S1: COVER cannot accept value minted from nothing', async () => {
    const g = graph()
    const deploy = g.deploy(500n)
    const A = await g.spend([{ tx: deploy.tx, vout: 0 }], [300n, 200n])
    const tip = await g.spend(
      [
        { tx: A, vout: 0 },
        { tx: A, vout: 1 }
      ],
      [600n]
    )
    rejects(frontier(g, tip, [await g.attest(K, A, [0, 1])]), 'value outputs exceed inputs')
  })

  it('S1 intermediate fabricated mint', async () => {
    const g = graph()
    g.deploy(1000n)
    const P = await g.spend([{ tx: g.fund(), vout: 0 }], [500n])
    const tip = await g.spend([{ tx: P, vout: 0 }], [500n])
    expect(() => validateFrontier(frontier(g, tip, []))).toThrow(
      expect.objectContaining({
        name: 'AttestationEvidenceError',
        reason: 'value outputs exceed inputs'
      })
    )
  })

  it('F7 fabricated authority parent', async () => {
    const g = graph()
    g.deploy(0n)
    const F = await g.spend([{ tx: g.fund(), vout: 0 }], [0n])
    const tip = await g.spend([{ tx: F, vout: 0 }], [0n, 1000n])
    expect(() => validateFrontier(frontier(g, tip, [], { outputs: [1] }))).toThrow(
      expect.objectContaining({
        name: 'AttestationEvidenceError',
        reason: 'authority outputs need an authority input'
      })
    )
  })

  it('a funding input without its source body is missing', async () => {
    const g = graph()
    const deploy = g.deploy(1000n)
    const A = await g.spend([{ tx: deploy.tx, vout: 0 }], [1000n])
    const fund = g.fund()
    const tip = await g.spend(
      [
        { tx: A, vout: 0 },
        { tx: fund, vout: 0 }
      ],
      [1000n, 'plain']
    )
    rejects(frontier(g, tip, [await g.attest(K, A, [0])], { omit: [fund] }), /missing source/)
  })

  it('a body filed under another txid is not that transaction', async () => {
    const g = graph()
    const deploy = g.deploy(1000n)
    const A = await g.spend([{ tx: deploy.tx, vout: 0 }], [1000n])
    const B = await g.spend([{ tx: A, vout: 0 }], [1000n])
    const tip = await g.spend([{ tx: B, vout: 0 }], [1000n])
    const input = frontier(g, tip, [await g.attest(K, A, [0])])
    input.bodies = new Map(input.bodies).set(id(B), g.fund())
    rejects(input, /missing/)
  })

  it('a start output that is not this asset fails', async () => {
    const g = graph()
    const deploy = g.deploy(1000n)
    const A = await g.spend([{ tx: deploy.tx, vout: 0 }], [1000n])
    const tip = await g.spend([{ tx: A, vout: 0 }], [1000n, 'plain'])
    rejects(frontier(g, tip, [await g.attest(K, A, [0])], { outputs: [1] }), /not this asset/)
  })

  it('a successor repeating a different req fails', async () => {
    const g = graph()
    const deploy = g.deploy(1000n)
    const A = await g.spend([{ tx: deploy.tx, vout: 0 }], [1000n])
    // {req: {}} differs from the deploy's req.
    const payload = toArray('a163726571a0', 'hex')
    const tip = await g.spend(
      [{ tx: A, vout: 0 }],
      [{ assetId: g.assetId, amount: 1000n, payload }]
    )
    rejects(frontier(g, tip, [await g.attest(K, A, [0])]), /requirements differ/)
  })

  it('a malformed profile map in the graph is attested evidence, not a plain error', async () => {
    const g = graph()
    const deploy = g.deploy(1000n)
    const A = await g.spend([{ tx: deploy.tx, vout: 0 }], [1000n])
    // {req: 1}: a payload map whose req is not a map.
    const payload = toArray('a16372657101', 'hex')
    const tip = await g.spend(
      [{ tx: A, vout: 0 }],
      [1000n, { assetId: g.assetId, amount: 0n, payload }]
    )
    rejects(frontier(g, tip, [await g.attest(K, A, [0])]), /malformed/)
  })

  it('BRC-161 JSON transfer outputs need value inputs, even with an authority', async () => {
    const g = graph()
    const deploy = g.deploy(0n)
    const X = await g.spend([{ tx: deploy.tx, vout: 0 }], [0n, 10n])
    const attestation = await g.attest(K, X, [0, 1])
    const ok = await g.spend(
      [
        { tx: X, vout: 0 },
        { tx: X, vout: 1 }
      ],
      [0n, { lockingScript: jsonTransfer(g.assetId, '10') }]
    )
    expect(validateFrontier(frontier(g, ok, [attestation], { outputs: [1] })).pending).toEqual([
      id(ok)
    ])
    const tip = await g.spend(
      [
        { tx: X, vout: 0 },
        { tx: X, vout: 1 }
      ],
      [0n, { lockingScript: jsonTransfer(g.assetId, '11') }]
    )
    rejects(frontier(g, tip, [attestation], { outputs: [1] }), 'value outputs exceed inputs')
  })

  it('a missing tip-side transaction body is reported by txid', async () => {
    const g = graph()
    const deploy = g.deploy(1000n)
    const A = await g.spend([{ tx: deploy.tx, vout: 0 }], [1000n])
    const B = await g.spend([{ tx: A, vout: 0 }], [1000n])
    const tip = await g.spend([{ tx: B, vout: 0 }], [1000n])
    rejects(frontier(g, tip, [await g.attest(K, A, [0])], { omit: [B] }), id(B))
  })

  it('keeps OneColor outputs readable (fixture sanity)', () => {
    const g = graph()
    const { tx, assetId } = g.deploy(5n)
    expect(OneColor.decode(tx.outputs[0].lockingScript).amount).toBe(5n)
    expect(assetId).toBe(`${id(tx)}_0`)
  })
})
