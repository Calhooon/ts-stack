import { jest } from '@jest/globals'
import { AuthFetch } from '../AuthFetch.js'
import { Peer } from '../../Peer.js'
import { SimplifiedFetchTransportOptions } from '../../transports/SimplifiedFetchTransport.js'
import { AuthMessage, Transport } from '../../types.js'
import { ProtoWallet } from '../../../wallet/ProtoWallet.js'
import PrivateKey from '../../../primitives/PrivateKey.js'
import { Writer, toArray, toBase64, toHex } from '../../../primitives/utils.js'

class ServerTransport implements Transport {
  receive!: (message: AuthMessage) => Promise<void>
  respond!: (message: AuthMessage) => void

  async onData(callback: (message: AuthMessage) => Promise<void>): Promise<void> {
    this.receive = callback
  }

  async send(message: AuthMessage): Promise<void> {
    this.respond(message)
  }
}

function setup(transportOptions: SimplifiedFetchTransportOptions = {}): {
  client: AuthFetch
  wallet: ProtoWallet
  http: jest.MockedFunction<typeof fetch>
  requests: AuthMessage[]
  stall: (phase: 'handshake' | 'headers' | 'body') => void
  signals: AbortSignal[]
} {
  const serverTransport = new ServerTransport()
  const serverWallet = new ProtoWallet(new PrivateKey(41))
  const server = new Peer(serverWallet, serverTransport)
  const serializer = new AuthFetch(serverWallet)
  const requests: AuthMessage[] = []
  const signals: AbortSignal[] = []
  let stalled: string | undefined
  server.listenForGeneralMessages(async (sender, payload) => {
    requests.push({ payload } as AuthMessage)
    const writer = new Writer()
    writer.write(payload.slice(0, 32))
    writer.writeVarIntNum(200)
    writer.writeVarIntNum(0)
    writer.writeVarIntNum(-1)
    await server.toPeer(writer.toArray(), sender)
  })
  const http = jest.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    const handshake = url.pathname === '/.well-known/auth'
    signals.push(init!.signal as AbortSignal)
    if ((handshake && stalled === 'handshake') || (!handshake && stalled === 'headers')) {
      // Deliberately ignore abort: the transport must still settle its caller.
      return await new Promise<Response>(() => {})
    }
    let response!: Response
    serverTransport.respond = message => {
      if (handshake) {
        response = new Response(JSON.stringify(message))
      } else {
        response = new Response(
          stalled === 'body' ? new ReadableStream({ pull: () => new Promise(() => {}) }) : null,
          {
            headers: {
              'x-bsv-auth-version': message.version,
              'x-bsv-auth-identity-key': message.identityKey,
              'x-bsv-auth-nonce': message.nonce!,
              'x-bsv-auth-your-nonce': message.yourNonce!,
              'x-bsv-auth-request-id': toBase64(message.payload!.slice(0, 32)),
              'x-bsv-auth-signature': toHex(message.signature!)
            }
          }
        )
      }
    }
    if (handshake) {
      await serverTransport.receive(JSON.parse(String(init!.body)))
    } else {
      const headers = new Headers(init!.headers)
      const payload = await (serializer as any).serializeRequest(
        init!.method,
        {},
        undefined,
        url,
        toArray(headers.get('x-bsv-auth-request-id')!, 'base64')
      )
      await serverTransport.receive({
        version: headers.get('x-bsv-auth-version')!,
        messageType: 'general',
        identityKey: headers.get('x-bsv-auth-identity-key')!,
        nonce: headers.get('x-bsv-auth-nonce')!,
        yourNonce: headers.get('x-bsv-auth-your-nonce')!,
        payload: payload.toArray(),
        signature: toArray(headers.get('x-bsv-auth-signature')!, 'hex')
      })
    }
    return response
  })
  const wallet = new ProtoWallet(new PrivateKey(42))
  return {
    client: new AuthFetch(wallet, undefined, undefined, undefined, transportOptions, http),
    wallet,
    http,
    requests,
    signals,
    stall: phase => {
      stalled = phase
    }
  }
}

function hold(wallet: ProtoWallet, method: 'createSignature' | 'verifySignature'): () => void {
  let release!: () => void
  const approved = new Promise<void>(resolve => {
    release = resolve
  })
  const original = (wallet[method] as Function).bind(wallet)
  jest.spyOn(wallet, method).mockImplementationOnce(async (...args: any[]) => {
    await approved
    return await original(...args)
  })
  return release
}

beforeEach(() => jest.useFakeTimers())
afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

test.each(['createSignature', 'verifySignature'] as const)(
  'HTTP authentication allows a five-minute %s permission prompt',
  async method => {
    const { client, wallet, requests } = setup()
    const approve = hold(wallet, method)
    const pending = client.fetch('https://service.example/resource')
    await jest.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(requests).toHaveLength(0)
    approve()
    await jest.advanceTimersByTimeAsync(0)
    await expect(pending).resolves.toMatchObject({ status: 200 })
    expect(requests).toHaveLength(1)
    expect(jest.getTimerCount()).toBe(0)
  }
)

test.each(['handshake', 'headers', 'body'] as const)(
  'HTTP %s stalls still terminate after 30 seconds',
  async phase => {
    const { client, stall, signals } = setup()
    stall(phase)
    const pending = client.fetch('https://service.example/resource')
    const rejected = expect(pending).rejects.toMatchObject({
      message: 'Timed out waiting for authenticated response.',
      requestDispatched: phase !== 'handshake',
      cause: {
        code: 'ERR_AUTH_TRANSPORT_TIMEOUT',
        message: expect.stringContaining('timed out after 30000 milliseconds')
      }
    })
    await jest.advanceTimersByTimeAsync(30000)
    await rejected
    expect(signals.at(-1)!.aborted).toBe(true)
    expect((client as any).pendingRequestNonces.size).toBe(0)
    expect(jest.getTimerCount()).toBe(0)
  }
)

test('approval at the end of its window still gets a full network timeout', async () => {
  const { client, wallet, stall, signals } = setup()
  const approve = hold(wallet, 'createSignature')
  stall('headers')
  const pending = client.fetch('https://service.example/resource')
  const rejected = expect(pending).rejects.toMatchObject({
    message: 'Timed out waiting for authenticated response.',
    requestDispatched: true,
    cause: { code: 'ERR_AUTH_TRANSPORT_TIMEOUT' }
  })
  await jest.advanceTimersByTimeAsync(599999)
  approve()
  await jest.advanceTimersByTimeAsync(29999)
  expect(signals.at(-1)!.aborted).toBe(false)
  await jest.advanceTimersByTimeAsync(1)
  await rejected
  expect(signals.at(-1)!.aborted).toBe(true)
  expect(jest.getTimerCount()).toBe(0)
})

test('a pending certificate permission can take longer than 30 seconds', async () => {
  const { client } = setup()
  await client.fetch('https://service.example/warmup')
  const peer = client.peers['https://service.example']
  peer.pendingCertificateRequests.push(true)
  const pending = client.fetch('https://service.example/resource')
  await jest.advanceTimersByTimeAsync(5 * 60 * 1000)
  peer.pendingCertificateRequests.shift()
  await jest.advanceTimersByTimeAsync(100)
  await expect(pending).resolves.toMatchObject({ status: 200 })
  expect(jest.getTimerCount()).toBe(0)
})

test('response verification permissions also allow five minutes', async () => {
  const { client, wallet } = setup()
  await client.fetch('https://service.example/warmup')
  const approve = hold(wallet, 'verifySignature')
  const pending = client.fetch('https://service.example/resource')
  await jest.advanceTimersByTimeAsync(5 * 60 * 1000)
  expect((client as any).pendingRequestNonces.size).toBe(1)
  approve()
  await jest.advanceTimersByTimeAsync(0)
  await expect(pending).resolves.toMatchObject({ status: 200 })
  expect(jest.getTimerCount()).toBe(0)
})

test('an unanswered response verification prompt remains bounded', async () => {
  const { client, wallet } = setup()
  await client.fetch('https://service.example/warmup')
  const approve = hold(wallet, 'verifySignature')
  const pending = client.fetch('https://service.example/resource')
  const rejected = expect(pending).rejects.toMatchObject({
    message: 'Timed out waiting for authenticated response.',
    requestDispatched: true
  })
  await jest.advanceTimersByTimeAsync(600000)
  await rejected
  approve()
  await jest.advanceTimersByTimeAsync(0)
  expect((client as any).pendingRequestNonces.size).toBe(0)
  expect(jest.getTimerCount()).toBe(0)
})

test('expiry during handshake verification never produces an unhandled waiter rejection or dispatch', async () => {
  const { client, wallet, requests } = setup()
  const approve = hold(wallet, 'verifySignature')
  const pending = client.fetch('https://service.example/resource')
  const rejected = expect(pending).rejects.toMatchObject({
    message: 'Timed out waiting for authenticated response.',
    requestDispatched: false
  })
  await jest.advanceTimersByTimeAsync(600000)
  await rejected
  approve()
  await jest.advanceTimersByTimeAsync(0)
  expect(requests).toHaveLength(0)
  expect((client as any).pendingRequestNonces.size).toBe(0)
  expect(jest.getTimerCount()).toBe(0)
})

test('custom network deadlines remain independent of approval, including undefined processing options', async () => {
  const { client, wallet, stall, signals } = setup({
    requestTimeoutMs: 1000,
    responseProcessingTimeoutMs: undefined
  })
  const approve = hold(wallet, 'verifySignature')
  stall('headers')
  const pending = client.fetch('https://service.example/resource')
  const rejected = expect(pending).rejects.toMatchObject({
    message: 'Timed out waiting for authenticated response.',
    requestDispatched: true,
    cause: {
      code: 'ERR_AUTH_TRANSPORT_TIMEOUT',
      message: expect.stringContaining('after 1000 milliseconds')
    }
  })
  await jest.advanceTimersByTimeAsync(300000)
  approve()
  await jest.advanceTimersByTimeAsync(999)
  expect(signals.at(-1)!.aborted).toBe(false)
  await jest.advanceTimersByTimeAsync(1)
  await rejected
  expect(signals.at(-1)!.aborted).toBe(true)
  expect(jest.getTimerCount()).toBe(0)
})
