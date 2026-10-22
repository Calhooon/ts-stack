# Color Permission Module

`@bsv/color-permission-module` implements the BRC-207 `color` wallet module for
BRC-162 fungible tokens. It runs inside a `WalletPermissionsManager` and handles
every `p color` protocol, basket and action label.

## Installation

The module needs the wallet that the permissions manager wraps, an overlay
provider and a prompt callback:

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

`wallet` must be the underlying wallet, not the permissions manager. The module
derives `p color` keys, signs token inputs and reads its baskets through it.
Inventory listing uses the wallet-toolbox `specOpBasketPrefixOutputs` storage
operation.

`provider` implements `ColorOverlayProvider`. The wallet implementer decides
which overlays it trusts:

| Method                             | BRC-207 query                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| `spendability(assetId, outpoints)` | `color-spendability`: outputs currently admitted and unspent                   |
| `admission(assetId, outpoints)`    | `color-admission`: outputs ever admitted, used to read the asset's deploy      |
| `submit(topics, beef, offChain?)`  | Submits to each topic: `tm_color_<assetId>` per asset, `tm_color` for a deploy |

`submit` receives a third argument, the raw BRC-22 `offChainValues` bytes, only
for assets whose required profiles supply submission data; every other call
passes two arguments, so a 0.1.0 provider keeps working unchanged. A submit
returns each topic's admittance, with the BRC-175 `admissionSignature` and
`admissionIdentityKey` when the overlay provides them.

`requestTokenAccess` receives a JSON message whose `type` is `color_send`,
`color_signature`, `color_access` (a read), `color_relinquish` or, with required
profiles, `color_receive_offline`, and returns true to approve. Every message
carries `seekPermission` (false only when the caller passed
`seekPermission: false`), and a `color_send` for a plain-noSend hand-over
carries `handoff: true`. A declined request throws `ColorConsentDeclinedError`.
A `color_access` names the `basket` read (with `assetId` and `role` for a
balance or holdings basket) or the `p color` `labels` of a `listActions`. The
module asks
on every operation and keeps no grants; the host decides whether an existing
grant covers a request and when to prompt the user.

Call `color.dispose()` when the host tears down the wallet. Registered on a
`WalletPermissionsManager`, the module advertises `brc207-color=4` (BRC-205) in
the manager's `getVersion` string, plus `brc207-color-attested=1` when the
attested profile is registered.

## Application calls

- **Send**: `createAction` with the recipient's BRC-162 output, a plan in
  `p color plan` labels, built with `ColorPlan.toLabels`, and
  `options.randomizeOutputs: false` (every plan requires it: the plan's output
  indices and the approved facts name the requested outputs). The module selects
  admitted token inputs and adds token change in `createAction`. In
  `signAction` it checks the funded transaction against the plan, asks the user
  to approve it (`color_send`: every asset leg, satoshi totals and fee, the
  signatures it releases), signs the token inputs with any `sighashTypes`
  override and submits the processed transaction to each asset topic, trying up
  to three times. As in BTMS, an accepted submission completes the action, and
  a held output the overlay does not report is resubmitted from the wallet's
  copy of its transaction when it is next selected.
- **Mint, burn and authority operations**: the plan declares exactly the
  operations BRC-207 derives from the transaction (`mint`, `burn`,
  `authority-split`, `-combine`, `-transfer`, `-end`). Authority inputs are
  selected from the authority basket when the caller supplies none; mints and
  burns use only the caller's value inputs and get no change.
- **Deploy**: a BRC-162 deploy at output 0 with `ISSUE` in `plan.assets` and
  its remittance in `plan.ownedOutputs`.
  Once signed, an owned deploy is filed in its asset's value or authority
  basket (keeping its `ISSUE` key) through the wallet's `internalizeAction`,
  then submitted to `tm_color`; `tm_color_<assetId>` must admit it before it
  can be spent. A deploy cannot be a `noSend` action.
- **Handoff**: the same call with a BRC-177 `p nosend expiry` label and
  `noSend`. For assets without a `plain-nosend` profile this is the only
  `noSend` token action, since a plain `noSend` sent later with `sendWith`
  would never reach the token overlay (see [Required profiles](#required-profiles)
  for plain-noSend hand-overs). When the inputs exceed the amount, the module
  first broadcasts a split to the exact amount. The split pays the wallet
  itself and, like BRC-177's revocation anchor, gets no separate consent.
- **Receive**: `internalizeAction` with `basket insertion` into the asset's
  value or authority basket and the BRC-207 receipt instructions. For assets
  without required profiles, the caller must already have submitted the
  transaction; the received output must be admitted and unspent, and every
  input must unlock its source. The module relies on that admission for the
  transaction's token amounts rather than re-evaluating them. Attested assets
  are received from their frontier evidence instead, and may be credited
  offline (see [Required profiles](#required-profiles)).
- **App-built transactions**: `createSignature` with a `p color` protocol ID
  and a BRC-207 signature envelope in `data`. The whole transaction is
  evaluated as a send is: every input needs its source, every token input must
  be admitted and unspent in its overlay, and the user approves the same facts
  (`color_signature`: every asset leg, destinations, satoshi totals and fee,
  the signature released) before the module signs.
- **Reads**: `listOutputs` with `p color assets`, `p color balance <assetTag>`
  or `p color balance <assetTag> authority`. Balances are exact decimal strings.
  As in BTMS, reads report wallet state alone and never query the overlay: the
  inventory tags each output `color_state_available` or `color_state_reserved`
  (an input of a pending action). Overlay spendability is checked only when
  spending.

## Required profiles

A deploy may require BRC-207 processing profiles in its `req` map. Without
registered handlers the module refuses every such asset, exactly as 0.1.0 did,
and never touches a store. A host that supports profiles registers one handler
per profile id and injects a durable store:

```ts
import {
  ATTESTED_PROFILE_ID,
  createAttestedProfile,
  createColorModule
} from '@bsv/color-permission-module'

const color = createColorModule({
  wallet: underlyingWallet,
  provider: defaultProvider,
  requestTokenAccess,
  store, // ColorModuleStore: durable get/set/delete/keys
  profiles: {
    [ATTESTED_PROFILE_ID]: createAttestedProfile(),
    [issuerProfile.id]: issuerProfile // any other profile the host's assets require
  }
})
```

Each `profiles` key must equal its handler's `id`, and `store` is required when
`profiles` is non-empty; the constructor throws a `TypeError` otherwise. Every
store key the module writes starts with `color.v1.`. The layout under that
prefix is internal to the module: hosts never read or write it, and use
`settle()`, `handoffEvidence()` and `isSettled()` instead.

An asset is supported only when every profile in its deploy's `req` is
registered with a matching version (`versions`), otherwise
`UnsupportedProfileError`. The deploy is resolved, each source checked against
its transaction id, from the request's attested `declarationTx`, then the
`color.v1.` cache, then the default provider, then each handler's
`deployProviders()` in registration order. A `RequiredProfileHandler`
(`ProfileDescriptor`, `ProfileAssetContext`, `ProfileTxView`, `ReceiptGraph`
and `ReceiptAdmission` are exported types) defines:

| Member             | When it runs and what it decides                                                                                                                                                                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `versions`   | The profile URI and the exact versions it supports                                                                                                                                                                                                                               |
| `checkDescriptor`  | Synchronously, at asset resolution: validates its `req` entry against the whole `req`; throws `ProfileParamsError`                                                                                                                                                               |
| `checkExt`         | At asset resolution: validates the profile's own `ext` entry; without it that entry must be absent                                                                                                                                                                               |
| `provider`         | Routes every spendability, admission, submit and settle call for the asset; two handlers of one asset returning different providers fail with `ProfileParamsError`                                                                                                               |
| `deployProviders`  | Asked in order for an unknown asset's deploy after the default provider                                                                                                                                                                                                          |
| `sendPolicy`       | `'plain-nosend'`: every token `createAction` moving the asset must be `noSend` without a BRC-177 expiry label; token change stays in the transaction, tagged `color_offline`, and the module never submits the action                                                            |
| `operations`       | The operations a holder may declare for the asset; absent means all                                                                                                                                                                                                              |
| `checkPlanData`    | In `createAction` and again in `signAction`: checks the plan's `profileData` leaf for the asset (undefined when absent); throws `ProfileDataError`                                                                                                                               |
| `submissionData`   | In `signAction`, before signing: the non-empty `offChainValues` bytes submitted to `tm_color_<assetId>`; at most one handler per asset                                                                                                                                           |
| `admitReceipt`     | For every receipt of the asset, after the base checks and attested-evidence parsing and before any credit; `admitted` settles it, `unavailable` (transport failure only) allows offline acceptance, a throw refuses it; at most one handler per asset, and only with attested v1 |
| `checkReceiptData` | Validates a receipt `profileData` leaf for the profile; without it any such leaf is rejected with `ProfileDataError`                                                                                                                                                             |
| `maxReceiptBytes`  | The receipt `customInstructions` limit for the asset (default 1000 bytes; the largest of the asset's handlers applies)                                                                                                                                                           |

Plan `profileData` may name only profiles in the asset's `req` and assets in
`plan.assets` (`ProfileDataError` otherwise).

### Attested profile

`createAttestedProfile({ trustedIdentities? })` returns the built-in
`https://brc.dev/207/attested` version 1 handler (`ATTESTED_PROFILE_ID`) with a
16 MiB receipt limit. Its params are a map with an optional `trustMode` (`any`,
the default, `same`, `all` or `identity`), an `identityKey` present exactly in
`identity` mode, or an `evidenceProfile` that the same `req` must require. The
`any`, `same` and `all` modes take the BRC-189 snapshot from
`trustedIdentities` and fail closed without it; `identity` mode never calls it.

An attestation (`ColorAttestation`) is `{txid, outputs, signer, signature}`.
The signed statement is
`1color-admit:v1:tm_color_<assetId>:<txid>:<outputs joined by ",">`, hashed
once with SHA-256 and signed with the BRC-42 child of the signer's identity key
under protocol `[2, 'color admission attestation']` (`ATTESTATION_PROTOCOL_ID`),
key ID `'1'` (`ATTESTATION_KEY_ID`) and counterparty `anyone`.
`verifyAttestation` accepts low-S and high-S signatures in strict DER and never
verifies against the bare identity key. `attestationMessage`,
`attestationSigningKey`, `parseAttestation` and `attestationFromSteak` (which
maps a BRC-22 STEAK entry carrying `admissionSignature` and
`admissionIdentityKey`) are exported too. The BRC-207 C.0 vector, which the test
suite reproduces byte for byte:

| Field         | Value                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Private key   | `5555` (a public test key)                                                                                                                              |
| Signer        | `02798b81951a6a8c7ef8beda09b06a23031d7efaf37b663265e0188ab378124046`                                                                                    |
| Child key     | `033520aaa77b6914019796e974d1737acc890c5283c0921ddcfc2d5c815db8fb90`                                                                                    |
| Asset, txid   | `c7d0f61946bc8bde6c01219c67bb99cbf2f89a39bcaea9c2ecf67c54224edb4f_0`, `05fabadb4a03eb7d5e54713824a483161a82ecc7061b124e99a13e9778131931`, outputs `0,2` |
| Digest        | `9f61b417ec979c3c057313fe56f3c6056d2962b6bceaaa8272377bb9a80d8f9d`                                                                                      |
| Low-S (signs) | `3045022100d1f48fc13a1ffd18196bcb6166aff936b8dc6cb7b0866fe9226ef1db89fb06be02203eff5870ae5215047d1d624733b29f563d5037660ce5c4ed0ce4ac52cc56758a`        |

A receipt of an attested asset carries the attested `profileData` leaf
(`declarationTx`, `transactions`, `attestations`, `submissions`). The module
validates the complete token frontier behind the received outputs back to
outputs attested by a qualifying signer, then applies the trust mode. A leaf
carrying `lifecycles` is rejected.

### Offline state and settlement

A receipt whose received outputs no qualifying attestation covers is credited
offline only after the user approves a `color_receive_offline` message
(`assetId`, `outputs` with amounts, `unsettledTransactions`, `signer` in
`identity` mode or the sorted `signers` otherwise, the asset's `profiles` and
`seekPermission`). Before calling the wallet's `internalizeAction` the module
durably stores the exact transaction bytes, the unattested ancestors, their
submission data and the attestations; the wallet keeps only the custody JSON.
A declined request writes nothing and credits nothing.

Such outputs, and the token change of a `plain-nosend` hand-over, carry the
stored tag `color_offline`. Views (`p color assets`, balances and tag filters)
show `color_offline` until a verified attestation settles the transaction; an
offline output is spendable and counts in the balance. A final overlay refusal
shows the output as `color_state_restricted` and removes it from the balance.
Caller-supplied `color_*` tags are stripped whenever profiles are registered.
If the store is lost, coins stay offline and never show as settled.

- `settle(request?, originator?)` submits, parents first and with the exact
  stored bytes and `offChainValues`, every offline-credited receipt and every
  own hand-over the overlay already admits, and the own hand-overs named in
  `request.txids` (that intent is kept until they settle). It is single-flight
  per module with a per-transaction latch, so concurrent calls submit each
  transaction once. It records a settlement only after verifying an
  attestation, reports overlay refusals in its `ColorSettleReport` instead of
  throwing, and after admitting an own `noSend` action calls the wallet's
  `createAction` with `sendWith`.
- `handoffEvidence(txid)` returns the `ColorHandoffResult` of an own
  plain-noSend hand-over, rebuilt from the store, for a resend after a lost
  acknowledgement.
- `isSettled(txid)` is true once a verified attestation settled the
  transaction; hosts hold their broadcast of a token transaction until then.
- `dispose()` is synchronous and idempotent: it clears in-memory state, lets an
  in-flight `settle()` resolve and starts no new submit.

A `signAction` result for a plain-noSend hand-over carries a `colorHandoff`
member (`{version: 1, txid, profileData}`): receipt-ready evidence for the
recipient. It is not part of BRC-100, survives JSON substrates and is lost on
the binary one; `handoffEvidence` returns the same object.

The hand-over record is written when the wallet's signed result reaches the
module, before `signAction` returns to the app; the txid is not known earlier.
A crash between the wallet signing and that write leaves a signed `nosend`
action that the module has no record of: `handoffEvidence` returns
`undefined`, `settle()` never sees it, the app never received a result, and an
onward offline hand-over of its `color_offline` change fails for lack of
evidence. The module never aborts such an action itself. The host recovers by
finding the orphaned `nosend` action by its `p color plan` labels (or its own
journal of the action reference) with `listActions` and calling the wallet's
`abortAction` on it, which releases its inputs; the app then retries the
hand-over.

### Errors

`ProfileParamsError`, `ProfileDataError`, `AttestationEvidenceError` (with a
`reason`), `ColorProviderError` (`code`, `retryable`, `transport`; providers
throw it for overlay and transport failures) and `ColorConsentDeclinedError` are
exported runtime values. Each sets `name` to its class name and starts its
message with `[ClassName] `. Hosts and bridges match on `name`, then on that
prefix, never on `instanceof`, since the module can be loaded more than once.
`UnsupportedProfileError` keeps its 0.1.0 messages.

## Limits of this version

The module fails explicitly, rather than falling back, on:

- holding, creating or filing BRC-161 JSON outputs, and the BRC-161 `burn`
  operation. BRC-161 JSON `transfer`, `mint` and `deploy+mint` outputs are read
  as value and `auth` and `deploy+auth` as authority, as inputs and as outputs
  to other parties, with the same overlay checks as any foreign token input; the
  envelope may sit anywhere in the script (BRC-160). Only value inputs can fund
  JSON transfer outputs; a JSON mint needs an authority input. Assets first
  deployed as BRC-161, at any output index, are supported in BRC-162 form;
- assets whose deploy declares required processing profiles that no
  registered handler supports, among them BRC-209;
- `profileData` entries for profiles the asset does not require;
- building a deploy that declares a non-empty `req`, and attested `ISSUE`
  leaves in plans and receipts: such deploys are built outside the module;
- BRC-177 `lifecycles` in attested evidence;
- `createSignature` for assets whose profiles define `sendPolicy` or
  `submissionData`, since a released signature cannot carry submission data or
  keep hand-over evidence;
- satoshi change positions (`changePositions` with a null `assetId`): wallet-toolbox
  adds satoshi change while funding and does not position it.

Explicit inputs are supported: this wallet's `p color` outputs are signed by the
module, and foreign token inputs count only once their asset's overlay admits
them. For attested assets too, foreign inputs use live spendability: frontier
evidence in a plan or signature envelope is not consumed. An input missing from `inputBEEF` is resolved by the wallet and checked
in `signAction`. `inputPositions` and token `changePositions` are honored; change
positions follow the requested outputs.

The module does not validate BRC-176 lineage: proof transport is not part of
BRC-207, and a separate module will feed lineage packets to a wallet-local
overlay before this one runs. It relies on overlay admission and spendability.
Plans, signature envelopes and receipt instructions have no `tokenProofs`
member, and a `p color` label other than a plan label is rejected.

Signatures released through `createSignature` are not yet recorded as BRC-207
exposure. BRC-207's non-final transaction rules are not implemented; such
transactions follow the wallet's existing behavior.

## Extending the module

A wallet with its own token policy can subclass `ColorPermissionModule`: its
members are `protected`, so a derivative can override, for example, `approve`
(the consent prompt), `assertSupportedAsset` (which assets it handles),
`selectInputs` (coin selection) or `spendable` (the overlay query). The helpers
the module evaluates transactions with are exported too: the token readers
(`readTokenOutput`, `tryReadTokenOutput`, `readSentToken`), `transactionTokens`,
`requiredOperations`, `supplyChange`, and the consent builders `actionConsent`
and `transactionConsent`.

## Verification

```bash
pnpm --filter @bsv/sdk build
pnpm --filter @bsv/wallet-toolbox-client build
pnpm --filter @bsv/color-permission-module typecheck
pnpm --filter @bsv/color-permission-module lint
pnpm --filter @bsv/color-permission-module test:coverage
```

## License

Open BSV License version 6. See `LICENSE.txt`.
