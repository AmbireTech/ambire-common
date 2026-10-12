import { ERC7730_DESCRIPTOR_WAIT_MS } from '@/libs/humanizer/erc7730/consts'

import EventEmitter from '../eventEmitter/eventEmitter'

type DescriptorFirstHumanizationOptions<T> = {
  humanizationId: number
  fetchDescriptor: () => Promise<T>
  applyDescriptorHumanization: (descriptor: T, humanizationId: number) => boolean
  applyFallbackHumanization: (humanizationId: number) => boolean
}

export default abstract class HumanizationController extends EventEmitter {
  #humanizationSeq = 0

  #fallbackTimeout?: ReturnType<typeof setTimeout>

  protected createHumanizationId() {
    this.#humanizationSeq += 1

    return this.#humanizationSeq
  }

  protected isCurrentHumanization(humanizationId: number) {
    return this.#humanizationSeq === humanizationId
  }

  /**
   * Makes every humanization still in progress stale, so none of them is applied, and clears the
   * pending fallback. For a controller that is being destroyed.
   */
  protected stopHumanization() {
    this.#humanizationSeq += 1
    clearTimeout(this.#fallbackTimeout)
    this.#fallbackTimeout = undefined
  }

  protected startHumanization(onStart: (humanizationId: number) => void) {
    const humanizationId = this.createHumanizationId()

    onStart(humanizationId)
    this.emitUpdate()

    return humanizationId
  }

  #clearFallbackTimeout(fallbackTimeout: ReturnType<typeof setTimeout>) {
    clearTimeout(fallbackTimeout)
    if (this.#fallbackTimeout === fallbackTimeout) this.#fallbackTimeout = undefined
  }

  protected async applyDescriptorFirstHumanization<T>({
    humanizationId,
    fetchDescriptor,
    applyDescriptorHumanization,
    applyFallbackHumanization
  }: DescriptorFirstHumanizationOptions<T>) {
    let hasResolvedBeforeFallback = false
    let hasDisplayedFallback = false

    // Only the latest humanization can be applied, so an older pending fallback is cleared
    clearTimeout(this.#fallbackTimeout)
    const fallbackTimeout = setTimeout(() => {
      this.#clearFallbackTimeout(fallbackTimeout)
      if (hasResolvedBeforeFallback || !this.isCurrentHumanization(humanizationId)) return

      hasDisplayedFallback = applyFallbackHumanization(humanizationId)
    }, ERC7730_DESCRIPTOR_WAIT_MS)
    this.#fallbackTimeout = fallbackTimeout

    try {
      const descriptor = await fetchDescriptor()
      hasResolvedBeforeFallback = true
      this.#clearFallbackTimeout(fallbackTimeout)

      if (
        this.isCurrentHumanization(humanizationId) &&
        applyDescriptorHumanization(descriptor, humanizationId)
      ) {
        return
      }

      if (!hasDisplayedFallback) applyFallbackHumanization(humanizationId)
    } catch (error) {
      console.error(error)
      hasResolvedBeforeFallback = true
      this.#clearFallbackTimeout(fallbackTimeout)
      if (!hasDisplayedFallback) applyFallbackHumanization(humanizationId)
    }
  }
}
