import { Storage } from 'interfaces/storage'
import { HUMANIZER_META_KEY, integrateFragments } from './utils'
import { HumanizerFragment, HumanizerMeta } from './interfaces'
// @TODO to more usable place
const EMPTY_HUMANIZER_META = { abis: { NO_ABI: {} }, knownAddresses: {} }
const LAZY_STORE_DELAY = 1 * 1000
const LAZY_READ_DELAY = 30 * 1000

let memoryHumanizerMeta: HumanizerMeta = EMPTY_HUMANIZER_META
let hasTimeout = false
let lastTimeRead = 0

export async function lazyReadHumanizerMeta(
  storage: Storage,
  options?: { nocache?: boolean }
): Promise<HumanizerMeta> {
  if (Date.now() - lastTimeRead > LAZY_READ_DELAY || options?.nocache) {
    memoryHumanizerMeta = await storage.get(HUMANIZER_META_KEY, EMPTY_HUMANIZER_META)
    lastTimeRead = Date.now()
  }
  return memoryHumanizerMeta
}

export async function addFragsToLazyStore(
  storage: Storage,
  frags: HumanizerFragment[],
  options?: any
): Promise<void> {
  if (!frags.length) return
  memoryHumanizerMeta = integrateFragments(memoryHumanizerMeta, frags)
  if (options.urgent) {
    await storage.set(HUMANIZER_META_KEY, memoryHumanizerMeta)
  } else if (!hasTimeout) {
    hasTimeout = true
    // @TODO should we clear this?
    setTimeout(async () => {
      // memoryHumanizerMeta is reference to the variables value,
      // when the timeout executes it will use the latest value
      await storage.set(HUMANIZER_META_KEY, memoryHumanizerMeta)
      hasTimeout = false
    }, LAZY_STORE_DELAY)
  }
}
