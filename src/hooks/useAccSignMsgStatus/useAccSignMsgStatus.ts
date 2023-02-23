// @ts-nocheck
import { Bundle } from 'adex-protocol-eth/js/Bundle'
import { AbiCoder, keccak256 } from 'ethers/lib/utils'
import { useEffect, useState } from 'react'

import accountPresets from '../../constants/accountPresets'
import { fetchPost } from '../../services/fetch'
import { getProvider } from '../../services/provider'
import { UseAccSignMsgStatusProps, UseAccSignMsgStatusReturnType } from './types'

const useAccSignMsgStatus = ({
  fetch,
  addToast,
  networkId,
  accountSigner,
  accountId
}: UseAccSignMsgStatusProps): UseAccSignMsgStatusReturnType => {
  const [isDeployed, setIsDeployed] = useState<null | boolean>(null)
  const [hasPrivileges, setHasPrivileges] = useState<null | boolean>(null)

  useEffect(() => {
    ;(() => {
      const bundle = new Bundle({
        network: networkId,
        identity: accountId,
        signer: accountSigner
      })

      const provider = getProvider(networkId)

      let privilegeAddress: any
      let quickAccAccountHash: any
      if (accountSigner?.quickAccManager) {
        const { quickAccTimelock } = accountPresets
        const quickAccountTuple = [quickAccTimelock, accountSigner?.one, accountSigner?.two]
        const abiCoder = new AbiCoder()
        quickAccAccountHash = keccak256(
          abiCoder.encode(['tuple(uint, address, address)'], [quickAccountTuple])
        )
        privilegeAddress = accountSigner?.quickAccManager
      } else {
        privilegeAddress = accountSigner?.address
      }

      const web3Method = {
        method: 'eth_call',
        jsonrpc: '2.0',
        id: 1,
        params: [
          {
            to: bundle.identity,
            data: `0xc066a5b1000000000000000000000000${privilegeAddress.toLowerCase().substring(2)}`
          },
          'latest'
        ]
      }

      fetchPost(fetch, provider?.connection?.url, web3Method)
        .then((result: any) => {
          if (result.result && result.result !== '0x') {
            setIsDeployed(true)
            if (accountSigner?.quickAccManager) {
              setHasPrivileges(result.result === quickAccAccountHash)
            } else {
              // TODO: To ask : in what cases it's more than 1?
              // eslint-disable-next-line no-lonely-if
              if (
                result.result ===
                '0x0000000000000000000000000000000000000000000000000000000000000001'
              ) {
                setHasPrivileges(true)
              } else {
                setHasPrivileges(false)
              }
            }
          } else {
            // result.error or anything else that does not have a .result prop, we assume it is not deployed
            setIsDeployed(false)
          }
        })
        .catch((err) => {
          // as raw XHR calls, reverts are not caught, but only have .error prop
          // this should be a network error
          addToast(err.message, { error: true })
        })
    })()
  }, [networkId, accountSigner, accountId, addToast, fetch])

  return {
    isDeployed,
    hasPrivileges
  }
}

export default useAccSignMsgStatus
