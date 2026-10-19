import { promiseFromSync } from '../../utility/promiseFromSync'
import type { StorageWriterAdmission } from '../StorageActiveWrite'
import { type ValidListOutputsArgs } from '@bsv/sdk/wallet/validationHelpers'
import { ListOutputsResult } from '@bsv/sdk'
import { StorageProvider } from '../StorageProvider'
import { AuthId, TrxToken } from '../../sdk/WalletStorage.interfaces'
import { TableOutput } from '../schema/tables/TableOutput'
import {
  specOpInvalidChange,
  specOpSetWalletChangeParams,
  specOpWalletBalance,
  specOpWalletManagedUtxos
} from '../../sdk/types'
import { verifyId, verifyInteger, verifyOne } from '../../utility/utilityHelpers'
import { WERR_INVALID_PARAMETER } from '../../sdk/WERR_errors'
import { MAX_UTXO_REVIEW_CANDIDATES, reviewUtxoOutputs } from './reviewUtxoOutputs'

export interface ListOutputsSpecOp {
  name: string
  useBasket?: string
  ignoreLimit?: boolean
  /** Hard ceiling applied even when this operation intentionally ignores caller paging. */
  maximumCandidateCount?: number
  includeOutputScripts?: boolean
  includeSpent?: boolean
  /**
   * If true, and supported by storage, maximum performance optimization, computing balance done in the query itself.
   */
  totalOutputsIsSumOfSatoshis?: boolean
  /** Restrict the operation to wallet-managed, BRC-29-signable change. */
  managedChangeOnly?: boolean
  resultFromTags?: (
    s: StorageProvider,
    auth: AuthId,
    vargs: ValidListOutputsArgs,
    specOpTags: string[],
    admission?: StorageWriterAdmission
  ) => Promise<ListOutputsResult>
  resultFromOutputs?: (
    s: StorageProvider,
    auth: AuthId,
    vargs: ValidListOutputsArgs,
    specOpTags: string[],
    outputs: TableOutput[]
  ) => Promise<ListOutputsResult>
  filterOutputs?: (
    s: StorageProvider,
    auth: AuthId,
    vargs: ValidListOutputsArgs,
    specOpTags: string[],
    outputs: TableOutput[],
    admission?: StorageWriterAdmission
  ) => Promise<TableOutput[]>
  /**
   * undefined to intercept no tags from vargs,
   * empty array to intercept all tags,
   * or an explicit array of tags to intercept.
   */
  tagsToIntercept?: string[]
  /**
   * How many positional tags to intercept.
   */
  tagsParamsCount?: number
}

const getBasketToSpecOp: () => Record<string, ListOutputsSpecOp> = () => {
  return {
    [specOpWalletBalance]: {
      name: 'totalOutputsIsWalletBalance',
      useBasket: 'default',
      ignoreLimit: true,
      totalOutputsIsSumOfSatoshis: true,
      managedChangeOnly: true,
      resultFromOutputs: (
        s: StorageProvider,
        auth: AuthId,
        vargs: ValidListOutputsArgs,
        specOpTags: string[],
        outputs: TableOutput[]
      ): Promise<ListOutputsResult> =>
        promiseFromSync(() => {
          let totalOutputs = 0
          for (const o of outputs) totalOutputs += o.satoshis
          return { totalOutputs, outputs: [] }
        })
    },
    [specOpWalletManagedUtxos]: {
      name: 'walletManagedUtxos',
      useBasket: 'default',
      managedChangeOnly: true
    },
    [specOpInvalidChange]: {
      name: 'invalidChangeOutputs',
      useBasket: 'default',
      ignoreLimit: true,
      maximumCandidateCount: MAX_UTXO_REVIEW_CANDIDATES,
      includeOutputScripts: true,
      includeSpent: false,
      tagsToIntercept: ['release', 'all'],
      filterOutputs: async (
        s: StorageProvider,
        auth: AuthId,
        vargs: ValidListOutputsArgs,
        specOpTags: string[],
        outputs: TableOutput[],
        admission?: StorageWriterAdmission
      ): Promise<TableOutput[]> => {
        const release = specOpTags.includes('release')
        const review = await reviewUtxoOutputs(s, auth, outputs, release ? 'atomic' : 'none', admission)
        return review.confirmedSpentOutputs
      }
    },
    [specOpSetWalletChangeParams]: {
      name: 'setWalletChangeParams',
      tagsParamsCount: 2,
      resultFromTags: async (
        s: StorageProvider,
        auth: AuthId,
        vargs: ValidListOutputsArgs,
        specOpTags: string[],
        admission?: StorageWriterAdmission
      ): Promise<ListOutputsResult> => {
        if (specOpTags.length !== 2) {
          throw new WERR_INVALID_PARAMETER('numberOfDesiredUTXOs and minimumDesiredUTXOValue', 'valid')
        }
        const numberOfDesiredUTXOs: number = verifyInteger(Number(specOpTags[0]))
        const minimumDesiredUTXOValue: number = verifyInteger(Number(specOpTags[1]))
        const write = typeof s.activeWriteTransaction === 'function' ? await s.activeWriteTransaction(auth) : undefined
        const update = async (trx?: TrxToken) => {
          const basket = verifyOne(
            await s.findOutputBaskets({ partial: { userId: verifyId(auth.userId), name: 'default' }, trx })
          )
          await s.updateOutputBasket(basket.basketId, { numberOfDesiredUTXOs, minimumDesiredUTXOValue }, trx)
        }
        const commit = async () => (write == null ? await update() : await write.transaction(update))
        if (admission != null && write?.prepareOutsideManager === true) await admission(commit)
        else await commit()
        return { totalOutputs: 0, outputs: [] }
      }
    }
  }
}

const getTagToSpecOp: () => Record<string, ListOutputsSpecOp> = () => {
  return {
    [specOpWalletBalance]: {
      name: 'totalOutputsIsWalletBalance',
      useBasket: 'default',
      ignoreLimit: true,
      totalOutputsIsSumOfSatoshis: true,
      resultFromOutputs: (
        s: StorageProvider,
        auth: AuthId,
        vargs: ValidListOutputsArgs,
        specOpTags: string[],
        outputs: TableOutput[]
      ): Promise<ListOutputsResult> =>
        promiseFromSync(() => {
          let totalOutputs = 0
          for (const o of outputs) totalOutputs += o.satoshis
          return { totalOutputs, outputs: [] }
        })
    }
  }
}

let _basketSpecOps: Record<string, ListOutputsSpecOp> | undefined
let _tagSpecOps: Record<string, ListOutputsSpecOp> | undefined

function resolveBasketSpecOp(
  basket: string,
  tags: string[]
): { specOp: ListOutputsSpecOp; basket?: string; tags: string[] } | undefined {
  if (!basket) return undefined
  _basketSpecOps ??= getBasketToSpecOp()
  const specOp = _basketSpecOps[basket]
  return specOp === undefined ? undefined : { specOp, basket: specOp.useBasket, tags: tags || [] }
}

function resolveTagSpecOp(
  basket: string,
  tags: string[]
): { specOp: ListOutputsSpecOp; basket?: string; tags: string[] } | undefined {
  if (!tags) return undefined
  _tagSpecOps ??= getTagToSpecOp()
  for (const tag of tags) {
    const specOp = _tagSpecOps[tag]
    if (specOp === undefined) continue
    if (!basket && specOp.useBasket) basket = specOp.useBasket
    // The balance tag is also used to sum application baskets. Preserve
    // that behavior, while treating the default basket as wallet balance
    // and therefore restricting it to managed BRC-29 change.
    const resolvedSpecOp =
      specOp === _tagSpecOps[specOpWalletBalance] && basket === 'default'
        ? { ...specOp, managedChangeOnly: true }
        : specOp
    return { specOp: resolvedSpecOp, basket, tags: tags.filter(candidate => candidate !== tag) }
  }
  return undefined
}

/**
 * Check basket and tags arguments passed to listOutputs to determine if they trigger a special operation execution mode.
 * @param basket
 * @param tags
 * @returns
 */
export function getListOutputsSpecOp(
  basket: string,
  tags: string[]
): { specOp: ListOutputsSpecOp | undefined; basket?: string; tags: string[] } {
  return resolveBasketSpecOp(basket, tags) ?? resolveTagSpecOp(basket, tags) ?? { specOp: undefined, basket, tags }
}
