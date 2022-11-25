import { NetworkId } from 'constants/networks'
import { Account } from 'hooks/useAccounts'

import { UseToastsReturnType } from '../useToasts'

export type UseAccSignMsgStatusProps = {
  fetch: any
  addToast: UseToastsReturnType['addToast']
  networkId: NetworkId
  accountSigner: Account['signer']
  accountId: Account['id']
}

export type UseAccSignMsgStatusReturnType = {
  isDeployed: boolean | null
  hasPrivileges: boolean | null
}
