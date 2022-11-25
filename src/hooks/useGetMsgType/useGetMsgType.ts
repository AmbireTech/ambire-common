import { _TypedDataEncoder } from 'ethers/lib/utils'

import { UseGetMsgTypeProps, UseGetMsgTypeReturnType } from './types'

const useGetMsgType = ({ msgToSign }: UseGetMsgTypeProps): UseGetMsgTypeReturnType => {
  let typeDataErr
  let dataV4: any
  let requestedChainId = msgToSign.chainId
  const isTypedData = ['eth_signTypedData_v4', 'eth_signTypedData'].indexOf(msgToSign?.type) !== -1
  if (isTypedData) {
    dataV4 = msgToSign.txn
    try {
      if (dataV4.startsWith('{')) {
        dataV4 = JSON.parse(msgToSign.txn)
      }
    } catch (error) {
      dataV4 = msgToSign.txn
    }
    if (typeof dataV4 === 'object' && dataV4 !== null) {
      try {
        if (dataV4?.types?.EIP712Domain) {
          // Avoids failure in case some dapps explicitly add this (redundant) prop
          delete dataV4?.types?.EIP712Domain
        }
        _TypedDataEncoder.hash(dataV4?.domain, dataV4.types, dataV4?.message)
        // enforce chainId
        if (dataV4.domain?.chainId) {
          requestedChainId = dataV4.domain?.chainId
        }
      } catch {
        typeDataErr = '.txn has Invalid TypedData object. Should be {domain, types, message}'
      }
    } else {
      typeDataErr = '.txn should be a TypedData object'
    }
  }

  return {
    typeDataErr,
    requestedChainId,
    dataV4,
    isTypedData
  }
}

export default useGetMsgType
