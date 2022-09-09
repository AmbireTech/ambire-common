import { UseNetworkReturnType } from 'ambire-common/src/hooks/useNetwork'

import { Account } from '../useAccounts'

export type UseClaimableWalletTokenProps = {
  // TODO: Add type
  useFetchConstants: any
  accountId: Account['id']
  network: UseNetworkReturnType['network']
  addRequest: any // TODO
  totalLifetimeRewards: number
  walletUsdPrice: number
}

export type UseClaimableWalletTokenReturnType = {
  vestingEntry?: {
    addr: string
    rate: string
    start: number
    end: number
  }
  shouldDisplayMintableVesting: boolean
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
  claimEarlyRewards: (withoutBurn?: boolean) => void
  claimVesting: () => void
  pendingTokensTotal: string
  claimableNowUsd: string
  mintableVestingUsd: string
  claimingDisabled: boolean
}
