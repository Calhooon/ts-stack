// BRC-207 attested profile v1: the complete token-frontier validator (0207:328-357).
//
// From each needed output of the tip, every same-asset path must end at an output that a
// qualifying, verified attestation covers. Every transaction crossed on the way is expanded:
// all of its inputs must have supplied source bodies and unlock them, all of its same-asset
// inputs are followed in turn (value and authority alike), and the full BRC-162 transition
// rules (0162:298-306) are applied to it. A mined parent is not an anchor, nor is the deploy
// unless it is attested. Pure and synchronous; the walk is iterative, so its depth is bounded by
// `maxTransactions` and never by the call stack.

import { Transaction, type TransactionInput } from '@bsv/sdk'
import { reqMatchesDeploy } from '@bsv/templates'
import { verifyAttestation } from './attestation.js'
import type { FrontierAnchor } from './attested.js'
import { assertUnlocks, readSentToken } from './ColorPermissionModule.js'
import { AttestationEvidenceError } from './errors.js'
import { parseAssetId } from './identifiers.js'
import type { ColorAttestation } from './profiles.js'
import { readProfiledTokenOutput, type TokenOutput } from './tokenOutputs.js'

/** The default bound on the number of transactions one validation expands. */
export const FRONTIER_MAX_TRANSACTIONS = 10_000

export interface FrontierInput {
  assetId: string
  /** The asset's deploy transaction; its txid is the asset id's txid. */
  declarationTx: Transaction
  /** The fully signed transaction whose outputs are validated (from an AtomicBEEF). */
  tip: Transaction
  /** Outputs of `tip` whose validity is needed: receipt outputs, or a stored record's held outputs. */
  start: { outputs: number[] }
  /**
   * Supplied bodies by txid: the leaf's transactions and every transaction in the tip's BEEF. Only
   * these (plus the tip and `declarationTx`) are trusted as source bytes; an entry whose body does
   * not hash to its key is ignored.
   */
  bodies: ReadonlyMap<string, Transaction>
  /** Parsed attestations; every one must verify, and qualifying ones define the anchors. */
  attestations: readonly ColorAttestation[]
  /** Whether a verified signer counts toward coverage (`qualifyingSigner`). */
  qualifies: (signer: string) => boolean
  /** Bound on expanded transactions; default `FRONTIER_MAX_TRANSACTIONS`. */
  maxTransactions?: number
}

export interface FrontierResult {
  /** Terminal anchors in discovery order, deduplicated by outpoint (dot form). */
  anchors: FrontierAnchor[]
  /** The txids validated by local transition, parents first; the tip is last when unanchored. */
  pending: string[]
}

const reject = (reason: string): AttestationEvidenceError => new AttestationEvidenceError(reason)

/** Runs `check`, rethrowing any failure as an `AttestationEvidenceError`. */
function evidence<T>(check: () => T): T {
  try {
    return check()
  } catch (error) {
    if ((error as Error | undefined)?.name === 'AttestationEvidenceError') throw error
    throw reject(String((error as Error | undefined)?.message ?? error))
  }
}

/** A transaction being expanded: its inputs carry their supplied sources. */
interface Frame {
  txid: string
  tx: Transaction
  next: number
  valueIn: bigint
  authorityIn: number
}

/**
 * Validates the complete token graph of `assetId` behind `start.outputs` of the tip. Returns the
 * terminal anchors (for `assertCoverage`) and the transactions validated locally, parents first.
 * Throws `AttestationEvidenceError(reason)` on any defect: an invalid attestation, an attested
 * output that is missing or not this asset, a missing body or source, a failing script, a
 * duplicate spend, an unanchored deploy, an invalid transition or work beyond the limit.
 */
export function validateFrontier(input: FrontierInput): FrontierResult {
  const { assetId, declarationTx, tip, start, attestations, qualifies } = input
  const maxTransactions = input.maxTransactions ?? FRONTIER_MAX_TRANSACTIONS
  const asset = evidence(() => parseAssetId(assetId))
  const assetTxid = asset.txid
  const tipTxid = tip.id('hex')

  // Only bodies that hash to their key are source bytes.
  const bodies = new Map<string, Transaction>()
  for (const [txid, tx] of input.bodies) if (tx.id('hex') === txid) bodies.set(txid, tx)
  bodies.set(tipTxid, tip)

  // The deploy: declarationTx binds the asset; a supplied deploy body must be its exact bytes.
  if (declarationTx.id('hex') !== assetTxid) {
    throw reject('declarationTx does not match the asset id')
  }
  const suppliedDeploy = input.bodies.get(assetTxid)
  if (suppliedDeploy !== undefined && suppliedDeploy.toHex() !== declarationTx.toHex()) {
    throw reject('the deploy body differs from declarationTx')
  }
  bodies.set(assetTxid, declarationTx)
  const deploy = readAt(declarationTx, assetTxid, asset.vout)
  if (deploy?.deploy !== true || deploy.assetId !== assetId || deploy.encoding !== 'brc162') {
    throw reject('declarationTx does not carry the asset deploy')
  }
  const deployAttributes = deploy.attributes

  /** This asset's token at `txid.vout`, or undefined; a successor's `req` must be the deploy's. */
  function assetToken(tx: Transaction, txid: string, vout: number): TokenOutput | undefined {
    const token = readAt(tx, txid, vout)
    if (token?.assetId !== assetId) return undefined
    if (
      deployAttributes !== undefined &&
      token.attributes !== undefined &&
      !reqMatchesDeploy(deployAttributes, token.attributes)
    ) {
      throw reject('successor requirements differ from the deploy')
    }
    return token
  }

  // Attestations: every one verifies; qualifying ones cover exact outputs of this asset.
  const covered = new Map<string, Set<string>>()
  for (const att of attestations) {
    if (!verifyAttestation(att, assetId)) throw reject('invalid attestation')
    const tx = bodies.get(att.txid)
    if (tx === undefined) throw reject('attestation names an output that cannot be verified')
    if (!qualifies(att.signer)) continue
    for (const vout of att.outputs) {
      if (assetToken(tx, att.txid, vout) === undefined) {
        throw reject('attestation names an output that is not this asset')
      }
      const outpoint = `${att.txid}.${vout}`
      const signers = covered.get(outpoint) ?? new Set<string>()
      signers.add(att.signer)
      covered.set(outpoint, signers)
    }
  }

  const spentBy = new Map<string, string>()
  const spendsRecorded = new Set<string>()
  const validated = new Set<string>()
  const visiting = new Set<string>()
  const pending: string[] = []
  const anchors = new Map<string, FrontierAnchor>()
  const stack: Frame[] = []
  let expanded = 0

  /** Records every outpoint `tx` consumes; two graph transactions consuming one fail. */
  function recordSpends(txid: string, inputs: readonly TransactionInput[]): void {
    if (spendsRecorded.has(txid)) return
    spendsRecorded.add(txid)
    for (const [index, txInput] of inputs.entries()) {
      const source = sourceTxid(txInput)
      if (source === undefined) throw reject(`missing source (unknown) for ${txid}:${index}`)
      const outpoint = `${source}.${txInput.sourceOutputIndex}`
      if (spentBy.has(outpoint)) throw reject('duplicate spend')
      spentBy.set(outpoint, txid)
    }
  }

  /** Pushes `txid` for expansion, its inputs carrying their supplied source bodies. */
  function open(txid: string): void {
    if (expanded >= maxTransactions) throw reject('graph exceeds work limit')
    expanded++
    const tx = bodies.get(txid)
    if (tx === undefined) throw reject(`missing transaction ${txid}`)
    const inputs = tx.inputs.map((txInput, index) => {
      const source = sourceTxid(txInput)
      const sourceTransaction = source === undefined ? undefined : bodies.get(source)
      if (sourceTransaction === undefined) {
        throw reject(`missing source ${source ?? '(unknown)'} for ${txid}:${index}`)
      }
      return { ...txInput, sourceTXID: source, sourceTransaction }
    })
    recordSpends(txid, inputs)
    visiting.add(txid)
    stack.push({
      txid,
      tx: new Transaction(tx.version, inputs, tx.outputs, tx.lockTime),
      next: 0,
      valueIn: 0n,
      authorityIn: 0
    })
  }

  /** An anchor when covered; otherwise the producing transaction is expanded. */
  function visit(txid: string, vout: number): void {
    const outpoint = `${txid}.${vout}`
    const signers = covered.get(outpoint)
    if (signers !== undefined) {
      if (!anchors.has(outpoint)) anchors.set(outpoint, { outpoint, signers: [...signers] })
      // The anchor transaction is in the graph: its spends count for duplicate detection.
      recordSpends(txid, bodies.get(txid)!.inputs)
      return
    }
    if (txid === assetTxid) throw reject('unanchored deploy')
    if (validated.has(txid)) return
    if (visiting.has(txid)) throw reject('cycle in the token graph')
    open(txid)
  }

  /** The BRC-162 transition rules for this asset on one expanded transaction (0162:298-306). */
  function assertTransition(frame: Frame): void {
    let valueOut = 0n
    let jsonTransferOut = 0n
    let jsonMint = false
    let authorityOut = 0
    frame.tx.outputs.forEach((_, vout) => {
      const token = assetToken(frame.tx, frame.txid, vout)
      if (token === undefined || token.deploy) return
      if (token.role === 'authority') {
        authorityOut++
        return
      }
      valueOut += token.amount
      // A BRC-161 transfer is funded by value inputs only; an authority cannot fund it. A
      // BRC-161 mint needs an authority input even when value inputs would cover it (0207:853).
      if (token.encoding === 'brc161') {
        if (token.jsonOperation === 'mint') jsonMint = true
        else jsonTransferOut += token.amount
      }
    })
    if (authorityOut > 0 && frame.authorityIn === 0) {
      throw reject('authority outputs need an authority input')
    }
    if (jsonMint && frame.authorityIn === 0) {
      throw reject('legacy mint needs an authority input')
    }
    if (jsonTransferOut > frame.valueIn) throw reject('value outputs exceed inputs')
    if (valueOut > frame.valueIn && frame.authorityIn === 0) {
      throw reject('value outputs exceed inputs')
    }
  }

  /** Depth-first, post-order over the open frames: parents finish before their children. */
  function run(): void {
    while (stack.length > 0) {
      const frame = stack.at(-1)!
      if (frame.next < frame.tx.inputs.length) {
        const index = frame.next++
        const txInput = frame.tx.inputs[index]
        try {
          assertUnlocks(frame.tx, index)
        } catch (error) {
          throw reject(
            `input ${frame.txid}:${index} does not unlock its source (${(error as Error).message})`
          )
        }
        const source = txInput.sourceTXID!
        const vout = txInput.sourceOutputIndex
        const token = assetToken(txInput.sourceTransaction!, source, vout)
        if (token === undefined) continue
        if (token.role === 'authority') frame.authorityIn++
        else frame.valueIn += token.amount
        visit(source, vout)
        continue
      }
      assertTransition(frame)
      stack.pop()
      visiting.delete(frame.txid)
      validated.add(frame.txid)
      pending.push(frame.txid)
    }
  }

  for (const vout of start.outputs) {
    if (assetToken(tip, tipTxid, vout) === undefined) {
      throw reject(`start output ${tipTxid}.${vout} is not this asset`)
    }
    visit(tipTxid, vout)
    run()
  }

  return { anchors: [...anchors.values()], pending }
}

/** An input's source txid: the stated one, else the attached source's. */
function sourceTxid(txInput: TransactionInput): string | undefined {
  return txInput.sourceTXID ?? txInput.sourceTransaction?.id('hex')
}

/** The token at `txid.vout` of `tx` in either encoding, read with the profile-aware reader. */
function readAt(tx: Transaction, txid: string, vout: number): TokenOutput | undefined {
  const output = tx.outputs[vout]
  if (output === undefined) return undefined
  return evidence(() =>
    readSentToken(output.lockingScript, { txid, vout }, readProfiledTokenOutput)
  )
}
