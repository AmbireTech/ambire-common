import { UseAccountsReturnType } from '../useAccounts'
import { UseNetworkReturnType } from '../useNetwork'
import { UseStorageType } from '../useStorage'
import { UseToastsReturnType } from '../useToasts'

export type UseWalletConnectProps = {
  useAccounts: () => UseAccountsReturnType
  useStorage: UseStorageType
  useToasts: () => UseToastsReturnType
  useNetwork: () => UseNetworkReturnType
  clearWcClipboard?: () => void
}

export type Connection = {
  uri: string
  session: any
  isOffline: boolean
}

export type Request = {
  id: string
  type: string
  wcUri: string
  txn: any
  chainId: string | number
  account: any
  notification: boolean
  isBatch?: boolean
}

export type UseWalletConnectReturnType = {
  connections: Connection[] | []
  requests: Request[]
  isConnecting: boolean
  connect: (connectorOpts: any) => Promise<any>
  disconnect: (uri: string) => void
  resolveMany: (ids: string[], resolution: any) => void
}
