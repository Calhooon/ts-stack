import { jest } from '@jest/globals'

import { Peer } from '../Peer.js'
import { AuthMessage, Transport } from '../types.js'
import { PrivateKey } from '../../primitives/index.js'
import { CompletedProtoWallet } from '../certificates/__tests/CompletedProtoWallet.js'
import { SessionManager } from '../SessionManager.js'
import { ProtoWallet } from '../../wallet/ProtoWallet.js'

describe('Peer handshake callback boundary', () => {
  test('registers and cleans the initial-response waiter around a synchronous send failure', async () => {
    let peer: Peer
    const transport: Transport = {
      async send(message) {
        if (message.messageType === 'initialRequest') {
          expect((peer as any).onInitialResponseReceivedCallbacks.size).toBe(2)
          throw new Error('synchronous transport failure')
        }
      },
      async onData(_callback: (message: AuthMessage) => Promise<void>) {}
    }
    peer = new Peer(new CompletedProtoWallet(new PrivateKey(30)), transport)
    await peer.ready
    void (peer as any).waitForInitialResponse('unrelated-session')

    await expect(
      peer.getAuthenticatedSession(new PrivateKey(31).toPublicKey().toString())
    ).rejects.toThrow('synchronous transport failure')
    expect((peer as any).onInitialResponseReceivedCallbacks.size).toBe(1)
    expect(
      Array.from((peer as any).onInitialResponseReceivedCallbacks.values())[0].sessionNonce
    ).toBe('unrelated-session')
    ;(peer as any).stopListeningForInitialResponsesByNonce('unrelated-session')
    expect((peer as any).onInitialResponseReceivedCallbacks.size).toBe(0)
  })

  test('does not leak a waiter when transport send rejects asynchronously', async () => {
    const transport: Transport = {
      send: jest.fn(async () => await Promise.reject(new Error('asynchronous transport failure'))),
      async onData(_callback: (message: AuthMessage) => Promise<void>) {}
    }
    const peer = new Peer(new CompletedProtoWallet(new PrivateKey(32)), transport)
    await peer.ready

    await expect(
      peer.getAuthenticatedSession(new PrivateKey(33).toPublicKey().toString())
    ).rejects.toThrow('asynchronous transport failure')
    expect((peer as any).onInitialResponseReceivedCallbacks.size).toBe(0)
  })

  test('removes the exact failed session after the initial send rejects', async () => {
    const failure = new Error('transport failed after session allocation')
    const transport: Transport = {
      async send() {
        throw failure
      },
      async onData(_callback: (message: AuthMessage) => Promise<void>) {}
    }
    const sessions = new SessionManager()
    const removeSession = jest.spyOn(sessions, 'removeSession')
    const peer = new Peer(
      new CompletedProtoWallet(new PrivateKey(34)),
      transport,
      undefined,
      sessions
    )
    await peer.ready

    await expect(
      peer.getAuthenticatedSession(new PrivateKey(35).toPublicKey().toString())
    ).rejects.toBe(failure)
    expect(removeSession).toHaveBeenCalledTimes(1)
    expect(removeSession.mock.calls[0]![0]).toMatchObject({ isAuthenticated: false })
  })

  test('does not remove an absent failed session', async () => {
    const removeSession = jest.fn(async () => {})
    const sessions = {
      addSession: jest.fn(async () => {}),
      updateSession: jest.fn(async () => {}),
      getSession: jest.fn(async () => undefined),
      removeSession,
      hasSession: jest.fn(async () => false),
      claimMessageNonce: jest.fn(async () => true),
      claimInitialRequestNonce: jest.fn(async () => true)
    }
    const transport: Transport = {
      async send() {
        throw new Error('transport failed without persisted session')
      },
      async onData(_callback: (message: AuthMessage) => Promise<void>) {}
    }
    const peer = new Peer(
      new CompletedProtoWallet(new PrivateKey(36)),
      transport,
      undefined,
      sessions
    )
    await peer.ready

    await expect(
      peer.getAuthenticatedSession(new PrivateKey(37).toPublicKey().toString())
    ).rejects.toThrow('transport failed without persisted session')
    expect(removeSession).not.toHaveBeenCalled()
  })
})

describe('Peer per-message cancellation boundary', () => {
  function setup(): {
    peer: Peer
    wallet: ProtoWallet
    transport: Transport
    identityKey: string
  } {
    const identityKey = new PrivateKey(41).toPublicKey().toString()
    const sessions = new SessionManager()
    sessions.addSession({
      sessionNonce: 'local-session',
      peerNonce: 'remote-session',
      peerIdentityKey: identityKey,
      isAuthenticated: true,
      lastUpdate: Date.now()
    })
    const transport: Transport = {
      send: jest.fn(async () => {}),
      async onData(_callback: (message: AuthMessage) => Promise<void>) {}
    }
    const wallet = new ProtoWallet(new PrivateKey(40))
    const peer = new Peer(wallet, transport, undefined, sessions)
    return { peer, wallet, transport, identityKey }
  }

  test('an already-aborted call does not start authentication or signing', async () => {
    const { peer, wallet, transport, identityKey } = setup()
    await peer.ready
    const authenticate = jest.spyOn(peer, 'getAuthenticatedSession')
    const sign = jest.spyOn(wallet, 'createSignature')
    const controller = new AbortController()
    const reason = new Error('cancelled before authentication')
    controller.abort(reason)
    await expect(peer.toPeer([1], identityKey, { signal: controller.signal })).rejects.toBe(reason)
    expect(authenticate).not.toHaveBeenCalled()
    expect(sign).not.toHaveBeenCalled()
    expect(transport.send).not.toHaveBeenCalled()
  })

  test.each([new Error('cancelled at dispatch'), 'custom abort reason'])(
    'a synchronous onSend abort prevents dispatch and preserves reason %p',
    async reason => {
      const { peer, transport, identityKey } = setup()
      await peer.ready
      const controller = new AbortController()
      const onSend = jest.fn(() => controller.abort(reason))
      await expect(
        peer.toPeer([1], identityKey, { signal: controller.signal, onSend })
      ).rejects.toBe(reason)
      expect(onSend).toHaveBeenCalledTimes(1)
      expect(transport.send).not.toHaveBeenCalled()
    }
  )

  test('two-argument calls and calls with a live signal keep normal transport behavior', async () => {
    const { peer, transport, identityKey } = setup()
    await peer.ready
    await peer.toPeer([1], identityKey)
    const onSend = jest.fn(() => {
      expect(transport.send).toHaveBeenCalledTimes(1)
    })
    await peer.toPeer([2], identityKey, { signal: new AbortController().signal, onSend })
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(transport.send).toHaveBeenCalledTimes(2)
    expect(transport.send).toHaveBeenNthCalledWith(1, expect.objectContaining({ payload: [1] }))
    expect(transport.send).toHaveBeenNthCalledWith(2, expect.objectContaining({ payload: [2] }))
  })

  test('an onSend exception prevents dispatch and preserves the error', async () => {
    const { peer, transport, identityKey } = setup()
    await peer.ready
    const reason = new Error('dispatch observer failed')
    await expect(
      peer.toPeer([1], identityKey, {
        onSend: () => {
          throw reason
        }
      })
    ).rejects.toBe(reason)
    expect(transport.send).not.toHaveBeenCalled()
  })

  test('aborting after transport dispatch does not cancel an in-flight send', async () => {
    const { peer, transport, identityKey } = setup()
    await peer.ready
    let finish!: () => void
    let dispatched!: () => void
    const started = new Promise<void>(resolve => {
      dispatched = resolve
    })
    const sending = new Promise<void>(resolve => {
      finish = resolve
    })
    jest.spyOn(transport, 'send').mockImplementation(async () => {
      dispatched()
      await sending
    })
    const controller = new AbortController()
    const pending = peer.toPeer([1], identityKey, { signal: controller.signal })
    await started
    controller.abort(new Error('cancelled after dispatch'))
    finish()
    await expect(pending).resolves.toBeUndefined()
    expect(transport.send).toHaveBeenCalledTimes(1)
  })
})

test.each([0, -1, 1.5, NaN, Infinity, 2_147_483_648, null])(
  'rejects invalid authentication timeout %s before registering the transport',
  timeout => {
    const transport: Transport = { send: jest.fn(), onData: jest.fn() } as Transport
    expect(
      () =>
        new Peer({} as never, transport, undefined, undefined, undefined, undefined, {
          authenticationTimeoutMs: timeout as number
        })
    ).toThrow('authenticationTimeoutMs must be a positive integer no greater than 2147483647')
    expect(transport.onData).not.toHaveBeenCalled()
  }
)
