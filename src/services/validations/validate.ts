import { parseUnits } from 'ethers/lib/utils'
import isEmail from 'validator/es/lib/isEmail'

import { ConstantsType } from '../../hooks/useConstants'
import { isKnownTokenOrContract, isValidAddress } from '../address'

const validateAddress = (address: string) => {
  if (!(address && address.length)) {
    return {
      success: false,
      message: ''
    }
  }

  if (!(address && isValidAddress(address))) {
    return {
      success: false,
      message: 'Invalid address.'
    }
  }

  return { success: true }
}

const validateAddAuthSignerAddress = (address: string, selectedAcc: any) => {
  const isValidAddr = validateAddress(address)
  if (!isValidAddr.success) return isValidAddr

  if (address && selectedAcc && address === selectedAcc) {
    return {
      success: false,
      message: 'The entered address should be different than your own account address.'
    }
  }

  return { success: true }
}

const validateSendTransferAddress = (
  address: any,
  selectedAcc: any,
  addressConfirmed: any,
  isKnownAddress: any,
  humanizerInfo: ConstantsType['humanizerInfo'],
  isUDAddress?: boolean,
  isEnsAddress?: boolean
) => {
  const isValidAddr = validateAddress(address)
  if (!isValidAddr.success) return isValidAddr

  if (address && selectedAcc && address === selectedAcc) {
    return {
      success: false,
      message: 'The entered address should be different than the your own account address.'
    }
  }

  if (address && isKnownTokenOrContract(humanizerInfo, address)) {
    return {
      success: false,
      message: 'You are trying to send tokens to a smart contract. Doing so would burn them.'
    }
  }

  if (address && !isKnownAddress(address) && !addressConfirmed && !isUDAddress && !isEnsAddress) {
    return {
      success: false,
      message:
        "You're trying to send to an unknown address. If you're really sure, confirm using the checkbox below."
    }
  }

  if (address && !isKnownAddress(address) && !addressConfirmed && (isUDAddress || isEnsAddress)) {
    const name = isUDAddress ? 'Unstoppable domain' : 'Ethereum Name Service'
    return {
      success: false,
      message: `You're trying to send to an unknown ${name}. If you really trust the person who gave it to you, confirm using the checkbox below.`
    }
  }

  return { success: true }
}

const validateSendTransferAmount = (amount: any, selectedAsset: any) => {
  if (!(amount && amount.length)) {
    return {
      success: false,
      message: ''
    }
  }

  if (!(amount && amount > 0)) {
    return {
      success: false,
      message: 'The amount must be greater than 0.'
    }
  }

  try {
    if (amount && selectedAsset && selectedAsset.decimals) {
      const parsedAmount = amount.slice(0, amount.indexOf('.') + selectedAsset.decimals + 1) // Fixed decimals in case amount is bigger than selectedAsset.decimals, otherwise would cause overflow error
      const bigNumberAmount = parseUnits(parsedAmount, selectedAsset.decimals)
      if (
        bigNumberAmount &&
        selectedAsset.balanceRaw &&
        bigNumberAmount.gt(selectedAsset.balanceRaw)
      ) {
        return {
          success: false,
          message: `The amount is greater than the asset's balance: ${selectedAsset?.balance} ${selectedAsset?.symbol}.`
        }
      }
    }
  } catch (e) {
    console.error(e)
  }

  return { success: true }
}

const validateSendNftAddress = (
  address: string,
  selectedAcc: any,
  addressConfirmed: any,
  isKnownAddress: any,
  metadata: any,
  selectedNetwork: any,
  network: any,
  humanizerInfo: ConstantsType['humanizerInfo'],
  isUDAddress?: boolean,
  isEnsAddress?: boolean
) => {
  const isValidAddr = validateSendTransferAddress(
    address,
    selectedAcc,
    addressConfirmed,
    isKnownAddress,
    humanizerInfo,
    isUDAddress,
    isEnsAddress
  )
  if (!isValidAddr.success) return isValidAddr

  if (
    metadata &&
    selectedAcc &&
    metadata.owner?.address.toLowerCase() !== selectedAcc.toLowerCase()
  ) {
    return {
      success: false,
      message: "The NFT you're trying to send is not owned by you!"
    }
  }

  if (selectedNetwork && network && selectedNetwork.id !== network) {
    return {
      success: false,
      message: 'The selected network is not the correct one.'
    }
  }

  return { success: true }
}

const isValidCode = (code: string) => code.length === 6

const isValidPassword = (password: string) => password.length >= 8

export {
  isEmail,
  validateAddAuthSignerAddress,
  validateSendTransferAddress,
  validateSendTransferAmount,
  validateSendNftAddress,
  isValidCode,
  isValidPassword
}
