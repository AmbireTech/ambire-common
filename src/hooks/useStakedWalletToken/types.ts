import { Account } from '../useAccounts'

export type UseStakedWalletTokenProps = {
  accountId: Account['id']
}

export type UseStakedWalletTokenReturnType = {
  stakedAmount: any // TODO: add type
  isLoading: boolean
  error: string
}

export type LogType = {
  address: string
  blockHash: string
  blockNumber: number
  data: string
  logIndex: number
  removed: boolean
  topics: string[]
  transactionHash: string
  transactionIndex: number
}

export type ByHash = {
  [key: string]: LogType
}
