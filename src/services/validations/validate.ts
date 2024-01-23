import { formatUnits, getAddress } from 'ethers'
import isEmail from 'validator/es/lib/isEmail'

import { ConstantsType } from '../../../v1/hooks/useConstants'
import { TokenResult } from '../../libs/portfolio'
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

  try {
    getAddress(address)
  } catch {
    return {
      success: false,
      message: 'Invalid checksum. Verify the address and try again.'
    }
  }

  return { success: true, message: '' }
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
  address: string,
  selectedAcc: string,
  addressConfirmed: any,
  isRecipientAddressUnknown: boolean,
  humanizerInfo: ConstantsType['humanizerInfo'],
  isUDAddress: boolean,
  isEnsAddress: boolean,
  isRecipientDomainResolving: boolean
) => {
  // Basic validation is handled in the AddressInput component and we don't want to overwrite it.
  if (!isValidAddress(address) || isRecipientDomainResolving) {
    return {
      success: true,
      message: ''
    }
  }

  // Validate checksum
  try {
    getAddress(address)
  } catch {
    return {
      success: false,
      message: 'Invalid checksum. Verify the address and try again.'
    }
  }

  if (selectedAcc && address === selectedAcc) {
    return {
      success: false,
      message: 'The entered address should be different than the your own account address.'
    }
  }

  if (isKnownTokenOrContract(humanizerInfo, address)) {
    return {
      success: false,
      message: 'You are trying to send tokens to a smart contract. Doing so would burn them.'
    }
  }

  if (
    isRecipientAddressUnknown &&
    !addressConfirmed &&
    !isUDAddress &&
    !isEnsAddress &&
    !isRecipientDomainResolving
  ) {
    return {
      success: false,
      message:
        "You're trying to send to an unknown address. If you're really sure, confirm using the checkbox below."
    }
  }

  if (
    isRecipientAddressUnknown &&
    !addressConfirmed &&
    (isUDAddress || isEnsAddress) &&
    !isRecipientDomainResolving
  ) {
    const name = isUDAddress ? 'Unstoppable domain' : 'Ethereum Name Service'
    return {
      success: false,
      message: `You're trying to send to an unknown ${name}. If you really trust the person who gave it to you, confirm using the checkbox below.`
    }
  }

  return { success: true, message: '' }
}

const validateSendTransferAmount = (amount: string, selectedAsset: TokenResult) => {
  if (!(amount && amount.length)) {
    return {
      success: false,
      message: ''
    }
  }

  if (!(amount && Number(amount) > 0)) {
    return {
      success: false,
      message: 'The amount must be greater than 0.'
    }
  }

  try {
    if (amount && selectedAsset && selectedAsset.decimals) {
      const selectedAssetMaxAmount = Number(
        formatUnits(selectedAsset.amount, Number(selectedAsset.decimals))
      )
      const currentAmount = Number(amount)

      if (currentAmount && selectedAssetMaxAmount && Number(amount) > selectedAssetMaxAmount) {
        return {
          success: false,
          message: `The amount is greater than the asset's balance: ${selectedAssetMaxAmount} ${selectedAsset?.symbol}.`
        }
      }
    }
  } catch (e) {
    console.error(e)
  }

  return { success: true, message: '' }
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
  isUDAddress: boolean,
  isEnsAddress: boolean,
  isRecipientDomainResolving: boolean
) => {
  const isValidAddr = validateSendTransferAddress(
    address,
    selectedAcc,
    addressConfirmed,
    isKnownAddress,
    humanizerInfo,
    isUDAddress,
    isEnsAddress,
    isRecipientDomainResolving
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
