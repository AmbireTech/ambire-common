import { Network } from '../../../interfaces/network'
import { RPCProvider } from '../../../interfaces/provider'
import { DeFiPositionsError, PositionsByProvider, ProviderError } from '../types'

/** What every protocol needs to read the positions of an account from the chain */
export type RpcFetchParams = {
  accountAddr: string
  provider: RPCProvider
  network: Network
}

/**
 * A protocol whose positions are read from the chain (RPC) instead of, or in addition to,
 * the external API (Velcro/Debank).
 */
export type RpcDefiProvider = {
  /** Must match the name of the protocol in the API response (compared with `getProviderId`) */
  name: string
  /**
   * Reads the positions of the account from the chain alone.
   * Returns null if the account has no positions or the protocol isn't on the network.
   */
  fetchPositions: (params: RpcFetchParams) => Promise<PositionsByProvider | null>
  /**
   * Combines the positions read from the chain with the ones of the same protocol returned by
   * the API. Called only when auto discovery is on and the API returned the protocol.
   * Without it, the positions read from the chain replace the API ones.
   */
  mergeWithApiPositions?: (params: {
    rpcPositions: PositionsByProvider
    apiPositions: PositionsByProvider
  }) => PositionsByProvider
}

/** The positions read from the chain on a network, with the errors of reading them */
export type RpcDefiPositionsResult = {
  positionsByProvider: PositionsByProvider[]
  providerErrors: ProviderError[]
  error?: DeFiPositionsError | null
}
