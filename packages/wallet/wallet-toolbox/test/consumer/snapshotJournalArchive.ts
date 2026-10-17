import type {
  StorageClient,
  RemoteSnapshotJournalArchive,
  SnapshotJournalArchivePosition,
  SnapshotJournalArchiveCapabilities
} from '@bsv/wallet-toolbox'

/** Declaration consumer: the artifact remains distinct from a live SQL actor. */
export async function inspectJournal(
  client: StorageClient,
  identityKey: string,
  position?: SnapshotJournalArchivePosition
): Promise<number | undefined> {
  const capabilities: SnapshotJournalArchiveCapabilities | undefined = (await client.makeAvailable())
    .snapshotJournalArchive
  if (capabilities === undefined) return undefined
  const archive: RemoteSnapshotJournalArchive | undefined = await client.openSnapshotJournalArchive(
    identityKey,
    position
  )
  if (archive === undefined) return undefined
  try {
    return archive.frameCount
  } finally {
    await archive.close()
  }
}
