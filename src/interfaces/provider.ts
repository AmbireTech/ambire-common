import { JsonRpcProvider } from 'ethers'

import { NetworkId } from './network'

export type RPCProvider = JsonRpcProvider & { isWorking?: boolean }

export type RPCProviders = { [networkId: NetworkId]: RPCProvider }
