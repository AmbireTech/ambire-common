import { getAddress, isAddress } from 'ethers'

import { IContractNamesController } from '../../interfaces/contractNames'
import { Fetch } from '../../interfaces/fetch'
import wait from '../../utils/wait'
import EventEmitter from '../eventEmitter/eventEmitter'

// contract names, originally, are fetched from the contract code onchain
// for a contract to have the same address on multiple chains it must also have the same code
// and same name, thats why we do not need to store the chain on which the contract name was
// found. Nevertheless, we send the chainId to the relayer because it need it find the chain
// on which the contract is actually deployed to get the name
interface ContractNames {
  [address: string]: {
    address: string
    name: string | null
    isLoading: boolean
    updatedAt?: number
    retryAfter?: number
    error?: string
  }
}
type ContractNamesRelayerResponse =
  | {
      contracts: {
        [address: string]: {
          address: string
          name: string
        }
      }
    }
  | { error: string }

export const PERSIST_NOT_FOUND_IN_MS = 1000 * 60 * 60 // 60 minutes
export const PERSIST_FAILED_IN_MS = 1000 * 60 * 2 // 2 minutes

export function isUnderstandableName(name: string): boolean {
  const forbiddenWords = ['Ambire', 'Identity', 'Safe', 'Proxy', 'Diamond']
  if (name.endsWith('able')) return false
  if (forbiddenWords.some((fw) => name.toLowerCase().includes(fw.toLowerCase()))) return false
  return true
}

/**
 * Contract Names controller - responsible for handling the lookup of address names.
 * Resolved names are saved in `contractNames` permanently, unless the lookup failed, then new
 * attempt will be made only after PERSIST_NOT_FOUND_IN_MS to avoid unnecessary lookups.
 */
export class ContractNamesController extends EventEmitter implements IContractNamesController {
  #debounceTime: number

  #fetch: Fetch

  #lastTimeScheduledFetch: number = 0

  #contractNames: ContractNames = {}

  #contractsPendingToBeFetched: { address: string; chainId: bigint }[] = []

  constructor(fetch: Fetch, debounceTime: number = 100) {
    super()
    this.#fetch = fetch
    this.#debounceTime = debounceTime
  }

  get contractNames(): ContractNames {
    const toReturn = Object.entries(this.#contractNames).map(([address, v]) => {
      if (!v.name) return [address, v]
      if (isUnderstandableName(v.name)) return [address, v]
      return [address, { ...v, name: undefined }]
    })
    return Object.fromEntries(toReturn)
  }

  get contractsPendingToBeFetched(): { address: string; chainId: bigint }[] {
    return this.#contractsPendingToBeFetched
  }

  async #batchFetchNames(): Promise<void> {
    // using a second variable to avoid race conditions in `contractsPendingToBeFetched`
    const contractsToFetch = this.#contractsPendingToBeFetched
    this.#contractsPendingToBeFetched = []
    this.emitUpdate()

    const url = `https://cena.ambire.com/api/v3/contracts/multiple?addresses=${contractsToFetch.map(
      ({ address }) => address
    )}&chainIds=${contractsToFetch.map(({ chainId }) => chainId)}`

    let failed = false
    const res: ContractNamesRelayerResponse = await this.#fetch(url)
      .then((r) => r.json())
      .catch((e: any) => {
        failed = true
        this.emitError({
          message: 'Failed to get names of addresses because the request to the relayer failed.',
          level: 'silent',
          sendCrashReport: true,
          error: e
        })
        contractsToFetch.forEach(({ address }) => {
          this.#contractNames[address] = {
            address,
            name: null,
            error: 'Request to relayer failed',
            isLoading: false,
            updatedAt: Date.now(),
            retryAfter: PERSIST_FAILED_IN_MS
          }
        })
        // this is just to keep the type safety in case of changes
        return { error: e.message }
      })
    if (failed) {
      this.emitUpdate()
      return
    }

    if ('error' in res) {
      this.emitError({
        message: 'Failed to get names of addresses because the request to the relayer failed.',
        level: 'silent',
        sendCrashReport: true,
        error: new Error(res.error)
      })
      contractsToFetch.forEach(({ address }) => {
        this.#contractNames[address] = {
          address,
          name: null,
          error: 'Request to relayer failed',
          isLoading: false,
          updatedAt: Date.now(),
          retryAfter: PERSIST_FAILED_IN_MS
        }
      })
      this.emitUpdate()
      return
    }

    contractsToFetch.forEach(({ address }) => {
      const foundData = res.contracts?.[address]
      this.#contractNames[address] = foundData?.name
        ? {
            address,
            name: foundData.name,
            isLoading: false,
            updatedAt: Date.now()
          }
        : {
            address,
            name: null,
            error: 'Contract name not found',
            isLoading: false,
            updatedAt: Date.now(),
            retryAfter: PERSIST_NOT_FOUND_IN_MS
          }
    })

    this.emitUpdate()
  }

  #shouldSkipGetName(address: string, chainId: bigint): boolean {
    const entry = this.#contractNames[address]
    if (!entry) return false
    if (entry.name) return true
    if (entry.isLoading) return true
    if (
      this.#contractsPendingToBeFetched.some((p) => p.address === address && p.chainId === chainId)
    ) {
      return true
    }
    if (entry.updatedAt && entry.retryAfter) {
      const nextAllowedFetch = entry.updatedAt + entry.retryAfter
      if (Date.now() < nextAllowedFetch) return true
    }
    return false
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

    if (this.#shouldSkipGetName(address, chainId)) return

    this.#contractsPendingToBeFetched.push({ address, chainId })
    if (this.#contractNames[address]) {
      this.#contractNames[address].isLoading = true
    } else {
      this.#contractNames[address] = { address, name: null, isLoading: true }
    }

    // if we already have recent fetch, do not add new one
    if (Date.now() - this.#lastTimeScheduledFetch < this.#debounceTime) return

    this.#lastTimeScheduledFetch = Date.now()

    wait(this.#debounceTime)
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

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      contractNames: this.contractNames
    }
  }
}
