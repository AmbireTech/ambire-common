import { NetworkType } from '../../constants/networks'
import { UseAccountsReturnType } from '../useAccounts'
import { UseToastsReturnType } from '../useToasts'

export type UseSignMessageProps = {
  fetch: any
  account: UseAccountsReturnType['account']
  everythingToSign: any[]
  relayerURL?: string
  addToast: UseToastsReturnType['addToast']
  resolve: (outcome: any) => void
  onConfirmationCodeRequired: (
    confCodeRequired?: 'email' | 'otp' | null,
    approveQuickAcc?: (confCode: number) => void
  ) => Promise<any>
  onLastMessageSign: () => void
  getHardwareWallet: (device?: any) => any
}

export type UseSignMessageReturnType = {
  approve: (credentials: any, device?: any) => Promise<any>
  approveQuickAcc: (credentials: any) => Promise<any>
  toSign: any
  isLoading: boolean
  hasPrivileges: boolean | null
  hasProviderError: any
  typeDataErr: any
  isDeployed: boolean | null
  dataV4: any
  requestedNetwork: NetworkType | undefined
  requestedChainId: NetworkType['chainId']
  isTypedData: boolean
  confirmationType: 'email' | 'otp' | null
  verifySignature: (toSign: any, sig: any, networkId: any) => Promise<any>
}
