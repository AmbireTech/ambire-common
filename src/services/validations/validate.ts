import { getAddress, parseUnits } from 'ethers'
import isEmail from 'validator/es/lib/isEmail'

import { TokenResult } from '../../libs/portfolio'
import { getTokenAmount } from '../../libs/portfolio/helpers'
import { getSanitizedAmount } from '../../libs/transfer/amount'
import { isValidAddress } from '../address'

type ValidateReturnType = {
  success: boolean
  message: string
}

const validateAddress = (address: string): ValidateReturnType => {
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

const validateAddAuthSignerAddress = (address: string, selectedAcc: any): ValidateReturnType => {
  const isValidAddr = validateAddress(address)
  if (!isValidAddr.success) return isValidAddr

  if (address && selectedAcc && address === selectedAcc) {
    return {
      success: false,
      message: "You can't send to the same address you’re sending from."
    }
  }

  return { success: true, message: '' }
}

const NOT_IN_ADDRESS_BOOK_MESSAGE =
  "This address isn't in your Address Book. Double-check the details before confirming."
const validateSendTransferAddress = (
  address: string,
  selectedAcc: string,
  addressConfirmed: any,
  isRecipientAddressUnknown: boolean,
  isRecipientHumanizerKnownTokenOrSmartContract: boolean,
  isEnsAddress: boolean,
  isRecipientDomainResolving: boolean,
  isSWWarningVisible?: boolean,
  isSWWarningAgreed?: boolean
): ValidateReturnType => {
  // Basic validation is handled in the AddressInput component and we don't want to overwrite it.
  if (!isValidAddress(address) || isRecipientDomainResolving) {
    return {
      success: true,
      message: ''
    }
  }

  if (selectedAcc && address.toLowerCase() === selectedAcc.toLowerCase()) {
    return {
      success: false,
      message: "You can't send to the same address you're sending from."
    }
  }

  if (isRecipientHumanizerKnownTokenOrSmartContract) {
    return {
      success: false,
      message: 'You are trying to send tokens to a smart contract. Doing so would burn them.'
    }
  }

  if (
    isRecipientAddressUnknown &&
    !addressConfirmed &&
    !isEnsAddress &&
    !isRecipientDomainResolving
  ) {
    return {
      success: false,
      message: NOT_IN_ADDRESS_BOOK_MESSAGE
    }
  }

  if (
    isRecipientAddressUnknown &&
    !addressConfirmed &&
    isEnsAddress &&
    !isRecipientDomainResolving
  ) {
    return {
      success: false,
      message: NOT_IN_ADDRESS_BOOK_MESSAGE
    }
  }

  if (isRecipientAddressUnknown && addressConfirmed && isSWWarningVisible && !isSWWarningAgreed) {
    return {
      success: false,
      message: 'Please confirm that the recipient address is not an exchange.'
    }
  }

  return { success: true, message: '' }
}

const validateSendTransferAmount = (
  amount: string,
  selectedAsset: TokenResult
): ValidateReturnType => {
  const sanitizedAmount = getSanitizedAmount(amount, selectedAsset.decimals)

  if (!(sanitizedAmount && sanitizedAmount.length)) {
    return {
      success: false,
      message: ''
    }
  }

  if (!(sanitizedAmount && Number(sanitizedAmount) > 0)) {
    // The user has entered an amount that is outside of the valid range.
    if (Number(amount) > 0 && selectedAsset.decimals && selectedAsset.decimals > 0) {
      return {
        success: false,
        message: `The amount must be greater than 0.${'0'.repeat(selectedAsset.decimals - 1)}1.`
      }
    }

    return {
      success: false,
      message: 'The amount must be greater than 0.'
    }
  }

  try {
    if (sanitizedAmount && selectedAsset && selectedAsset.decimals) {
      if (Number(sanitizedAmount) < 1 / 10 ** selectedAsset.decimals)
        return {
          success: false,
          message: 'Token amount too low.'
        }

      const currentAmount: bigint = parseUnits(sanitizedAmount, selectedAsset.decimals)

      if (currentAmount > getTokenAmount(selectedAsset)) {
        return {
          success: false,
          message: 'Insufficient amount.'
        }
      }
    }
  } catch (e) {
    console.error(e)

    return {
      success: false,
      message: 'Invalid amount.'
    }
  }

  return { success: true, message: '' }
}

const isValidCode = (code: string) => code.length === 6

const isValidPassword = (password: string) => password.length >= 8

function isValidURL(url: string) {
  const urlRegex =
    /^(?:https?|ftp):\/\/(?:\w+:{0,1}\w*@)?(?:\S+)(?::\d+)?(?:\/|\/(?:[\w#!:.?+=&%@!\-\/]))?$/

  return urlRegex.test(url)
}

export {
  isEmail,
  validateAddAuthSignerAddress,
  validateSendTransferAddress,
  validateSendTransferAmount,
  isValidCode,
  isValidPassword,
  isValidURL
}
