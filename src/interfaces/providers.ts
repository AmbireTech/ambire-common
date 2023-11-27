import { JsonRpcProvider } from 'ethers'

import { NetworkDescriptor } from './networkDescriptor'

export type Providers = { [key: NetworkDescriptor['id']]: JsonRpcProvider | null }

export type Provider = JsonRpcProvider | null
