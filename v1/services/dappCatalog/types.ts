export enum WalletConnectionType {
  'gnosis' = 'gnosis',
  'walletconnect' = 'walletconnect'
}

export enum SupportedWeb3Connectivity {
  'gnosis' = 'gnosis',
  'walletconnect' = 'walletconnect',
  'injected' = 'injected'
}

export enum ApplicationType {
  'web' = 'web',
  'mobile' = 'mobile'
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
  networks: Array<any>
  web3Connectivity?: Array<Web3ConnectivityId>
  isWalletPlugin?: boolean
  featured?: boolean
  forceInternal?: boolean
  applicationType: Array<keyof typeof ApplicationType>
}
