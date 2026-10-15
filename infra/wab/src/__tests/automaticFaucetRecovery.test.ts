import { MerklePath, Script, Transaction } from '@bsv/sdk'
import { Setup, type Wallet } from '@bsv/wallet-toolbox'
import { db } from '../db/knex'
import { FaucetPaymentPendingError, UserService } from '../services/UserService'
import { faucetActionLabel } from '../services/AutomaticFaucetRecovery'
import { faucetPaymentScript } from '../services/FaucetRecoveryService'

const k = '02'.repeat(32)
function fixture(legacy = false) {
  const parent = new Transaction()
  parent.addOutput({ satoshis: 10000, lockingScript: Script.fromHex('51') })
  const proof = new MerklePath(100, [
    [
      { offset: 0, hash: 'ab'.repeat(32) },
      { offset: 1, hash: parent.id('hex'), txid: true }
    ]
  ])
  let label = faucetActionLabel(k)
  function payment(script: string) {
    const tx = new Transaction()
    tx.addInput({
      sourceTransaction: parent,
      sourceOutputIndex: 0,
      unlockingScript: Script.fromHex(''),
      sequence: 0xffffffff
    })
    tx.addOutput({ satoshis: 6000, lockingScript: Script.fromHex(script) })
    return tx
  }
  let subject = payment(faucetPaymentScript(k))
  const tracker = {
    currentHeight: async () => 101,
    isValidRootForHeight: jest.fn(
      async (root: string, height: number) =>
        height === 100 && root === proof.computeRoot(parent.id('hex'))
    )
  }
  const action = () => ({
    txid: subject.id('hex'),
    status: 'unprocessed',
    labels: [label],
    outputs: [
      { outputIndex: 0, satoshis: 6000, lockingScript: subject.outputs[0].lockingScript.toHex() }
    ]
  })
  const listActions = jest.fn(async (args: { labels: string[] }) =>
    legacy && args.labels.length > 0
      ? { totalActions: 0, actions: [] }
      : { totalActions: 1, actions: [action()] }
  )
  const getRawTx = jest.fn(async () => ({ txid: parent.id('hex'), rawTx: parent.toBinary() }))
  const getMerklePath = jest.fn(async () => ({ merklePath: proof }))
  const createAction = jest.fn(
    async (args: {
      outputs?: { lockingScript: string }[]
      labels?: string[]
      options?: { sendWith?: string[] }
    }) => {
      if (args.outputs != null) {
        subject = payment(args.outputs[0].lockingScript)
        label = args.labels![0]
        throw new Error('WERR_INTERNAL: merged Beef failed validation after Storage commit')
      }
      return { sendWithResults: [{ txid: subject.id('hex'), status: 'unproven' }] }
    }
  )
  const wallet = {
    listActions,
    createAction,
    storage: {
      findProvenTxReqs: jest.fn(async () => [
        { txid: subject.id('hex'), status: 'unprocessed', rawTx: subject.toBinary() }
      ])
    },
    getServices: () => ({ getRawTx, getMerklePath, getChainTracker: async () => tracker })
  }
  return {
    wallet: wallet as unknown as Wallet,
    api: wallet,
    tracker,
    action,
    subject: () => subject,
    setSubject: (tx: Transaction) => {
      subject = tx
    },
    parent,
    proof,
    getRawTx,
    getMerklePath
  }
}

describe('automatic recovery of an ambiguous faucet grant', () => {
  let userId: number
  let paymentId: number
  beforeEach(async () => {
    const user = await UserService.createUser('automatic-' + Math.random())
    userId = user.id
    await UserService.linkAuthMethod(
      userId,
      'TwilioPhone',
      '+1415' + String(userId).padStart(7, '0')
    )
    await UserService.markFaucetReceived(userId)
    paymentId = (
      await db('payments').insert({ userId, k, amount: 6000, outputIndex: 0, status: 'creating' })
    )[0]
  })
  afterEach(() => jest.restoreAllMocks())
  function install(f: ReturnType<typeof fixture>) {
    jest.spyOn(Setup, 'createWalletClientNoEnv').mockResolvedValue(f.wallet)
  }
  it('reprocesses the existing signed transaction on retry, with no new outputs or grant', async () => {
    const f = fixture()
    install(f)
    const recovered = await UserService.getOrCreateFaucetPayment(userId, 6000, false)
    expect(recovered).toMatchObject({
      id: paymentId,
      status: 'ready',
      txid: f.subject().id('hex'),
      k
    })
    expect(f.api.createAction).toHaveBeenCalledWith({
      description: 'Resume existing faucet payment',
      options: { sendWith: [f.subject().id('hex')], acceptDelayedBroadcast: false }
    })
    expect(await Transaction.fromAtomicBEEF([...recovered.beef]).verify(f.tracker)).toBe(true)
    await expect(UserService.getOrCreateFaucetPayment(userId, 6000, false)).resolves.toMatchObject({
      id: paymentId
    })
    expect(f.api.createAction).toHaveBeenCalledTimes(1)
    expect(await db('payments').where({ userId })).toHaveLength(1)
    expect(Boolean((await db('auth_methods').where({ userId }).first()).receivedFaucet)).toBe(true)
  })
  it('recovers in the original request after processAction fails following commit', async () => {
    await db('payments').where({ id: paymentId }).del()
    await db('auth_methods').where({ userId }).update({ receivedFaucet: false })
    const f = fixture()
    install(f)
    const result = await UserService.getOrCreateFaucetPayment(userId, 6000)
    expect(result.status).toBe('ready')
    const calls = f.api.createAction.mock.calls.map(([args]) => args)
    expect(calls.filter(args => args.outputs != null)).toHaveLength(1)
    expect(calls[0].labels).toEqual([faucetActionLabel(result.k)])
    expect(calls[1].outputs).toBeUndefined()
    expect(calls[1].options?.sendWith).toEqual([result.txid])
  })
  it('survives a process replacement and transient proof failure without duplicating funding', async () => {
    const first = fixture()
    install(first)
    first.tracker.isValidRootForHeight.mockResolvedValue(false)
    await expect(UserService.getOrCreateFaucetPayment(userId, 6000, false)).rejects.toBeInstanceOf(
      FaucetPaymentPendingError
    )
    expect(first.api.createAction).not.toHaveBeenCalled()
    jest.restoreAllMocks()
    const restarted = fixture()
    install(restarted)
    await expect(UserService.getOrCreateFaucetPayment(userId, 6000, false)).resolves.toMatchObject({
      id: paymentId,
      status: 'ready'
    })
    expect(restarted.api.createAction.mock.calls[0][0].outputs).toBeUndefined()
  })
  it('recovers a legacy reservation using its exact output when the old action has no label', async () => {
    const f = fixture(true)
    install(f)
    await expect(UserService.getOrCreateFaucetPayment(userId, 6000, false)).resolves.toMatchObject({
      id: paymentId,
      status: 'ready'
    })
    expect(f.api.listActions).toHaveBeenCalledTimes(2)
  })
  it('rejects invalid unlocking scripts even when ancestry roots are valid', async () => {
    const f = fixture()
    install(f)
    const invalid = f.subject()
    invalid.inputs[0].unlockingScript = Script.fromHex('6a')
    f.setSubject(invalid)
    await expect(UserService.getOrCreateFaucetPayment(userId, 6000, false)).rejects.toBeInstanceOf(
      FaucetPaymentPendingError
    )
    expect(f.api.createAction).not.toHaveBeenCalled()
  })
  it('leaves an ambiguous action set pending', async () => {
    const f = fixture()
    install(f)
    f.api.listActions.mockResolvedValue({ totalActions: 2, actions: [f.action(), f.action()] })
    await expect(UserService.getOrCreateFaucetPayment(userId, 6000, false)).rejects.toBeInstanceOf(
      FaucetPaymentPendingError
    )
    expect(f.api.createAction).not.toHaveBeenCalled()
  })
  it('refuses truncated legacy history rather than guessing', async () => {
    const f = fixture(true)
    install(f)
    f.api.listActions
      .mockResolvedValueOnce({ totalActions: 0, actions: [] })
      .mockResolvedValueOnce({ totalActions: 1001, actions: [f.action()] })
    await expect(UserService.getOrCreateFaucetPayment(userId, 6000, false)).rejects.toBeInstanceOf(
      FaucetPaymentPendingError
    )
    expect(f.api.createAction).not.toHaveBeenCalled()
  })
  it('leaves a rejected resubmission pending without creating another action', async () => {
    const f = fixture()
    install(f)
    f.api.createAction.mockResolvedValue({
      sendWithResults: [{ txid: f.subject().id('hex'), status: 'failed' }]
    })
    await expect(UserService.getOrCreateFaucetPayment(userId, 6000, false)).rejects.toBeInstanceOf(
      FaucetPaymentPendingError
    )
    expect((await db('payments').where({ id: paymentId }).first()).status).toBe('creating')
    expect(f.api.createAction.mock.calls[0][0].outputs).toBeUndefined()
  })
  it('fails closed on provider outage and can retry the same transaction later', async () => {
    const f = fixture()
    install(f)
    f.getRawTx.mockRejectedValueOnce(new Error('Provider unavailable'))
    await expect(UserService.getOrCreateFaucetPayment(userId, 6000, false)).rejects.toBeInstanceOf(
      FaucetPaymentPendingError
    )
    await expect(UserService.getOrCreateFaucetPayment(userId, 6000, false)).resolves.toMatchObject({
      status: 'ready'
    })
    expect(f.api.createAction).toHaveBeenCalledTimes(1)
  })
  it('allows concurrent retries to return the same payment without a fresh funding output', async () => {
    const f = fixture()
    install(f)
    const results = await Promise.all([
      UserService.getOrCreateFaucetPayment(userId, 6000, false),
      UserService.getOrCreateFaucetPayment(userId, 6000, false)
    ])
    expect(results.map(payment => payment.txid)).toEqual([
      f.subject().id('hex'),
      f.subject().id('hex')
    ])
    expect(f.api.createAction.mock.calls.every(([args]) => args.outputs == null)).toBe(true)
    expect(await db('payments').where({ userId })).toHaveLength(1)
  })
  it('rejects a labelled action whose evidence does not contain that label', async () => {
    const f = fixture()
    install(f)
    f.api.listActions.mockResolvedValue({
      totalActions: 1,
      actions: [{ ...f.action(), labels: ['unrelated'] }]
    })
    await expect(UserService.getOrCreateFaucetPayment(userId, 6000, false)).rejects.toBeInstanceOf(
      FaucetPaymentPendingError
    )
    expect(f.api.createAction).not.toHaveBeenCalled()
  })
  it('rejects substituted signed bytes before resubmission', async () => {
    const f = fixture()
    install(f)
    f.api.storage.findProvenTxReqs.mockResolvedValue([
      { txid: f.subject().id('hex'), status: 'unprocessed', rawTx: f.parent.toBinary() }
    ])
    await expect(UserService.getOrCreateFaucetPayment(userId, 6000, false)).rejects.toBeInstanceOf(
      FaucetPaymentPendingError
    )
    expect(f.api.createAction).not.toHaveBeenCalled()
  })
  it('stops an expired traversal before starting another lookup or submission', async () => {
    const f = fixture()
    install(f)
    const now = Date.now()
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now)
    f.api.listActions.mockImplementationOnce(async () => {
      clock.mockReturnValue(now + 30_001)
      return { totalActions: 1, actions: [f.action()] }
    })
    await expect(UserService.getOrCreateFaucetPayment(userId, 6000, false)).rejects.toBeInstanceOf(
      FaucetPaymentPendingError
    )
    expect(f.api.storage.findProvenTxReqs).not.toHaveBeenCalled()
    expect(f.api.createAction).not.toHaveBeenCalled()
  })
  it('reconstructs several confirmed funding inputs in one bounded frontier', async () => {
    const f = fixture()
    install(f)
    const second = new Transaction()
    second.version = 2
    second.addOutput({ satoshis: 10000, lockingScript: Script.fromHex('51') })
    const proof = new MerklePath(100, [
      [
        { offset: 2, hash: f.parent.id('hex'), txid: true },
        { offset: 3, hash: second.id('hex'), txid: true }
      ],
      [{ offset: 0, hash: 'ab'.repeat(32) }]
    ])
    const subject = f.subject()
    subject.addInput({
      sourceTransaction: second,
      sourceOutputIndex: 0,
      unlockingScript: Script.fromHex(''),
      sequence: 0xffffffff
    })
    f.setSubject(subject)
    f.getRawTx.mockImplementation(async (txid?: string) => {
      const tx = txid === second.id('hex') ? second : f.parent
      return { txid: tx.id('hex'), rawTx: tx.toBinary() }
    })
    f.getMerklePath.mockResolvedValue({ merklePath: proof })
    f.tracker.isValidRootForHeight.mockImplementation(
      async (root: string, height: number) =>
        height === 100 && root === proof.computeRoot(f.parent.id('hex'))
    )
    await expect(UserService.getOrCreateFaucetPayment(userId, 6000, false)).resolves.toMatchObject({
      status: 'ready',
      txid: subject.id('hex')
    })
    expect(f.getRawTx).toHaveBeenCalledTimes(2)
    expect(f.api.createAction.mock.calls[0][0].outputs).toBeUndefined()
  })
})
