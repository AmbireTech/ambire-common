import { NetworkId } from '../../constants/networks'

export enum WalletConnectionType {
  'gnosis' = 'gnosis',
  'walletconnect' = 'walletconnect'
}

export enum SupportedWeb3Connectivity {
  'gnosis' = 'gnosis',
  'walletconnect' = 'walletconnect',
  'injected' = 'injected'
}

export type Web3ConnectivityId = keyof typeof SupportedWeb3Connectivity

export type AmbireDappManifest = {
  id: string
  name: string
  description: string
  url: string
  iconUrl: string
  iconPath?: string
  connectionType: WalletConnectionType
  providedBy?: {
    name: string
    url: string
  }
  networks: Array<NetworkId>
  web3Connectivity?: Array<Web3ConnectivityId>
  isWalletPlugin?: boolean
  featured?: boolean
  forceInternal?: boolean
}
