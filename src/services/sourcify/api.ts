import { getAddress, isAddress } from 'ethers'

import { Fetch } from '../../interfaces/fetch'

export type SourcifyMatch = 'exact_match' | 'match' | null

export interface SourcifyMatchReference {
  start: number
  length: number
}

export interface SourcifyTransformation {
  id?: string
  type: string
  offset: number
  reason: string
}

export interface SourcifyBytecodeSection {
  onchainBytecode?: string
  recompiledBytecode?: string
  sourceMap?: string
  linkReferences?: Record<string, Record<string, SourcifyMatchReference[]>>
  cborAuxdata?: Record<string, { value: string; offset: number }>
  immutableReferences?: Record<string, SourcifyMatchReference[]>
  transformations?: SourcifyTransformation[]
  transformationValues?: Record<string, unknown>
}

export interface SourcifyDeployment {
  transactionHash?: string
  blockNumber?: string
  transactionIndex?: string
  deployer?: string
}

export interface SourcifySourceFile {
  content?: string
  [key: string]: unknown
}

export interface SourcifyCompilation {
  language?: string
  compiler?: string
  compilerVersion?: string
  compilerSettings?: Record<string, unknown>
  name?: string
  fullyQualifiedName?: string
}

export interface SourcifyProxyResolution {
  isProxy?: boolean
  proxyType?: string
  implementations?: Array<{
    address: string
    [key: string]: unknown
  }>
  [key: string]: unknown
}

export interface SourcifyContract {
  matchId?: string
  creationMatch?: SourcifyMatch
  runtimeMatch?: SourcifyMatch
  verifiedAt?: string
  match?: SourcifyMatch
  chainId: string
  address: string
  creationBytecode?: SourcifyBytecodeSection
  runtimeBytecode?: SourcifyBytecodeSection
  deployment?: SourcifyDeployment
  sources?: Record<string, SourcifySourceFile>
  compilation?: SourcifyCompilation
  abi?: unknown[]
  userdoc?: Record<string, unknown>
  devdoc?: Record<string, unknown>
  storageLayout?: Record<string, unknown>
  metadata?: Record<string, unknown>
  stdJsonInput?: Record<string, unknown>
  stdJsonOutput?: Record<string, unknown>
  proxyResolution?: SourcifyProxyResolution
  [key: string]: unknown
}

interface SourcifyApiErrorBody {
  error?: string
  message?: string
}

export class SourcifyAPI {
  #fetch: Fetch

  #baseUrl: string

  constructor({
    fetch,
    baseUrl = 'https://sourcify.dev/server'
  }: {
    fetch: Fetch
    baseUrl?: string
  }) {
    this.#fetch = fetch
    this.#baseUrl = baseUrl
  }

  async getContract(chainId: bigint, address: string): Promise<SourcifyContract> {
    if (!isAddress(address)) throw new Error(`Passed an invalid address: ${address}`)

    const normalizedAddress = getAddress(address)
    const normalizedBaseUrl = this.#baseUrl.endsWith('/') ? this.#baseUrl : `${this.#baseUrl}/`
    const requestUrl = new URL(
      `v2/contract/${chainId.toString()}/${normalizedAddress}`,
      normalizedBaseUrl
    )

    requestUrl.searchParams.set('fields', 'all')

    const response = await this.#fetch(requestUrl.toString(), {
      headers: {
        Accept: 'application/json'
      }
    })

    if (!response.ok) {
      const errorDetails = await this.#getErrorDetails(response)
      const statusMessage = `Sourcify request failed with status ${response.status}`
      throw new Error(errorDetails ? `${statusMessage}: ${errorDetails}` : statusMessage)
    }

    try {
      return (await response.json()) as SourcifyContract
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown JSON parsing error'
      throw new Error(`Failed to parse Sourcify contract response: ${message}`)
    }
  }

  async #getErrorDetails(response: {
    clone?: () => { json: () => Promise<SourcifyApiErrorBody>; text: () => Promise<string> }
    json: () => Promise<SourcifyApiErrorBody>
    text: () => Promise<string>
  }) {
    const jsonReader = response.clone ? response.clone() : response

    try {
      const body = await jsonReader.json()
      if (typeof body?.error === 'string' && body.error) return body.error
      if (typeof body?.message === 'string' && body.message) return body.message
    } catch {
      // Fall back to text if the response isn't JSON.
    }

    try {
      const bodyText = await response.text()
      return bodyText || null
    } catch {
      return null
    }
  }
}
