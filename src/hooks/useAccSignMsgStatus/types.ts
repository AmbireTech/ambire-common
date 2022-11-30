import { NetworkId } from '../../constants/networks'
import { Account } from '../useAccounts'
import { UseToastsReturnType } from '../useToasts'

export type UseAccSignMsgStatusProps = {
  fetch: any
  addToast: UseToastsReturnType['addToast']
  networkId: NetworkId
  accountSigner: Account['signer']
  accountId: Account['id']
}

export type UseAccSignMsgStatusReturnType = {
  /** Is the contract deployed on the selected chain. Msgs can be signed with deployed contracts only */
  isDeployed: boolean | null
  /** Whether the signer has privileges to sign a message */
  hasPrivileges: boolean | null
}
