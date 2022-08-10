import { UseAccountsReturnType } from '../useAccounts'

export type UseStakedWalletTokenProps = {
  useAccounts: () => UseAccountsReturnType
}

export type UseStakedWalletTokenReturnType = {
  stakedAmount: number
}
