import { JsonRpcProvider } from 'ethers'

import { IEventEmitter } from './eventEmitter'
import { Network } from './network'

export interface IProvidersController extends IEventEmitter {
  providers: RPCProviders
  initialLoadPromise: Promise<void>
  isInitialized: boolean
  setProvider(network: Network): void
  updateProviderIsWorking(chainId: bigint, isWorking: boolean): void
  removeProvider(chainId: bigint): void
}

export type RPCProvider = JsonRpcProvider & { isWorking?: boolean }

export type RPCProviders = { [chainId: string]: RPCProvider }
