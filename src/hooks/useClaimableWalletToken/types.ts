import { UseAccountsReturnType } from 'ambire-common/src/hooks/useAccounts'
import { UseNetworkReturnType } from 'ambire-common/src/hooks/useNetwork'

export type UseClaimableWalletTokenProps = {
  useAccounts: () => UseAccountsReturnType
  useNetwork: () => UseNetworkReturnType
  useRequests: () => any // TODO
}
