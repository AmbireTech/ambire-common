import { NetworkId } from '../../constants/networks'

export enum WalletConnectionType {
  'gnosis' = 'gnosis',
  'walletconnect' = 'walletconnect'
}

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
  networks: NetworkId[]
}
