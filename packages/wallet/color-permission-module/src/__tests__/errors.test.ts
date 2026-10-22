import { describe, expect, it } from '@jest/globals'
import { Transaction, type CreateActionArgs, type CreateActionResult } from '@bsv/sdk'
import type { PermissionsModuleAction } from '@bsv/wallet-toolbox-client'
import { ColorPlan } from '../ColorPlan.js'
import {
  AttestationEvidenceError,
  ColorConsentDeclinedError,
  ColorProviderError,
  isNamedError,
  ProfileDataError,
  ProfileParamsError
} from '../errors.js'
import { UnsupportedProfileError } from '../tokenOutputs.js'
import {
  createModule,
  deployAsset,
  FakeProvider,
  FakeWallet,
  holdTokens,
  tokenPayment
} from './fixtures.js'

const APP = 'app.example'

describe('module errors', () => {
  it('names every error class for cross-bundle matching', () => {
    expect(new ProfileParamsError('x').name).toBe('ProfileParamsError')
    expect(new ProfileDataError('x').name).toBe('ProfileDataError')
    const evidence = new AttestationEvidenceError('duplicate spend')
    expect(evidence.name).toBe('AttestationEvidenceError')
    expect(evidence.reason).toBe('duplicate spend')
    const provider = new ColorProviderError('ERR_UNAVAILABLE', true, true, 'down')
    expect([provider.name, provider.code, provider.retryable, provider.transport]).toEqual([
      'ColorProviderError',
      'ERR_UNAVAILABLE',
      true,
      true
    ])
    expect(provider).toBeInstanceOf(Error)
    expect(isNamedError(provider, 'ColorProviderError')).toBe(true)
    expect(isNamedError({ name: 'ColorProviderError' }, 'ColorProviderError')).toBe(true)
    // An HTTP bridge that lost .name still carries the message prefix.
    expect(isNamedError(new Error('[ColorProviderError] bridged'), 'ColorProviderError')).toBe(true)
    expect(isNamedError(new Error('ColorProviderError bridged'), 'ColorProviderError')).toBe(false)
    expect(isNamedError(provider, 'ProfileDataError')).toBe(false)
    expect(isNamedError(undefined, 'ColorProviderError')).toBe(false)
    expect(isNamedError(null, 'ColorProviderError')).toBe(false)
    expect(isNamedError('[ColorProviderError] text', 'ColorProviderError')).toBe(false)
    expect(isNamedError({ name: 1, message: 2 }, 'ColorProviderError')).toBe(false)
    expect(new UnsupportedProfileError().message).toBe(
      'BRC-207: the asset requires processing profiles this wallet does not support'
    )
    expect(new UnsupportedProfileError().name).toBe('UnsupportedProfileError')
    expect(
      new UnsupportedProfileError('BRC-207: the required processing profile version is unsupported')
        .message
    ).toBe('BRC-207: the required processing profile version is unsupported')
  })

  it('prefixes every new error message with its class name exactly once', () => {
    expect(new ProfileParamsError('BRC-207: x').message).toBe('[ProfileParamsError] BRC-207: x')
    expect(new ProfileParamsError('[ProfileParamsError] BRC-207: x').message).toBe(
      '[ProfileParamsError] BRC-207: x'
    )
    expect(new ProfileDataError('BRC-207: x').message).toBe('[ProfileDataError] BRC-207: x')
    expect(new AttestationEvidenceError('duplicate spend').message).toBe(
      '[AttestationEvidenceError] BRC-207: attested evidence rejected (duplicate spend)'
    )
    expect(new ColorProviderError('ERR_UNAVAILABLE', true, true, 'down').message).toBe(
      '[ColorProviderError] down'
    )
    expect(
      new ColorProviderError(
        'ERR_FROZEN',
        true,
        false,
        '[ColorProviderError] mandala overlay refused (ERR_FROZEN, retryable): frozen'
      ).message
    ).toBe('[ColorProviderError] mandala overlay refused (ERR_FROZEN, retryable): frozen')
    const declined = new ColorConsentDeclinedError('color_send')
    expect([declined.name, declined.requestType, declined.message]).toEqual([
      'ColorConsentDeclinedError',
      'color_send',
      '[ColorConsentDeclinedError] BRC-207: the user declined the color_send request'
    ])
  })

  it('throws ColorConsentDeclinedError on every declined consent, keeping the 0.1.0 message text', async () => {
    const wallet = new FakeWallet()
    const provider = new FakeProvider()
    const { assetId } = await deployAsset(new FakeWallet(), provider, 1_000_000n)
    await holdTokens(wallet, provider, assetId, [300n])
    const { tx } = await tokenPayment(wallet, new FakeWallet(), assetId, 100n)
    const module = createModule(wallet, provider, async () => false)
    const submitted = provider.submissions.length
    const args: CreateActionArgs = {
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
          lockingScript: tx.outputs[0].lockingScript.toHex(),
          satoshis: 1,
          outputDescription: 'Token payment'
        }
      ],
      options: { randomizeOutputs: false }
    }
    const funded = (await module.onRequest({ method: 'createAction', args, originator: APP }))
      .args as CreateActionArgs
    const created = (await module.onResponse(await wallet.createAction(funded), {
      method: 'createAction',
      originator: APP
    })) as CreateActionResult
    const signable = created.signableTransaction!
    const action: PermissionsModuleAction = {
      reference: signable.reference,
      transaction: Transaction.fromAtomicBEEF(signable.tx),
      noSend: false,
      createArgs: wallet.pending.get(signable.reference)!.args
    }
    const sent = module.onRequest({
      method: 'signAction',
      args: { reference: action.reference, spends: {} },
      originator: APP,
      action
    })
    await expect(sent).rejects.toMatchObject({ name: 'ColorConsentDeclinedError' })
    await expect(sent).rejects.toThrow('declined the color_send request')
    const error = await sent.catch((e: unknown) => e)
    expect(isNamedError(error, 'ColorConsentDeclinedError')).toBe(true)
    expect((error as ColorConsentDeclinedError).requestType).toBe('color_send')
    expect(provider.submissions).toHaveLength(submitted)
  })
})
