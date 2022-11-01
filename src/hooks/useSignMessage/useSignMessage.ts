// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again
import { Bundle, signMessage, signMessage712 } from 'adex-protocol-eth/js/Bundle'
import { Wallet } from 'ethers'
import {
  _TypedDataEncoder,
  AbiCoder,
  arrayify,
  isHexString,
  keccak256,
  toUtf8Bytes
} from 'ethers/lib/utils'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { verifyMessage } from '@ambire/signature-validator'

import accountPresets from '../../constants/accountPresets'
import { fetchPost } from '../../services/fetch'
import { getNetworkByChainId } from '../../services/getNetwork'
import { getProvider } from '../../services/provider'
import { UseSignMessageProps, UseSignMessageReturnType } from './types'

function getMessageAsBytes(msg: string) {
  // Transforming human message / hex string to bytes
  if (!isHexString(msg)) {
    return toUtf8Bytes(msg)
  }
  return arrayify(msg)
}

const useSignMessage = ({
  fetch,
  account,
  everythingToSign,
  relayerURL,
  addToast,
  resolve,
  onConfirmationCodeRequired,
  onLastMessageSign,
  getHardwareWallet
}: UseSignMessageProps): UseSignMessageReturnType => {
  const [isLoading, setLoading] = useState<boolean>(false)
  const [isDeployed, setIsDeployed] = useState<null | boolean>(null)
  const [hasPrivileges, setHasPrivileges] = useState<null | boolean>(null)
  const [hasProviderError, setHasProviderError] = useState(null)
  const [confirmationType, setConfirmationType] = useState<'email' | 'otp' | null>(null)

  const toSign = useMemo(() => everythingToSign[0] || {}, [everythingToSign])

  let typeDataErr
  let dataV4: any
  let requestedChainId = toSign.chainId
  const isTypedData = ['eth_signTypedData_v4', 'eth_signTypedData'].indexOf(toSign?.type) !== -1
  if (isTypedData) {
    dataV4 = toSign.txn
    try {
      if (dataV4.startsWith('{')) {
        dataV4 = JSON.parse(toSign.txn)
      }
    } catch (error) {
      dataV4 = toSign.txn
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

  const requestedNetwork = getNetworkByChainId(requestedChainId)

  const checkIsDeployedAndHasPrivileges = useCallback(async () => {
    if (!requestedNetwork) return

    const bundle = new Bundle({
      network: requestedNetwork?.id,
      identity: account?.id,
      signer: account?.signer
    })

    const provider = await getProvider(requestedNetwork?.id)

    let privilegeAddress: any
    let quickAccAccountHash: any
    if (account?.signer?.quickAccManager) {
      const { quickAccTimelock } = accountPresets
      const quickAccountTuple = [quickAccTimelock, account?.signer?.one, account?.signer?.two]
      const abiCoder = new AbiCoder()
      quickAccAccountHash = keccak256(
        abiCoder.encode(['tuple(uint, address, address)'], [quickAccountTuple])
      )
      privilegeAddress = account.signer?.quickAccManager
    } else {
      privilegeAddress = account.signer?.address
    }

    // to differenciate reverts and network issues
    const callObject = {
      method: 'eth_call',
      params: [
        {
          to: bundle.identity,
          data: `0xc066a5b1000000000000000000000000${privilegeAddress.toLowerCase().substring(2)}`
        },
        'latest'
      ],
      id: 1,
      jsonrpc: '2.0'
    }

    fetchPost(fetch, provider?.connection?.url, callObject)
      .then((result: any) => {
        if (result.result && result.result !== '0x') {
          setIsDeployed(true)
          if (account?.signer?.quickAccManager) {
            setHasPrivileges(result.result === quickAccAccountHash)
          } else {
            // TODO: To ask : in what cases it's more than 1?
            // eslint-disable-next-line no-lonely-if
            if (
              result.result === '0x0000000000000000000000000000000000000000000000000000000000000001'
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
        // this should be a netowrk error
        setHasProviderError(err.message)
      })
  }, [account, requestedNetwork, fetch])

  useEffect(() => {
    checkIsDeployedAndHasPrivileges()
  }, [checkIsDeployedAndHasPrivileges])

  const handleSigningErr = useCallback(
    (e: any) => {
      if (e && e.message.includes('must provide an Ethereum address')) {
        addToast(
          `Signing error: not connected with the correct address. Make sure you're connected with ${account.signer?.address}.`,
          { error: true }
        )
      } else {
        addToast(`Signing error: ${e.message || e}`, {
          error: true
        })
      }
    },
    [account, addToast]
  )

  const verifySignature = useCallback(
    (toSign, sig, networkId) => {
      const provider = getProvider(networkId)
      return verifyMessage({
        provider,
        signer: account.id,
        message: isTypedData ? null : getMessageAsBytes(toSign.txn),
        typedData: isTypedData ? dataV4 : null,
        signature: sig
      })
        .then((verificationResult: any) => {
          if (verificationResult) {
            addToast(`${toSign.type} SIGNATURE VALID`)
          } else {
            addToast(`${toSign.type} SIGNATURE INVALID`, { error: true })
          }
        })
        .catch((e: any) => {
          addToast(`${toSign.type} SIGNATURE INVALID: ${e.message}`, { error: true })
        })
    },
    [account, addToast, dataV4, isTypedData]
  )

  const approveQuickAcc = useCallback(
    async (credentials: any) => {
      if (!relayerURL) {
        addToast('Email/pass accounts not supported without a relayer connection', {
          error: true
        })
        return
      }
      if (!credentials.password) {
        addToast('Password required to unlock the account', { error: true })
        return
      }
      setLoading(true)
      try {
        const { signature, success, message, confCodeRequired } = await fetchPost(
          fetch,
          // network doesn't matter when signing
          // if it does tho, we can use ${network.id}
          `${relayerURL}/second-key/${account.id}/ethereum/sign${
            isTypedData ? '?typedData=true' : ''
          }`,
          {
            toSign: toSign.txn,
            code: credentials.code?.length ? credentials.code : undefined
          }
        )
        if (!success) {
          setLoading(false)
          if (!message) throw new Error('Secondary key: no success but no error message')
          if (message.includes('invalid confirmation code')) {
            addToast('Unable to sign: wrong confirmation code', { error: true })
          }
          addToast(`Second signature error: ${message}`, {
            error: true
          })
          setConfirmationType(null)
          setLoading(false)

          return
        }
        if (confCodeRequired) {
          setConfirmationType(confCodeRequired)

          if (onConfirmationCodeRequired) {
            await onConfirmationCodeRequired(confCodeRequired, approveQuickAcc)
          }

          setLoading(false)
          return
        }

        if (!account.primaryKeyBackup)
          throw new Error(
            'No key backup found: you need to import the account from JSON or login again.'
          )
        const wallet = await Wallet.fromEncryptedJson(
          JSON.parse(account.primaryKeyBackup),
          credentials.password
        )
        const sig = await (isTypedData
          ? signMessage712(
              wallet,
              account.id,
              account.signer,
              dataV4.domain,
              dataV4.types,
              dataV4.message,
              signature
            )
          : signMessage(
              wallet,
              account.id,
              account.signer,
              getMessageAsBytes(toSign.txn),
              signature
            ))

        await verifySignature(toSign, sig, requestedNetwork?.id)

        resolve({ success: true, result: sig })
        addToast('Successfully signed!')
        if (everythingToSign.length === 1) {
          !!onLastMessageSign && onLastMessageSign()
        }
      } catch (e) {
        handleSigningErr(e)
      }
      setLoading(false)
    },
    [
      account,
      addToast,
      dataV4,
      everythingToSign,
      fetch,
      handleSigningErr,
      isTypedData,
      onConfirmationCodeRequired,
      onLastMessageSign,
      relayerURL,
      requestedNetwork,
      resolve,
      toSign,
      verifySignature
    ]
  )
  // Passing hardware device is required only for the mobile app
  const approve = useCallback(
    async (credentials: any, device?: any) => {
      if (account.signer?.quickAccManager) {
        await approveQuickAcc(credentials)
        return
      }
      setLoading(true)

      try {
        const wallet = await getHardwareWallet(device)

        if (!wallet) {
          return
        }

        // It would be great if we could pass the full data cause then web3 wallets/hw wallets can display the full text
        // Unfortunately that isn't possible, because isValidSignature only takes a bytes32 hash; so to sign this with
        // a personal message, we need to be signing the hash itself as binary data such that we match 'Ethereum signed message:\n32<hash binary data>' on the contract

        const sig = await (toSign.type === 'eth_signTypedData_v4' ||
        toSign.type === 'eth_signTypedData'
          ? signMessage712(
              wallet,
              account.id,
              account.signer,
              dataV4.domain,
              dataV4.types,
              dataV4.message
            )
          : signMessage(wallet, account.id, account.signer, getMessageAsBytes(toSign.txn)))

        await verifySignature(toSign, sig, requestedNetwork?.id)

        resolve({ success: true, result: sig })
        addToast('Successfully signed!')
      } catch (e) {
        handleSigningErr(e)
      }
      setLoading(false)
    },
    [
      account,
      addToast,
      approveQuickAcc,
      dataV4,
      getHardwareWallet,
      handleSigningErr,
      requestedNetwork?.id,
      resolve,
      toSign,
      verifySignature
    ]
  )

  return {
    approve,
    approveQuickAcc,
    toSign,
    isLoading,
    hasPrivileges,
    hasProviderError,
    typeDataErr,
    isDeployed,
    dataV4,
    requestedNetwork,
    requestedChainId,
    isTypedData,
    confirmationType,
    verifySignature
  }
}

export default useSignMessage
