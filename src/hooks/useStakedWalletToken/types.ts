import { Account } from '../useAccounts'

export type UseStakedWalletTokenProps = {
  accountId: Account['id']
}

export type UseStakedWalletTokenReturnType = {
  stakedAmount: any // TODO: add type
  isLoading: boolean
  error: string
}
