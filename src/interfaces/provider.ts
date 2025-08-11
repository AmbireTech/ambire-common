import { JsonRpcProvider } from 'ethers'

import { ControllerInterface } from './controller'

export type IProvidersController = ControllerInterface<
  InstanceType<typeof import('../controllers/providers/providers').ProvidersController>
>

export type RPCProvider = JsonRpcProvider & { isWorking?: boolean }

export type RPCProviders = { [chainId: string]: RPCProvider }
