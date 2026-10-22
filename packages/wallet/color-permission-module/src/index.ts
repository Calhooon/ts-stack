import { ColorPermissionModule } from './ColorPermissionModule.js'
import type { ColorPermissionModuleOptions } from './types.js'

export {
  ColorPermissionModule,
  actionConsent,
  assertPlanAssets,
  assertTransactionOperations,
  assertUnlocks,
  authorityOperation,
  deployOperation,
  readSentToken,
  requiredOperations,
  sighashScopes,
  submissionAssets,
  supplyChange,
  tokenSources,
  transactionConsent,
  transactionTokens,
  tryReadTokenOutput
} from './ColorPermissionModule.js'
export type {
  ActionConsentOptions,
  Custody,
  Holding,
  ManagedInput,
  ReleasedSignature,
  SourceOutput,
  TransactionConsentOptions,
  TransactionTokens
} from './ColorPermissionModule.js'
export {
  UnsupportedProfileError,
  assertNoRequiredProfiles,
  readAnyTokenOutput,
  readJsonTokenOutput,
  readProfiledTokenOutput,
  readTokenOutput
} from './tokenOutputs.js'
export type { JsonOperation, TokenOutput, TokenReader } from './tokenOutputs.js'
export {
  ATTESTATION_KEY_ID,
  ATTESTATION_PROTOCOL_ID,
  ATTESTED_PROFILE_ID,
  COLOR_OFFLINE_TAG,
  attestationFromSteak,
  attestationMessage,
  attestationSigningKey,
  parseAttestation,
  verifyAttestation
} from './attestation.js'
export { createAttestedProfile } from './attested.js'
export {
  AttestationEvidenceError,
  ColorConsentDeclinedError,
  ColorProviderError,
  ProfileDataError,
  ProfileParamsError
} from './errors.js'
export { ColorPlan, COLOR_PLAN_LABEL_PREFIX, COLOR_OPERATIONS } from './ColorPlan.js'
export type { ColorOperation, ColorOperationName, ColorRemittance } from './ColorPlan.js'
export {
  ASSETS_SELECTOR,
  COLOR_KEY_ID,
  ISSUE,
  assetBasket,
  assetTag,
  colorProtocolID,
  colorTopic,
  parseAssetBasket,
  parseBalanceSelector,
  parseColorProtocolID
} from './identifiers.js'
export type { TokenRole } from './identifiers.js'
export type {
  AttestedAdmittance,
  AttestedSTEAK,
  ColorModuleStore,
  ColorOverlayProvider,
  ColorPermissionModuleOptions,
  ColorTokenAccessHandler,
  ProfileData
} from './types.js'
export type {
  ColorAttestation,
  ColorHandoffResult,
  ColorSettleReport,
  ColorSettleResult,
  ProfileAssetContext,
  ProfileDescriptor,
  ProfileTxView,
  ReceiptAdmission,
  ReceiptGraph,
  RequiredProfileHandler
} from './profiles.js'
export type { JsonValue } from './strictJson.js'

export const createColorModule = (options: ColorPermissionModuleOptions): ColorPermissionModule =>
  new ColorPermissionModule(options)
