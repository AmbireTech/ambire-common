import { UseAccountsReturnType } from '../useAccounts'
import { UseRelayerDataReturnType } from '../useRelayerData'

export enum RewardIds {
  ADX_REWARDS = 'adx-rewards',
  BALANCE_REWARDS = 'balance-rewards'
}

export type UseRewardsProps = {
  relayerURL: string
  useAccounts: () => UseAccountsReturnType
  useRelayerData: () => UseRelayerDataReturnType
  useClaimableWalletToken: () => any // TODO
}
