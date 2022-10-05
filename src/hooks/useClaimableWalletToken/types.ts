import { Account } from '../useAccounts'
import { UseRelayerDataProps, UseRelayerDataReturnType } from '../useRelayerData'
import { UseNetworkReturnType } from '../useNetwork'

export type UseClaimableWalletTokenProps = {
  relayerURL: string,
  useRelayerData: (props: Omit<UseRelayerDataProps, 'fetch'>) => UseRelayerDataReturnType,
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
