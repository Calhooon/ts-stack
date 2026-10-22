import { describe, expect, it } from '@jest/globals'
import { ColorSettler, type ColorSettlerDeps } from '../settle.js'

/** Exposes the ordered, dispose-aware loop the settle steps run through. */
class ProbeSettler extends ColorSettler {
  async probe<T>(items: Iterable<T>, step: (item: T) => Promise<void>): Promise<boolean> {
    return await this.eachWhileLive(items, step)
  }
}

const settler = (): ProbeSettler => new ProbeSettler({} as unknown as ColorSettlerDeps)

describe('ColorSettler.eachWhileLive', () => {
  it('runs every step in order while live and reports no stop', async () => {
    const seen: number[] = []
    const stopped = await settler().probe([1, 2, 3], async item => {
      await Promise.resolve()
      seen.push(item)
    })
    expect(stopped).toBe(false)
    expect(seen).toEqual([1, 2, 3])
  })

  it('stops before the next step once disposed, as a loop returning on dispose would', async () => {
    const s = settler()
    const seen: number[] = []
    const stopped = await s.probe([1, 2, 3], async item => {
      seen.push(item)
      if (item === 2) s.dispose()
    })
    expect(stopped).toBe(true)
    expect(seen).toEqual([1, 2])
  })

  it('reports no stop when disposal comes during the last step', async () => {
    const s = settler()
    const stopped = await s.probe([1], async () => {
      s.dispose()
    })
    expect(stopped).toBe(false)
  })
})
