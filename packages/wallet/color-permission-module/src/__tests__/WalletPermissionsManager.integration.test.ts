import { describe, expect, it } from '@jest/globals'
import { PrivateKey, Transaction } from '@bsv/sdk'
import { OneColor } from '@bsv/templates'
import { maybeDecryptMetadata, WalletPermissionsManager } from '@bsv/wallet-toolbox-client'
import { createAttestedProfile } from '../attested.js'
import { ColorPermissionModule } from '../ColorPermissionModule.js'
import { ColorPlan } from '../ColorPlan.js'
import { assetBasket, assetTag } from '../identifiers.js'
import {
  createModule,
  deployAsset,
  FakeProvider,
  FakeWallet,
  holdTokens,
  tokenPayment,
  validInput
} from './fixtures.js'
import { attestedAsset, attestedReceipt, C0, FakeStore, graph } from './profileFixtures.js'

const ADMIN = 'admin.example'
const APP = 'app.example'

describe('color module registered on a WalletPermissionsManager', () => {
  it('receives tokens, then sends them in one createAction signed through the signAction hook', async () => {
    const wallet = new FakeWallet()
    const provider = new FakeProvider()
    const prompts: string[] = []
    const color = createModule(wallet, provider, async (_app, message) => {
      prompts.push(JSON.parse(message).type)
      return true
    })
    const manager = new WalletPermissionsManager(wallet.asWallet(), ADMIN, {
      permissionModules: { color },
      seekSpendingPermissions: false,
      encryptWalletMetadata: true
    })
    const { assetId } = await deployAsset(new FakeWallet(), provider, 1_000n)

    const { tx: receipt, customInstructions } = await tokenPayment(
      new FakeWallet(),
      wallet,
      assetId,
      300n
    )
    provider.admit(assetId, receipt, 0)
    await manager.internalizeAction(
      {
        tx: receipt.toAtomicBEEF(),
        description: 'Receive tokens',
        outputs: [
          {
            outputIndex: 0,
            protocol: 'basket insertion',
            insertionRemittance: { basket: assetBasket(assetId, 'value'), customInstructions }
          }
        ]
      },
      APP
    )
    // The manager stores the receipt's custody tuple encrypted; color decrypts it to sign.
    expect(wallet.outputs.get(`${receipt.id('hex')}.0`)?.customInstructions).not.toBe(
      customInstructions
    )

    const recipient = (await tokenPayment(wallet, new FakeWallet(), assetId, 120n)).tx.outputs[0]
    const sent = await manager.createAction(
      {
        description: 'Send tokens',
        labels: ColorPlan.toLabels({
          version: 1,
          assets: [assetId],
          ownedOutputs: [],
          operations: [{ assetId, operation: 'transfer' }],
          inputPositions: [],
          changePositions: [],
          sighashTypes: []
        }),
        outputs: [
          {
            lockingScript: recipient.lockingScript.toHex(),
            satoshis: 1,
            outputDescription: 'Token payment'
          }
        ],
        options: { randomizeOutputs: false }
      },
      APP
    )

    const tx = Transaction.fromAtomicBEEF(sent.tx!)
    expect(sent.signableTransaction).toBeUndefined()
    expect(validInput(tx, 0)).toBe(true)
    expect(tx.outputs.map(output => OneColor.decode(output.lockingScript).amount)).toEqual([
      120n,
      180n
    ])
    expect(provider.submissions.map(submission => submission.txid)).toEqual([tx.id('hex')])
    expect(prompts).toEqual(['color_send'])
    // The manager encrypts the change custody tuple the module adds.
    const change = wallet.outputs.get(`${tx.id('hex')}.1`)?.customInstructions ?? ''
    expect(change.startsWith('{')).toBe(false)
    expect(JSON.parse(await maybeDecryptMetadata(wallet.asWallet(), change))).toMatchObject({
      version: 1,
      assetId
    })
    await expect(
      manager.listOutputs({ basket: `p color balance ${assetTag(assetId)}` }, APP)
    ).resolves.toEqual({ totalOutputs: '180', outputs: [] })
    expect((await manager.getVersion({}, APP)).version).toContain('brc207-color=4')
  })

  it('aborts a declined send, so the inputs it reserved are spendable again', async () => {
    const wallet = new FakeWallet()
    const provider = new FakeProvider()
    // Declines the send; the balance read afterwards is approved.
    const color = createModule(
      wallet,
      provider,
      async (_app, message) => JSON.parse(message).type !== 'color_send'
    )
    const manager = new WalletPermissionsManager(wallet.asWallet(), ADMIN, {
      permissionModules: { color },
      seekSpendingPermissions: false,
      encryptWalletMetadata: true
    })
    const { assetId } = await deployAsset(new FakeWallet(), provider, 1_000n)
    const [held] = await holdTokens(wallet, provider, assetId, [300n])
    const recipient = (await tokenPayment(wallet, new FakeWallet(), assetId, 120n)).tx.outputs[0]
    await expect(
      manager.createAction(
        {
          description: 'Send tokens',
          labels: ColorPlan.toLabels({
            version: 1,
            assets: [assetId],
            ownedOutputs: [],
            operations: [{ assetId, operation: 'transfer' }],
            inputPositions: [],
            changePositions: [],
            sighashTypes: []
          }),
          outputs: [
            {
              lockingScript: recipient.lockingScript.toHex(),
              satoshis: 1,
              outputDescription: 'Token payment'
            }
          ],
          options: { randomizeOutputs: false }
        },
        APP
      )
    ).rejects.toThrow('declined the color_send request')
    expect(provider.submissions).toEqual([])
    expect(wallet.pending.size).toBe(0)
    expect(wallet.outputs.get(`${held.id('hex')}.0`)).toMatchObject({
      spent: false,
      reservedBy: undefined
    })
    await expect(
      manager.listOutputs({ basket: `p color balance ${assetTag(assetId)}` }, APP)
    ).resolves.toEqual({ totalOutputs: '300', outputs: [] })
  })

  it('an attested receipt larger than 1000 bytes passes through WalletPermissionsManager', async () => {
    const wallet = new FakeWallet()
    const attested = createAttestedProfile()
    const store = new FakeStore()
    const color = new ColorPermissionModule({
      wallet: wallet.asWallet(),
      provider: new FakeProvider(),
      requestTokenAccess: async () => true,
      profiles: { [attested.id]: attested },
      store
    })
    const manager = new WalletPermissionsManager(wallet.asWallet(), ADMIN, {
      permissionModules: { color },
      seekSpendingPermissions: false,
      encryptWalletMetadata: true
    })
    const g = graph()
    const { tx: deploy } = attestedAsset(g, C0.SIGNER)
    const receipt = await attestedReceipt({
      g,
      deploy,
      recipient: wallet,
      signers: [new PrivateKey(C0.PRIV)],
      attestTip: true,
      tipOffChainValues: 'ab'.repeat(2048)
    })
    const instructions = receipt.args.outputs[0].insertionRemittance!.customInstructions!
    expect(instructions.length).toBeGreaterThan(4096)

    await expect(manager.internalizeAction(receipt.args, APP)).resolves.toMatchObject({
      accepted: true
    })
    const stored = wallet.outputs.get(`${receipt.tip.id('hex')}.0`)?.customInstructions ?? ''
    expect(stored.startsWith('{')).toBe(false)
    expect(await maybeDecryptMetadata(wallet.asWallet(), stored)).toBe(
      JSON.stringify(receipt.custody)
    )
    expect(store.writes).toContain(`color.v1.settled.${receipt.tip.id('hex')}`)
  })
})
