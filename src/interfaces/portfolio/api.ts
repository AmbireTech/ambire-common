import { PositionsByProvider } from './defiLib'
import { ExtendedErrorWithLevel } from './errors'
import { Hints } from './hints'

/**
 * ERC-721 hints, returned by the Velcro API
 * Their structure is different and more complex than the structure
 * we use in the extension
 */
export interface VelcroERC721Hints {
  [collectionAddress: string]:
    | {
        isKnown: boolean
        enumerable: boolean
      }
    | {
        isKnown: boolean
        tokens: string[]
      }
}

/**
 * The raw response, returned by the Velcro API.
 * Currently only called by the portfolio lib to fetch hints only.
 */
export type ExternalHintsAPIResponse = {
  erc20s: Hints['erc20s']
  erc721s: VelcroERC721Hints
} & (Required<Hints['externalApi']> & {
  error?: string
})

/**
 * The raw response, returned by Velcro for portfolio discovery.
 * It contains hints and defi positions. Used by the controller.
 */
export type ExternalPortfolioDiscoveryResponse = {
  networkId: string
  chainId: number
  accountAddr: string
  erc20s: ExternalHintsAPIResponse['erc20s']
  erc721s: ExternalHintsAPIResponse['erc721s']
  hasHints: ExternalHintsAPIResponse['hasHints']
  prices: ExternalHintsAPIResponse['prices']
  lastUpdate: ExternalHintsAPIResponse['lastUpdate']
  defi:
    | {
        positions: Omit<PositionsByProvider, 'source'>[]
        updatedAt: number
      }
    | {
        success: false
        errorState: {
          message: string
          level: 'fatal'
        }[]
      }
  /**
   * The count of defi positions on networks that weren't requested.
   * Used to inform the user about positions on disabled networks.
   */
  otherNetworksDefiCounts: {
    [chainId: string]: number
  }
}

export type FormattedPortfolioDiscoveryResponse = {
  data: {
    hints: FormattedExternalHintsAPIResponse | null
    defi: {
      positions: PositionsByProvider[]
      updatedAt: number
      isForceUpdate: boolean
    } | null
    /**
     * The count of defi positions on networks that weren't requested.
     * Used to inform the user about positions on disabled networks.
     */
    otherNetworksDefiCounts: {
      [chainId: string]: number
    }
  } | null
  errors: ExtendedErrorWithLevel[]
}

/**
 * A stripped version of `ExternalHintsAPIResponse`. Also, ERC-721 hints
 * are formatted to be in the structure, expected by the extension.
 */
export type FormattedExternalHintsAPIResponse = {
  erc20s: Hints['erc20s']
  erc721s: Hints['erc721s']
  lastUpdate: ExternalHintsAPIResponse['lastUpdate']
  hasHints: ExternalHintsAPIResponse['hasHints']
}
