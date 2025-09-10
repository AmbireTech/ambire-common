import { getAddress, isAddress } from 'ethers'

import { IContractNamesController } from '../../interfaces/contractNames'
import { Fetch } from '../../interfaces/fetch'
import wait from '../../utils/wait'
import EventEmitter from '../eventEmitter/eventEmitter'

interface ContractNames {
  [address: string]: {
    address: string
    name?: string
    error?: string
    updatedAt: Date
  }
}
interface ContractNamesRelayerResponse {
  contracts: {
    [address: string]: {
      address: string
      name: string
    }
  }
}
// 60 minutes
export const PERSIST_FAILED_IN_MS = 1000 * 60 * 60

/**
 * Contract Names controller- responsible for handling the lookup of address names.
 * Resolved names are saved in `contractNames` permanently, unless the lookup failed, then new
 * attempt will be made only after PERSIST_FAILED_IN_MS to avoid unnecessary lookups.
 */
export class ContractNamesController extends EventEmitter implements IContractNamesController {
  #debounceTime: number

  #fetch: Fetch

  #lastTimeScheduledFetch: number = 0

  #fetchPromise: Promise<void> | null

  contractNames: ContractNames = {}

  loadingAddresses: { address: string; chainId: bigint }[] = []

  constructor(fetch: Fetch, debounceTime: number = 50) {
    super()
    this.#fetch = fetch
    this.#debounceTime = debounceTime
    this.#fetchPromise = null
  }

  async #batchFetchNames(): Promise<void> {
    // using a second variable to avoid race conditions in `loadingAddresses`
    const addressesToFetch = this.loadingAddresses
    this.loadingAddresses = []

    const url = `https://cena.ambire.com/api/v3/contracts/multiple?addresses=${addressesToFetch.map(
      ({ address }) => address
    )}&chainIds=${addressesToFetch.map(({ chainId }) => chainId)}`

    const res: ContractNamesRelayerResponse = await this.#fetch(url).then((r) => r.json())

    addressesToFetch.forEach(({ address }) => {
      const foundData = res.contracts?.[address]
      this.contractNames[address] = foundData?.name
        ? { address, name: foundData.name, updatedAt: new Date() }
        : { address, error: 'Contract name not found', updatedAt: new Date() }
    })

    this.emitUpdate()
  }

  getName(_address: string, chainId: bigint) {
    if (!isAddress(_address))
      return this.emitError({
        message: 'Non address passed to ContractNamesController.getName',
        level: 'silent',
        sendCrashReport: true,
        error: new Error(
          `Non-address passed to ContractNamesController.getName: ${_address}, ${chainId}`
        )
      })
    const address = getAddress(_address)
    // if we already hav have the name, do not fetch again
    if (this.contractNames[address]?.name) return

    // if we have recent data, do not fetch
    if (
      this.contractNames[address]?.updatedAt &&
      this.contractNames[address].updatedAt.getTime() + PERSIST_FAILED_IN_MS < new Date().getTime()
    )
      return

    // if address-chain pair is already loading, do not add it
    if (
      this.loadingAddresses.some(
        (existing) => existing.address === address && existing.chainId === chainId
      )
    )
      return
    this.loadingAddresses.push({ address, chainId })

    // if we already have recent fetch, do not add new one
    if (
      new Date().getTime() - this.#lastTimeScheduledFetch > this.#debounceTime ||
      !this.#fetchPromise
    ) {
      this.#lastTimeScheduledFetch = new Date().getTime()
      this.#fetchPromise = wait(this.#debounceTime)
        .then(() => this.#batchFetchNames())
        .catch((e) => {
          this.emitError({
            message: 'Failed to fetch address name',
            level: 'silent',
            sendCrashReport: true,
            error: e
          })
        })
    }

    this.emitUpdate()
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
