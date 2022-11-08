import { Account } from '../useAccounts'
import { UseRelayerDataProps, UseRelayerDataReturnType } from '../useRelayerData'
import { UseNetworkReturnType } from '../useNetwork'
import { UseRewardsReturnType } from 'ambire-common/src/hooks/useRewards/types'

export type UseClaimableWalletTokenProps = {
  relayerURL: string
  useRelayerData: (props: Omit<UseRelayerDataProps, 'fetch'>) => UseRelayerDataReturnType
  accountId: Account['id']
  network: UseNetworkReturnType['network']
  addRequest: any // TODO
  totalLifetimeRewards: number
  walletUsdPrice: number
  rewardsLastUpdated: UseRewardsReturnType['lastUpdated']
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
    lastUpdated: null | number
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
