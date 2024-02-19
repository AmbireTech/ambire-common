/* eslint-disable new-cap */
import { ethers, HDNodeWallet, Mnemonic, Wallet } from 'ethers'

import {
  HD_PATH_TEMPLATE_TYPE,
  PRIVATE_KEY_DERIVATION_SALT,
  SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET
} from '../../consts/derivation'
import { KeyIterator as KeyIteratorInterface } from '../../interfaces/keyIterator'
import { getHdPathFromTemplate } from '../../utils/hdPath'

export function isValidPrivateKey(value: string): boolean {
  try {
    return !!new Wallet(value)
  } catch {
    return false
  }
}

export const getPrivateKeyFromSeed = (
  seed: string,
  keyIndex: number,
  hdPathTemplate: HD_PATH_TEMPLATE_TYPE
) => {
  const mnemonic = Mnemonic.fromPhrase(seed)
  const wallet = HDNodeWallet.fromMnemonic(
    mnemonic,
    getHdPathFromTemplate(hdPathTemplate, keyIndex)
  )
  if (wallet) {
    return wallet.privateKey
  }

  throw new Error('Getting the private key from the seed phrase failed.')
}

/**
 * Derives a (second) private key based on a derivation algorithm that uses
 * the combo of (the first) private key as an entropy and a salt (constant)
 */
export function derivePrivateKeyFromAnotherPrivateKey(privateKey: string) {
  // Convert the plain text private key to a buffer
  const privateKeyBuffer = Buffer.from(privateKey, 'utf8')
  const saltBuffer = Buffer.from(PRIVATE_KEY_DERIVATION_SALT, 'utf8')
  const buffer = Buffer.concat([privateKeyBuffer, saltBuffer])

  // Hash the buffer, and convert to a hex string
  // that ultimately represents a derived (second) private key
  return ethers.keccak256(buffer)
}

/**
 * Serves for retrieving a range of addresses/keys from a given private key or seed phrase
 */
export class KeyIterator implements KeyIteratorInterface {
  type = 'internal'

  #privateKey: string | null = null

  #seedPhrase: string | null = null

  constructor(_privKeyOrSeed: string) {
    if (!_privKeyOrSeed) throw new Error('keyIterator: no private key or seed phrase provided')

    if (isValidPrivateKey(_privKeyOrSeed)) {
      this.#privateKey = _privKeyOrSeed
      return
    }

    if (Mnemonic.isValidMnemonic(_privKeyOrSeed)) {
      this.#seedPhrase = _privKeyOrSeed
      return
    }

    throw new Error('keyIterator: invalid argument provided to constructor')
  }

  async retrieve(
    fromToArr: { from: number; to: number }[],
    hdPathTemplate?: HD_PATH_TEMPLATE_TYPE
  ) {
    const keys: string[] = []

    fromToArr.forEach(({ from, to }) => {
      if ((!from && from !== 0) || (!to && to !== 0) || !hdPathTemplate)
        throw new Error('keyIterator: invalid or missing arguments')

      if (this.#privateKey) {
        // Private keys for accounts used as smart account keys should be derived
        const shouldDerive = from >= SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET
        const finalPrivateKey = shouldDerive
          ? derivePrivateKeyFromAnotherPrivateKey(this.#privateKey)
          : this.#privateKey

        keys.push(new Wallet(finalPrivateKey).address)
      }

      if (this.#seedPhrase) {
        const mnemonic = Mnemonic.fromPhrase(this.#seedPhrase)

        for (let i = from; i <= to; i++) {
          const wallet = HDNodeWallet.fromMnemonic(
            mnemonic,
            getHdPathFromTemplate(hdPathTemplate, i)
          )
          keys.push(wallet.address)
        }
      }
    })

    return keys
  }
}
