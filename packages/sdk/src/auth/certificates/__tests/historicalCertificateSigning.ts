import Certificate from '../Certificate.js'
import { Utils } from '../../../primitives/index.js'
import type ProtoWallet from '../../../wallet/ProtoWallet.js'

/**
 * The pre-2.8.0 `Certificate.toBinary(false)` layout: raw type bytes, 32-byte
 * serial number, both compressed public keys, revocation txid plus varint
 * index, then the locale-sorted fields. Test fixtures use it to sign
 * certificates exactly as a 2.7.x certifier did.
 */
export function historicalPreimage(certificate: Certificate, typeBytes: number[]): number[] {
  const writer = new Utils.Writer()
  writer.write(typeBytes)
  writer.write(Utils.toArray(certificate.serialNumber, 'base64'))
  writer.write(Utils.toArray(certificate.subject, 'hex'))
  writer.write(Utils.toArray(certificate.certifier, 'hex'))
  const [txid, outputIndex] = certificate.revocationOutpoint.split('.')
  writer.write(Utils.toArray(txid, 'hex'))
  writer.writeVarIntNum(Number(outputIndex))
  const fieldNames = Object.keys(certificate.fields).sort((a, b) => a.localeCompare(b))
  writer.writeVarIntNum(fieldNames.length)
  for (const fieldName of fieldNames) {
    const nameBytes = Utils.toArray(fieldName, 'utf8')
    writer.writeVarIntNum(nameBytes.length)
    writer.write(nameBytes)
    const valueBytes = Utils.toArray(certificate.fields[fieldName], 'utf8')
    writer.writeVarIntNum(valueBytes.length)
    writer.write(valueBytes)
  }
  return writer.toArray()
}

/**
 * Signs exactly as a 2.7.x certifier did for the certificate's current `type`
 * string: the preimage carries `typeBytes` and the key ID carries the string.
 */
export async function signHistorically(
  certificate: Certificate,
  typeBytes: number[],
  certifierWallet: ProtoWallet
): Promise<void> {
  const { signature } = await certifierWallet.createSignature({
    data: historicalPreimage(certificate, typeBytes),
    protocolID: [2, 'certificate signature'],
    keyID: `${certificate.type} ${certificate.serialNumber}`
  })
  certificate.signature = Utils.toHex(signature)
}
