import { DappProviderRequest } from '../../interfaces/dapp'

export const SIGN_METHODS = [
  'eth_signTypedData',
  'eth_signTypedData_v1',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
  'personal_sign',
  'eth_sign',
  'eth_sendTransaction'
]

export const QUEUE_REQUEST_METHODS_WHITELIST = SIGN_METHODS

export const isSignMethod = (method: string) => {
  return SIGN_METHODS.includes(method)
}

export const isSignAccountOpMethod = (method: string) => {
  return ['call', 'eth_sendTransaction'].includes(method)
}

export const isSignTypedDataMethod = (method: string) => {
  return [
    'typedMessage',
    'eth_signTypedData',
    'eth_signTypedData_v1',
    'eth_signTypedData_v3',
    'eth_signTypedData_v4'
  ].includes(method)
}

export const isSignMessageMethod = (method: string) => {
  return ['message', 'personal_sign', 'eth_sign'].includes(method)
}

export const methodToScreenMap = {
  unlock: 'UnlockScreen',
  dapp_connect: 'DappConnectScreen',
  benzin: 'BenzinScreen',
  eth_sendTransaction: 'SignAccountOpScreen',
  eth_signTypedData: 'SignMessageScreen',
  eth_signTypedData_v1: 'SignMessageScreen',
  eth_signTypedData_v3: 'SignMessageScreen',
  eth_signTypedData_v4: 'SignMessageScreen',
  personal_sign: 'SignMessageScreen',
  eth_sign: 'SignMessageScreen',
  wallet_addEthereumChain: 'AddChainScreen',
  wallet_switchEthereumChain: 'AddChainScreen',
  wallet_watchAsset: 'WatchAssetScreen',
  eth_getEncryptionPublicKey: 'GetEncryptionPublicKeyScreen'
}

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

export const getNotificationScreen = (method: string) => {
  return (methodToScreenMap as { [key: string]: string })[method]
}
