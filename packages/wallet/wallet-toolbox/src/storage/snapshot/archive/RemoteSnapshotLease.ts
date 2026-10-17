import { OwnedRemoteSnapshotLease } from './OwnedRemoteSnapshotLease'
import { parseSnapshotArchiveReaderRequest, type SnapshotArchiveReaderRequest } from './SnapshotArchiveReaderRequest'
import type { SnapshotArchiveTransport } from './SnapshotArchiveTransport'
import type { WalletReadSnapshotOptions } from '../WalletReadSnapshot'

/** Original row/content lease; the new journal DATA tuple has a separate owner. */
export class RemoteSnapshotLease extends OwnedRemoteSnapshotLease<SnapshotArchiveReaderRequest> {
  constructor(transport: SnapshotArchiveTransport, options: WalletReadSnapshotOptions) {
    super(transport, options, parseSnapshotArchiveReaderRequest)
  }
}
