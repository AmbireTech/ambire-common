import { Account } from '../useAccounts'

export type UseStakedWalletTokenProps = {
  accountId: Account['id']
}

export type UseStakedWalletTokenReturnType = {
  stakedAmount: number
}
