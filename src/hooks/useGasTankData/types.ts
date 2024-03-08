import { UseAccountsReturnType } from '../useAccounts'
import { UseNetworkReturnType } from '../useNetwork'
import { UsePortfolioReturnType } from '../usePortfolio'
import { UseRelayerDataProps, UseRelayerDataReturnType } from '../useRelayerData'

export interface UseGasTankDataProps {
  relayerURL: string
  selectedAcc: UseAccountsReturnType['selectedAcc']
  network: UseNetworkReturnType['network']
  portfolio: UsePortfolioReturnType
  useRelayerData: (props: Omit<UseRelayerDataProps, 'fetch'>) => UseRelayerDataReturnType
}

// TODO: add return types
export interface UseGasTankDataReturnType {
  balancesRes: any
  gasTankBalances: any
  isLoading: any
  gasTankTxns: any
  feeAssetsRes: any
  gasTankFilledTxns: any
  totalSavedResult: any
  availableFeeAssets: any
}
