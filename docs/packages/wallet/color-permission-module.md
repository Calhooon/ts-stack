---
id: color-permission-module
title: '@bsv/color-permission-module'
kind: package
domain: wallet
npm: '@bsv/color-permission-module'
version: '0.2.0'
last_updated: '2026-10-22'
last_verified: '2026-10-22'
review_cadence_days: 30
status: experimental
tags: ['permissions', 'brc207', 'brc162', 'tokens']
repo: 'https://github.com/bsv-blockchain/ts-stack/tree/main/packages/wallet/color-permission-module'
---

# @bsv/color-permission-module

`@bsv/color-permission-module` is the reference BRC-207 `color` wallet module
for BRC-162 fungible tokens. A `WalletPermissionsManager` routes every
`p color` protocol, basket and action label to it.

## Install

```bash
npm install @bsv/color-permission-module @bsv/wallet-toolbox-client @bsv/sdk
```

## Setup

```ts
import { createColorModule } from '@bsv/color-permission-module'
import { WalletPermissionsManager } from '@bsv/wallet-toolbox-client'

const color = createColorModule({
  wallet: setup.wallet,
  provider: colorOverlayProvider,
  requestTokenAccess: async (originator, message) =>
    await showTokenPrompt(originator, JSON.parse(message))
})

const wallet = new WalletPermissionsManager(setup.wallet, adminOriginator, {
  permissionModules: { color }
})
```

`wallet` is the underlying wallet the permissions manager wraps. `provider`
answers the BRC-207 `color-spendability` and `color-admission` queries and
submits transactions to `tm_color_<assetId>`; the host decides which overlays
it trusts. `requestTokenAccess` shows the user each token send,
signature request and read (`color_access` names the basket, asset and role or
the `p color` labels read, and the caller's `seekPermission`), and returns true
to approve.

## Application calls

| Operation                     | Call                                                                                                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Send tokens                   | `createAction` with the BRC-162 recipient output, `p color plan` labels from `ColorPlan.toLabels` and `options.randomizeOutputs: false` (every plan requires it) |
| Deploy, mint, burn, authority | The same call with the plan declaring the BRC-207 operations the transaction performs                                                                            |
| Hand off under BRC-177        | The same call with a `p nosend expiry` label and `noSend` (the only `noSend` token action without a plain-noSend profile)                                        |
| Receive tokens                | `internalizeAction` with `basket insertion` into `p color <assetTag>` and the BRC-207 receipt instructions                                                       |
| Sign an app-built transaction | `createSignature` with a `p color` protocol ID and a BRC-207 signature envelope                                                                                  |
| Discover holdings             | `listOutputs` on `p color assets`                                                                                                                                |
| Exact balance                 | `listOutputs` on `p color balance <assetTag>`; `totalOutputs` is a decimal string                                                                                |

## Required profiles

Hosts that support assets with BRC-207 required processing profiles pass
`profiles` (handlers keyed by profile id) and a durable `store`
(`ColorModuleStore`) to `createColorModule`. The built-in
`createAttestedProfile()` handles `https://brc.dev/207/attested` v1: receipts
carry attested frontier evidence, and outputs credited without a covering
attestation are tagged `color_offline` after the user approves a
`color_receive_offline` request. `settle()` submits offline receipts and own
plain-noSend hand-overs, `isSettled(txid)` reports verified settlement, and
`handoffEvidence(txid)` returns the `colorHandoff` evidence a hand-over's
`signAction` result carried. Errors carry a `[ClassName] ` message prefix; a
declined request throws `ColorConsentDeclinedError`. Without `profiles` the
module behaves as 0.1.0, apart from `seekPermission` on every consent message and
`ColorConsentDeclinedError` on a decline. See the package README for each
handler hook.

## Limits

This version reads BRC-161 JSON `transfer`, `mint` and `deploy+mint` outputs as
value and `auth` and `deploy+auth` as authority, as inputs and as outputs to other
parties, but never holds or creates them, rejects the BRC-161 `burn` operation, satoshi change positions (wallet-toolbox does not
position satoshi change) and assets whose required processing profiles no registered handler supports, does not validate BRC-176 lineage (proof transport is not part of BRC-207), and does not yet record exposure for signatures
released through `createSignature`. With required profiles it also refuses
`createSignature` for assets whose profiles define `sendPolicy`, `submissionData` or
`checkPlanData`, a receipt transaction carrying more than one attested asset, and a
plain-noSend hand-over signed with `options.noSend: false` or a `sendWith` batch. BRC-207's non-final transaction rules are not
implemented; such transactions follow the wallet's existing behavior. A send is approved in `signAction`, against
the funded transaction; a `createSignature` request is approved against the whole
app-built transaction, after every token input is found admitted and unspent. A receipt relies on its overlay's admission of the received output
for the transaction's token amounts; the module does not re-evaluate them. Reads
(`p color assets` and balances) report wallet state alone and never query the
overlay; spendability is checked only when spending.

Derivative modules subclass `ColorPermissionModule`, whose members are
`protected`, and use its exported evaluation helpers (`transactionTokens`,
`requiredOperations`, `actionConsent`, the token readers).
