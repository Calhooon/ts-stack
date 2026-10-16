import type { Knex } from 'knex'
import { brc38SourceSealFieldDefinitions } from './Brc38AuthenticatedSourceSealNode'
import { brc38SqlStructuredPrefixDefinitions, type Brc38StructuredPrefixFamily } from './Brc38SqlStructuredPrefixGuards'

interface Definition {
  readonly name: string
  readonly table: string
  readonly sql: string
}
interface SchemaCounts {
  readonly total: number
  readonly baseMatches: number
  readonly prefixMatches: number
  readonly sealCount: number
  readonly sealMatches: number
}
function exact(definitions: readonly Definition[], bindings: Array<string | number>): string {
  return definitions
    .map(value => {
      bindings.push(value.name, value.table, value.sql)
      return "(type='trigger' AND name=? AND tbl_name=? AND CAST(sql AS BLOB)=CAST(? AS BLOB))"
    })
    .join(' OR ')
}
/** Fresh bounded scalar comparison DATA from the original SQLite view. Every
 * table, primary index, immutable-prefix trigger and optional authenticated seal
 * is compared together. No DDL payload or reusable verdict crosses the boundary;
 * callers retain ownership, absence, completeness and original error checks. */
export async function readBrc38SqlFieldSchemaCounts(
  k: Knex,
  family: Brc38StructuredPrefixFamily,
  tables: readonly (readonly [string, string])[]
): Promise<SchemaCounts> {
  if (tables.length !== 2) throw new Error('Private field comparison requires its two original tables')
  const bindings: Array<string | number> = []
  const tableMatches = tables.map(([name, sql]) => {
    bindings.push(name, name, sql)
    return "(type='table' AND name=? AND tbl_name=? AND CAST(sql AS BLOB)=CAST(? AS BLOB))"
  })
  bindings.push(...tables.map(([name]) => `sqlite_autoindex_${name}_1`))
  const base = [...tableMatches, "(type='index' AND sql IS NULL AND name IN (?,?))"].join(' OR ')
  const prefixes = exact(brc38SqlStructuredPrefixDefinitions(family), bindings)
  const sealPrefix = 'brc38_source_seal_'
  bindings.push(sealPrefix.length, sealPrefix)
  const seals = exact(brc38SourceSealFieldDefinitions(family), bindings)
  const result = (await k('sqlite_schema')
    .whereIn(
      'tbl_name',
      tables.map(([name]) => name)
    )
    .select(
      k.raw(
        `count(*) AS total,
      sum(CASE WHEN ${base} THEN 1 ELSE 0 END) AS baseMatches,
      sum(CASE WHEN ${prefixes} THEN 1 ELSE 0 END) AS prefixMatches,
      sum(CASE WHEN type='trigger' AND substr(name,1,?)=? THEN 1 ELSE 0 END) AS sealCount,
      sum(CASE WHEN ${seals} THEN 1 ELSE 0 END) AS sealMatches`,
        bindings
      )
    )
    .first()) as SchemaCounts | undefined
  if (result === undefined) throw new Error('Private field schema comparison is unavailable')
  return result
}
