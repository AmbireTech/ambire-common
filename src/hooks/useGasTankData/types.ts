import { UseNetworkReturnType } from 'hooks/useNetwork'
import { UsePortfolioReturnType } from 'hooks/usePortfolio'
import { UseRelayerDataReturnType } from 'hooks/useRelayerData'

import { UseAccountsReturnType } from '../useAccounts'

export interface UseGasTankDataProps {
  relayerURL: string
  useAccounts: () => UseAccountsReturnType
  useNetwork: () => UseNetworkReturnType
  usePortfolio: () => UsePortfolioReturnType
  useRelayerData: (url: string | null) => UseRelayerDataReturnType
}

// TODO: add return types
export interface UseGasTankDataReturnType {
  balancesRes: any
  gasTankBalances: any
  isLoading: any
  sortedTokens: any
  gasTankTxns: any
  feeAssetsRes: any
  gasTankFilledTxns: any
  totalSavedResult: any
}
