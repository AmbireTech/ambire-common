import { Storage } from 'interfaces/storage'
import { HUMANIZER_META_KEY, integrateFragments } from './utils'
import { HumanizerFragment, HumanizerMeta } from './interfaces'
// @TODO to more usable place
const EMPTY_HUMANIZER_META = { abis: { NO_ABI: {} }, knownAddresses: {} }
let memoryHumanizerMeta: HumanizerMeta = EMPTY_HUMANIZER_META
const LAZY_STORE_DELAY = 1000
let hasTimeout = false

export async function lazyReadHumanizerMeta(
  storage: Storage,
  options?: any
): Promise<HumanizerMeta> {
  if (options.nocache)
    memoryHumanizerMeta = await storage.get(HUMANIZER_META_KEY, EMPTY_HUMANIZER_META)
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
