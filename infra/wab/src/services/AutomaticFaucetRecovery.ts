import { Beef, Hash, MerklePath, Transaction, Utils, type WalletAction } from '@bsv/sdk'
import type { Wallet } from '@bsv/wallet-toolbox'
import type { PaymentEntity } from '../types'
import { faucetPaymentScript, saveRecoveredFaucetPayment } from './FaucetRecoveryService'

const MAX_LEGACY_ACTIONS = 1000
const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024
const MAX_INPUTS = 32
const MAX_ANCESTORS = 64

/** Durable correlation uses the secret already committed before wallet work, without disclosing it. */
export function faucetActionLabel(k: string): string {
  return `wab-faucet-${Utils.toHex(Hash.sha256(Utils.toArray(k, 'hex')))}`
}

function candidate(action: WalletAction, payment: PaymentEntity, script: string): boolean {
  return (
    /^[0-9a-f]{64}$/i.test(action.txid) &&
    ['unprocessed', 'unproven', 'completed', 'sending'].includes(action.status) &&
    action.outputs?.some(
      output =>
        output.outputIndex === payment.outputIndex &&
        output.satoshis === payment.amount &&
        output.lockingScript === script
    ) === true
  )
}

async function findRetainedAction(
  wallet: Wallet,
  payment: PaymentEntity,
  script: string
): Promise<string> {
  const label = faucetActionLabel(payment.k)
  const history = await wallet.listActions({
    labels: [label],
    labelQueryMode: 'all',
    includeLabels: true,
    includeOutputs: true,
    includeOutputLockingScripts: true,
    limit: 2
  })
  let matches = history.actions.filter(
    action => action.labels?.includes(label) && candidate(action, payment, script)
  )
  if (
    history.totalActions > 1 ||
    history.actions.length > 1 ||
    history.totalActions !== history.actions.length
  )
    throw new Error('Ambiguous faucet action history')
  if (history.totalActions === 0 && history.actions.length === 0) {
    // Compatibility for pre-label reservations, including already-stranded grants.
    // Refuse truncated/oversized history rather than guessing or creating another payment.
    const legacy = await wallet.listActions({
      labels: [],
      includeOutputs: true,
      includeOutputLockingScripts: true,
      limit: MAX_LEGACY_ACTIONS
    })
    if (legacy.totalActions > MAX_LEGACY_ACTIONS || legacy.actions.length !== legacy.totalActions) {
      throw new Error('Legacy faucet history needs operator reconciliation')
    }
    matches = legacy.actions.filter(action => candidate(action, payment, script))
  }
  if (matches.length !== 1) throw new Error('A unique retained faucet action is not available')
  const txid = matches[0].txid.toLowerCase()
  if (payment.txid != null && payment.txid !== txid)
    throw new Error('Conflicting faucet transaction checkpoint')
  return txid
}

async function retainedTransaction(
  wallet: Wallet,
  payment: PaymentEntity,
  txid: string,
  script: string
): Promise<Transaction> {
  const reqs = await wallet.storage.findProvenTxReqs({
    partial: {},
    txids: [txid],
    paged: { limit: 2, offset: 0 }
  })
  if (
    reqs.length !== 1 ||
    reqs[0].txid !== txid ||
    !['unprocessed', 'unsent', 'sending', 'unmined', 'completed', 'notifying'].includes(
      reqs[0].status
    )
  ) {
    throw new Error('Retained faucet proof request is unavailable')
  }
  const raw = reqs[0].rawTx
  if (raw == null || raw.length > MAX_EVIDENCE_BYTES)
    throw new Error('Retained faucet transaction is unavailable')
  const transaction = Transaction.fromBinary([...raw])
  const output = transaction.outputs[payment.outputIndex]
  if (
    transaction.id('hex') !== txid ||
    transaction.toBinary().length !== raw.length ||
    transaction.toBinary().some((byte, index) => byte !== raw[index]) ||
    payment.outputIndex !== 0 ||
    output?.satoshis !== payment.amount ||
    output.lockingScript.toHex() !== script ||
    transaction.inputs.length > MAX_INPUTS
  )
    throw new Error('Retained faucet payment does not match reservation')

  return transaction
}

async function appendAncestor(
  beef: Beef,
  services: ReturnType<Wallet['getServices']>,
  sourceTxid: string
): Promise<Array<string | undefined>> {
  const raw = await services.getRawTx(sourceTxid)
  if (raw.rawTx == null || raw.rawTx.length > MAX_EVIDENCE_BYTES)
    throw new Error('Faucet input unavailable')
  const parent = Transaction.fromBinary(raw.rawTx)
  if (parent.id('hex') !== sourceTxid || parent.inputs.length > MAX_INPUTS)
    throw new Error('Faucet input mismatch')
  beef.mergeRawTx(parent.toBinary())
  const proof = await services.getMerklePath(sourceTxid)
  const dependencies: Array<string | undefined> = []
  if (proof.merklePath != null) {
    beef.mergeBump(MerklePath.fromBinary(proof.merklePath.toBinary()))
  } else {
    dependencies.push(...parent.inputs.map(input => input.sourceTXID))
  }
  if (beef.toBinary().length > MAX_EVIDENCE_BYTES)
    throw new Error('Faucet ancestry exceeds evidence bound')
  return dependencies
}

async function verifiedRecoveryBeef(wallet: Wallet, transaction: Transaction): Promise<number[]> {
  const beef = new Beef()
  const services = wallet.getServices()
  const queued = transaction.inputs.map(input => input.sourceTXID)
  const seen = new Set<string>()
  while (queued.length > 0) {
    const sourceTxid = queued.shift()
    if (sourceTxid == null) throw new Error('Missing faucet input transaction')
    if (seen.has(sourceTxid)) continue
    seen.add(sourceTxid)
    if (seen.size > MAX_ANCESTORS) throw new Error('Faucet ancestry exceeds transaction bound')
    queued.push(...(await appendAncestor(beef, services, sourceTxid)))
  }
  beef.mergeRawTx(transaction.toBinary())
  const bytes = beef.toBinaryAtomic(transaction.id('hex'))
  const tracker = await services.getChainTracker()
  if (
    bytes.length > MAX_EVIDENCE_BYTES ||
    (await beef.verify(tracker)) !== true ||
    (await Transaction.fromAtomicBEEF(bytes).verify(tracker)) !== true
  ) {
    throw new Error('Faucet transaction verification failed')
  }
  return bytes
}

/** Read authenticated history, reprocess only its existing txid, and replay the same grant. */
export async function recoverFaucetPayment(payment: PaymentEntity, wallet: Wallet): Promise<void> {
  const script = faucetPaymentScript(payment.k)
  const txid = await findRetainedAction(wallet, payment, script)
  const transaction = await retainedTransaction(wallet, payment, txid, script)
  const bytes = await verifiedRecoveryBeef(wallet, transaction)
  // No outputs: sendWith reuses the signed transaction, never allocates a fresh grant.
  const result = await wallet.createAction({
    description: 'Resume existing faucet payment',
    options: { sendWith: [txid], acceptDelayedBroadcast: false }
  })
  if (
    result.sendWithResults?.length !== 1 ||
    result.sendWithResults[0].txid !== txid ||
    result.sendWithResults[0].status !== 'unproven'
  )
    throw new Error('Existing faucet submission is still pending')
  await saveRecoveredFaucetPayment(payment, txid, bytes)
}
