import { _TypedDataEncoder } from 'ethers/lib/utils'
import { useMemo } from 'react'

import { UseGetMsgTypeProps, UseGetMsgTypeReturnType } from './types'

const useGetMsgType = ({ msgToSign }: UseGetMsgTypeProps): UseGetMsgTypeReturnType => {
  let requestedChainId = msgToSign.chainId
  const isTypedData = useMemo(
    () => ['eth_signTypedData_v4', 'eth_signTypedData'].indexOf(msgToSign?.type) !== -1,
    [msgToSign?.type]
  )

  const typeData = useMemo(() => {
    let dataV4
    let typeDataErr
    try {
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
          try {
            const primaryType = dataV4.primaryType

            if (primaryType.toLowerCase() === 'permit') {
              const { message } = dataV4
              // Based on https://eips.ethereum.org/EIPS/eip-2612
              const permitTypeKeys = [
                'owner',
                'spender',
                'value',
                'nonce',
                'deadline',
                'expiry', // used before EIP-2612(same as deadline)
                'allowed'
              ]

              const isMessageValid = Object.keys(message).every((key) =>
                permitTypeKeys.includes(key)
              )

              if (!isMessageValid) {
                typeDataErr =
                  "Invalid 'permit' TypedData object. Should be {owner, spender, value, nonce, deadline, expiry, allowed}. See https://eips.ethereum.org/EIPS/eip-2612"
              }
            }
          } catch {
            typeDataErr = 'Error parsing message.'
          }
        } else {
          typeDataErr = '.txn should be a TypedData object'
        }
      }
    } catch (error: any) {
      typeDataErr = error.message || error
    }

    return {
      dataV4,
      typeDataErr
    }
  }, [isTypedData, msgToSign])

  return {
    isTypedData,
    dataV4: typeData.dataV4,
    typeDataErr: typeData.typeDataErr,
    requestedChainId
  }
}

export default useGetMsgType