/** Bounded transaction observations, never semantic or writer authority.
 * Generated clocks and reference values cannot be reconstructed from an
 * archive. They are captured by the actual checkpoint effect, then verified
 * against independently reconstructed row/map effects and stored full bytes. */
export interface Brc38PrivateCheckpointData {
  readonly protocol: 'brc38-private-checkpoint-data/v1'
  readonly syncStateId: number
  readonly mode: 'NEW' | 'UPDATE' | 'SKIP'
  readonly preparedAt: number
  readonly timestamp: string | null
  readonly refNum: string | null
}
function invalid(): never {
  throw new Error('Private checkpoint transaction data differs from its finite original contract')
}
export function brc38PrivateCheckpointData(value: unknown): Readonly<Brc38PrivateCheckpointData> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid()
  const item = value as Brc38PrivateCheckpointData
  if (
    Object.keys(item).sort().join(',') !== 'mode,preparedAt,protocol,refNum,syncStateId,timestamp' ||
    item.protocol !== 'brc38-private-checkpoint-data/v1' ||
    !Number.isSafeInteger(item.syncStateId) ||
    !['NEW', 'UPDATE', 'SKIP'].includes(item.mode) ||
    !Number.isSafeInteger(item.preparedAt) ||
    item.preparedAt < 0
  )
    invalid()
  if (item.mode === 'SKIP') {
    if (item.timestamp !== null || item.refNum !== null) invalid()
  } else {
    if (
      typeof item.timestamp !== 'string' ||
      item.timestamp.length !== 24 ||
      !Number.isSafeInteger(Date.parse(item.timestamp)) ||
      new Date(item.timestamp).toISOString() !== item.timestamp
    )
      invalid()
    if (item.mode === 'NEW') {
      if (item.syncStateId < 1 || typeof item.refNum !== 'string' || !/^[A-Za-z0-9+/]{16}$/.test(item.refNum)) invalid()
    } else if (item.refNum !== null) invalid()
  }
  const result = Object.freeze({
    protocol: item.protocol,
    syncStateId: item.syncStateId,
    mode: item.mode,
    preparedAt: item.preparedAt,
    timestamp: item.timestamp,
    refNum: item.refNum
  })
  if (JSON.stringify(result).length > 512) invalid()
  return result
}
