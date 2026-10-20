import { once } from 'node:events'
import { createServer, type AddressInfo } from 'node:net'
import { MongoMemoryReplSet, MongoMemoryServer } from 'mongodb-memory-server'
import { createMongoReplicaFixture, type MongoReplicaFixture } from './MongoReplicaFixture.js'

test('a real startup port collision recovers all three members without stopping the port owner', async () => {
  const listener = createServer(socket => socket.destroy())
  listener.listen(0, '127.0.0.1')
  await once(listener, 'listening')
  const port = (listener.address() as AddressInfo).port
  // Fault injection changes only the first free-port probe. Actual mongod must
  // report the bind collision; later probes and all three members remain real.
  const ports = jest
    .spyOn(
      MongoMemoryServer.prototype as unknown as {
        getNewPort: (port?: number) => Promise<number>
      },
      'getNewPort'
    )
    .mockImplementationOnce(async () => port)
  let fixture: MongoReplicaFixture | undefined
  try {
    fixture = await createMongoReplicaFixture()
    expect(ports.mock.calls.length).toBeGreaterThanOrEqual(6)
    expect(listener.listening).toBe(true)
    expect((listener.address() as AddressInfo).port).toBe(port)
    expect(fixture.replicaSet.servers).toHaveLength(3)
    const status = await fixture.db.admin().command({ replSetGetStatus: 1 })
    expect(status.members).toHaveLength(3)
    for (const server of fixture.replicaSet.servers) {
      const info = server.instanceInfo
      if (info === undefined) throw new Error('Recovered replica member has no actual instance')
      expect(info.port).not.toBe(port)
      const member = await fixture.connect(
        { directConnection: true },
        `mongodb://127.0.0.1:${info.port}`
      )
      expect((await member.db('admin').command({ ping: 1 })).ok).toBe(1)
    }
  } finally {
    ports.mockRestore()
    try {
      await fixture?.close()
    } finally {
      await new Promise<void>((resolve, reject) => {
        listener.close(error => (error ? reject(error) : resolve()))
      })
    }
  }
}, 120000)

// This unit exercises only failed startup scheduling. The preceding integration
// case retains the genuine MongoDB processes, bind collision and all oracles.
test('pending member starts drain before inherited automatic replica cleanup', async () => {
  let releaseSiblings!: () => void
  let allStarted!: () => void
  const siblings = new Promise<void>(resolve => {
    releaseSiblings = resolve
  })
  const scheduled = new Promise<void>(resolve => {
    allStarted = resolve
  })
  const failure = new Error('Intentional failed startup scheduling unit')
  const starts = jest
    .spyOn(MongoMemoryServer.prototype, 'start')
    .mockRejectedValueOnce(failure)
    .mockImplementation(async () => {
      await siblings
    })
  const stops = jest.spyOn(MongoMemoryReplSet.prototype, 'stop').mockResolvedValue(true)
  type Initialization = {
    initAllServers: () => Promise<void>
    _initServer: (options: { port: number }) => MongoMemoryServer
  }
  const initialize = jest
    .spyOn(MongoMemoryReplSet.prototype as unknown as Initialization, 'initAllServers')
    .mockImplementation(async function (this: MongoMemoryReplSet & Initialization) {
      const members = [0, 1, 2].map(() => this._initServer({ port: 0 }))
      this.servers.push(...members)
      const pending = members.map(server => server.start())
      allStarted()
      await Promise.all(pending)
    })
  const outcome = createMongoReplicaFixture().then(
    () => ({ kind: 'unexpected success' }),
    error => ({ kind: 'failure', error })
  )
  try {
    await scheduled
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(starts).toHaveBeenCalledTimes(3)
    expect(stops).not.toHaveBeenCalled()
    releaseSiblings()
    expect(await outcome).toEqual({ kind: 'failure', error: failure })
    expect(stops).toHaveBeenCalled()
  } finally {
    releaseSiblings()
    await outcome
    initialize.mockRestore()
    starts.mockRestore()
    stops.mockRestore()
  }
})
