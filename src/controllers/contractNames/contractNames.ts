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
    name?: string
    error?: string
    updatedAt: Date
    retryAfter: number
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
// 60 minutes
export const PERSIST_NOT_FOUND_IN_MS = 1000 * 60 * 60

// 2 minutes
export const PERSIST_FAILED_IN_MS = 1000 * 60 * 2

export function isUnderstandableName(name: string): boolean {
  const forbiddenWords = ['Ambire', 'Identity', 'Safe', 'Proxy', 'Diamond']
  if (name.endsWith('able')) return false
  if (forbiddenWords.some((fw) => name.toLowerCase().includes(fw.toLowerCase()))) return false
  return true
}

/**
 * Contract Names controller- responsible for handling the lookup of address names.
 * Resolved names are saved in `contractNames` permanently, unless the lookup failed, then new
 * attempt will be made only after PERSIST_NOT_FOUND_IN_MS to avoid unnecessary lookups.
 */
export class ContractNamesController extends EventEmitter implements IContractNamesController {
  #debounceTime: number

  #fetch: Fetch

  #lastTimeScheduledFetch: number = 0

  #contractNames: ContractNames = {}

  loadingAddresses: { address: string; chainId: bigint }[] = []

  constructor(fetch: Fetch, debounceTime: number = 50) {
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

  async #batchFetchNames(): Promise<void> {
    // using a second variable to avoid race conditions in `loadingAddresses`
    const addressesToFetch = this.loadingAddresses
    this.loadingAddresses = []

    const url = `https://cena.ambire.com/api/v3/contracts/multiple?addresses=${addressesToFetch.map(
      ({ address }) => address
    )}&chainIds=${addressesToFetch.map(({ chainId }) => chainId)}`

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
        addressesToFetch.forEach(({ address }) => {
          this.#contractNames[address] = {
            address,
            error: 'Request to relayer failed',
            updatedAt: new Date(),
            retryAfter: PERSIST_FAILED_IN_MS
          }
        })
        // this is just to keep the type safety in case of changes
        return { error: e.message }
      })
    if (failed) return this.emitUpdate()

    if ('error' in res) {
      this.emitError({
        message: 'Failed to get names of addresses because the request to the relayer failed.',
        level: 'silent',
        sendCrashReport: true,
        error: new Error(res.error)
      })
      addressesToFetch.forEach(({ address }) => {
        this.#contractNames[address] = {
          address,
          error: 'Request to relayer failed',
          updatedAt: new Date(),
          retryAfter: PERSIST_FAILED_IN_MS
        }
      })
      return this.emitUpdate()
    }

    addressesToFetch.forEach(({ address }) => {
      const foundData = res.contracts?.[address]
      this.#contractNames[address] = foundData?.name
        ? { address, name: foundData.name, updatedAt: new Date(), retryAfter: Infinity }
        : {
            address,
            error: 'Contract name not found',
            updatedAt: new Date(),
            retryAfter: PERSIST_NOT_FOUND_IN_MS
          }
    })

    return this.emitUpdate()
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
    if (this.#contractNames[address]?.name) return

    // if we have recent data, do not fetch
    if (
      this.#contractNames[address]?.updatedAt &&
      this.#contractNames[address].updatedAt.getTime() + this.#contractNames[address].retryAfter <
        new Date().getTime()
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
    if (new Date().getTime() - this.#lastTimeScheduledFetch >= this.#debounceTime) {
      this.#lastTimeScheduledFetch = new Date().getTime()
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

    this.emitUpdate()
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
