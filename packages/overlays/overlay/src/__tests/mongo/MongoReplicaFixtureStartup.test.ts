import { once } from 'node:events'
import { createServer, type AddressInfo } from 'node:net'
import { MongoMemoryServer } from 'mongodb-memory-server'
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
