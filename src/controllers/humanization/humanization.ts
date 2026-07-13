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

  protected createHumanizationId() {
    this.#humanizationSeq += 1

    return this.#humanizationSeq
  }

  protected isCurrentHumanization(humanizationId: number) {
    return this.#humanizationSeq === humanizationId
  }

  protected startHumanization(onStart: (humanizationId: number) => void) {
    const humanizationId = this.createHumanizationId()

    onStart(humanizationId)
    this.emitUpdate()

    return humanizationId
  }

  protected async applyDescriptorFirstHumanization<T>({
    humanizationId,
    fetchDescriptor,
    applyDescriptorHumanization,
    applyFallbackHumanization
  }: DescriptorFirstHumanizationOptions<T>) {
    let hasResolvedBeforeFallback = false
    let hasDisplayedFallback = false

    const fallbackTimeout = setTimeout(() => {
      if (hasResolvedBeforeFallback || !this.isCurrentHumanization(humanizationId)) return

      hasDisplayedFallback = applyFallbackHumanization(humanizationId)
    }, ERC7730_DESCRIPTOR_WAIT_MS)

    try {
      const descriptor = await fetchDescriptor()
      hasResolvedBeforeFallback = true
      clearTimeout(fallbackTimeout)

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
      clearTimeout(fallbackTimeout)
      if (!hasDisplayedFallback) applyFallbackHumanization(humanizationId)
    }
  }
}
