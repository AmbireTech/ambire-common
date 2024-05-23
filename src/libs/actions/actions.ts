import { DappProviderRequest } from '../../interfaces/dapp'

export const dappRequestMethodToActionKind = (method: DappProviderRequest['method']) => {
  if (['call', 'eth_sendTransaction'].includes(method)) return 'call'
  if (
    [
      'eth_signTypedData',
      'eth_signTypedData_v1',
      'eth_signTypedData_v3',
      'eth_signTypedData_v4'
    ].includes(method)
  )
    return 'typedMessage'
  if (['personal_sign', 'eth_sign'].includes(method)) return 'message'

  // method to camelCase
  return method.replace(/_(.)/g, (m, p1) => p1.toUpperCase())
}
