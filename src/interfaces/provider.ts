import { JsonRpcProvider } from 'ethers'

export type RPCProvider = JsonRpcProvider & { isWorking?: boolean }

export type RPCProviders = { [chainId: string]: RPCProvider }
