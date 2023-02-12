// TODO: add types

import { getAddress, hexDataLength } from 'ethers/lib/utils'

import { Account } from '../../hooks/useAccounts'
import { isEmail } from './validate'

const NUMBER_STRING_REGEX = /^([0-9]+\.?[0-9]*)$/
const HEX_DATA_LENGTH = 32
const TIME_LOCK_NUMBER_LENGTH = 6
const MAX_FILE_SIZE = 3072
const NEEDED_KEYS = ['salt', 'identityFactoryAddr', 'baseIdentityAddr', 'bytecode', 'signer']

const isValidAddress = (addr: string) => {
  try {
    return getAddress(addr) === addr
  } catch (e) {
    return false
  }
}

const isValidTimeLock = (timelock: any) => {
  return (
    NUMBER_STRING_REGEX.test(timelock) && timelock.toString().length === TIME_LOCK_NUMBER_LENGTH
  )
}
const isValidSalt = (salt: any) => hexDataLength(salt) === HEX_DATA_LENGTH
const validateAccountProps = (acc: Account) =>
  NEEDED_KEYS.every((key) => Object.keys(acc).includes(key))
const fileSizeValidator = (file: any) => {
  if (file.size > MAX_FILE_SIZE) {
    return {
      code: 'file-size-too-large',
      message: `The file size is larger than ${(MAX_FILE_SIZE / 1024).toFixed(2)} KB.`
    }
  }

  return null
}

const validateImportedAccountProps = (acc: Account) => {
  if (!(acc && validateAccountProps(acc))) {
    return {
      success: false,
      message: 'The imported file does not contain needed account data.'
    }
  }

  if (!(acc.id && isValidAddress(acc.id))) {
    return {
      success: false,
      message: 'Failed to import JSON file: invalid id'
    }
  }

  if (!(acc.signer && isValidAddress(acc.signer.address || acc.signer.quickAccManager))) {
    return {
      success: false,
      message: 'JSON file: invalid signer address'
    }
  }

  if (acc.signer.quickAccManager) {
    if (typeof acc.email !== 'string' || !isEmail(acc.email)) {
      return {
        success: false,
        message: 'Failed to import JSON file: invalid email'
      }
    }
    if (!(acc.signer.timelock && isValidTimeLock(acc.signer.timelock))) {
      return {
        success: false,
        message: 'Failed to import JSON file: invalid signer timelock'
      }
    }

    if (!(acc.signer.one && isValidAddress(acc.signer.one))) {
      return {
        success: false,
        message: 'Failed to import JSON file: invalid signer one'
      }
    }

    if (!(acc.signer.two && isValidAddress(acc.signer.two))) {
      return {
        success: false,
        message: 'Failed to import JSON file: invalid signer two'
      }
    }
  }

  if (!(acc.salt && isValidSalt(acc.salt))) {
    return { success: false, message: 'JSON file: invalid salt' }
  }

  if (!(acc.identityFactoryAddr && isValidAddress(acc.identityFactoryAddr))) {
    return {
      success: false,
      message: 'JSON file: invalid identity Factory Address'
    }
  }

  if (!(acc.baseIdentityAddr && isValidAddress(acc.baseIdentityAddr))) {
    return {
      success: false,
      message: 'JSON file: invalid base Identity Address'
    }
  }

  return { success: true }
}

export { validateImportedAccountProps, fileSizeValidator }
