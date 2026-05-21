import { getAddress } from 'ethers'

import { geckoIdMapper } from '../../consts/coingecko'
import { Fetch } from '../../interfaces/fetch'
import { Network } from '../../interfaces/network'
import { fetchWithTimeout } from '../../utils/fetch'
import { paginate } from '../portfolio/pagination'

const CENA_API_URL = 'https://cena.ambire.com'
const BATCH_LIMIT = 40
const DEFAULT_TIMEOUT = 4500
const BASE_CURRENCY = 'usd'

type CenaPriceData = Record<string, number>
type CenaPriceResponse = Record<string, CenaPriceData | undefined>

type ScamFilterOptions = {
  fetch: Fetch
  network: Network
  timeout?: number
}

type TokenPriceCheck = {
  originalAddress: string
  normalizedAddress: string
  geckoId: string | null
}

const dedup = <T>(values: T[]): T[] =>
  values.filter((value, index) => values.indexOf(value) === index)

const hasPrice = (priceData: CenaPriceData | undefined) =>
  typeof priceData?.[BASE_CURRENCY] === 'number' && priceData[BASE_CURRENCY] > 0

export class ScamFilter {
  #fetch: Fetch

  #network: Network

  #timeout: number

  constructor({ fetch, network, timeout = DEFAULT_TIMEOUT }: ScamFilterOptions) {
    this.#fetch = fetch
    this.#network = network
    this.#timeout = timeout
  }

  async #fetchCenaPriceResponse(url: string): Promise<CenaPriceResponse> {
    const response = await fetchWithTimeout(this.#fetch, url, {}, this.#timeout)
    const body = await response.json()

    if (response.status !== 200) throw body
    if (Object.prototype.hasOwnProperty.call(body, 'message')) throw body
    if (Object.prototype.hasOwnProperty.call(body, 'error')) throw body

    return body
  }

  async #getPricedContractAddresses(tokenAddresses: string[]): Promise<Set<string>> {
    if (!this.#network.platformId || !tokenAddresses.length) return new Set()

    const pricedAddresses = new Set<string>()
    const pages = paginate(dedup(tokenAddresses), BATCH_LIMIT)

    await Promise.all(
      pages.map(async (page) => {
        const url = `${CENA_API_URL}/api/v3/simple/token_price/${
          this.#network.platformId
        }?contract_addresses=${page.join('%2C')}&vs_currencies=${BASE_CURRENCY}`

        try {
          const body = await this.#fetchCenaPriceResponse(url)

          page.forEach((address) => {
            if (hasPrice(body[address.toLowerCase()])) pricedAddresses.add(address)
          })
        } catch {
          // If Cena cannot confirm a price exists, keep the token filtered out.
        }
      })
    )

    return pricedAddresses
  }

  async #getPricedGeckoIds(geckoIds: string[]): Promise<Set<string>> {
    if (!geckoIds.length) return new Set()

    const pricedGeckoIds = new Set<string>()
    const pages = paginate(dedup(geckoIds), BATCH_LIMIT)

    await Promise.all(
      pages.map(async (page) => {
        const url = `${CENA_API_URL}/api/v3/simple/price?ids=${page.join(
          '%2C'
        )}&vs_currencies=${BASE_CURRENCY}`

        try {
          const body = await this.#fetchCenaPriceResponse(url)

          page.forEach((geckoId) => {
            if (hasPrice(body[geckoId])) pricedGeckoIds.add(geckoId)
          })
        } catch {
          // If Cena cannot confirm a price exists, keep the token filtered out.
        }
      })
    )

    return pricedGeckoIds
  }

  async filterTokensWithoutAPrice(tokenAddresses: string[]): Promise<string[]> {
    const tokenPriceChecks = tokenAddresses.reduce<TokenPriceCheck[]>((acc, originalAddress) => {
      try {
        const normalizedAddress = getAddress(originalAddress)

        acc.push({
          originalAddress,
          normalizedAddress,
          geckoId: geckoIdMapper(normalizedAddress, this.#network)
        })
      } catch {
        // Invalid addresses do not have a Cena price.
      }

      return acc
    }, [])

    const geckoIds = tokenPriceChecks
      .map(({ geckoId }) => geckoId)
      .filter((geckoId): geckoId is string => !!geckoId)

    const contractAddresses = tokenPriceChecks
      .filter(({ geckoId }) => !geckoId)
      .map(({ normalizedAddress }) => normalizedAddress)

    const [pricedGeckoIds, pricedContractAddresses] = await Promise.all([
      this.#getPricedGeckoIds(geckoIds),
      this.#getPricedContractAddresses(contractAddresses)
    ])

    return tokenPriceChecks
      .filter(({ geckoId, normalizedAddress }) =>
        geckoId ? pricedGeckoIds.has(geckoId) : pricedContractAddresses.has(normalizedAddress)
      )
      .map(({ originalAddress }) => originalAddress)
  }
}
