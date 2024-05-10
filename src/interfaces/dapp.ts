export interface Dapp {
  name: string
  description: string
  url: string
  icon: string | null
  isConnected: boolean
  chainId: number
  favorite: boolean
}
