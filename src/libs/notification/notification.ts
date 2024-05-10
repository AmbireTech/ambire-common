export const SIGN_METHODS = [
  'eth_signTypedData',
  'eth_signTypedData_v1',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
  'personal_sign',
  'eth_sign',
  'eth_sendTransaction',
  'gs_multi_send',
  'ambire_sendBatchTransaction'
]

export const QUEUE_REQUEST_METHODS_WHITELIST = SIGN_METHODS

export const isSignMethod = (method: string) => {
  return SIGN_METHODS.includes(method)
}

export const isSignAccountOpMethod = (method: string) => {
  return ['eth_sendTransaction'].includes(method)
}

export const isSignTypedDataMethod = (method: string) => {
  return [
    'eth_signTypedData',
    'eth_signTypedData_v1',
    'eth_signTypedData_v3',
    'eth_signTypedData_v4'
  ].includes(method)
}

export const isSignMessageMethod = (method: string) => {
  return ['personal_sign', 'eth_sign'].includes(method)
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

export const getNotificationScreen = (method: string) => {
  return (methodToScreenMap as { [key: string]: string })[method]
}
