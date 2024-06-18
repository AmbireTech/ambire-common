import humanizerInfo from '../../consts/humanizer/humanizerInfo.json'
import { HumanizerFragment } from '../../interfaces/humanizer'
import { Storage } from '../../interfaces/storage'
import { HumanizerMeta } from './interfaces'
import { EMPTY_HUMANIZER_META, HUMANIZER_META_KEY, integrateFragments } from './utils'

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
    memoryHumanizerMeta = await storage.get(HUMANIZER_META_KEY, humanizerInfo)
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
  if (!memoryHumanizerMeta) await lazyReadHumanizerMeta(storage, { nocache: true })
  memoryHumanizerMeta = integrateFragments(memoryHumanizerMeta, frags)
  if (options?.urgent) {
    await storage.set(HUMANIZER_META_KEY, memoryHumanizerMeta)
  } else if (!hasTimeout) {
    hasTimeout = true
    // @TODO should we clear this?
    return new Promise((resolve) => {
      setTimeout(async () => {
        // memoryHumanizerMeta is reference to the variables value,
        // when the timeout executes it will use the latest value
        await storage.set(HUMANIZER_META_KEY, memoryHumanizerMeta)
        hasTimeout = false
        resolve()
      }, LAZY_STORE_DELAY)
    })
  }
}
