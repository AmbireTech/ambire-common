import { UseAccountsReturnType } from 'ambire-common/src/hooks/useAccounts'
import { UseNetworkReturnType } from 'ambire-common/src/hooks/useNetwork'

export type UseClaimableWalletTokenProps = {
  useAccounts: () => UseAccountsReturnType
  useNetwork: () => UseNetworkReturnType
  useRequests: () => any // TODO
  totalLifetimeRewards: number
}

export type UseClaimableWalletTokenReturnType = {
  vestingEntry?: {
    addr: string
    rate: string
    start: number
    end: number
  }
  currentClaimStatus: {
    loading: boolean
    claimed: number
    mintableVesting: number
    claimedInitial: number
    error: null | any
  }
  claimableNow: number
  disabledReason: string
  claimDisabledReason: string
  claimEarlyRewards: (withoutBurn: boolean) => void
  claimVesting: () => void
  pendingTokensTotal: string
}
