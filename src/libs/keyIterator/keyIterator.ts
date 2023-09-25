/* eslint-disable new-cap */
import { HDNodeWallet, Mnemonic, Wallet } from 'ethers'

import { BIP44_HD_PATH } from '../../consts/derivation'
import { KeyIterator as KeyIteratorInterface } from '../../interfaces/keyIterator'

// DOCS
// - Serves for retrieving a range of addresses/keys from a given private key or seed phrase

// USAGE
// const iterator = new KeyIterator('your-private-key-or-seed-phrase')
// const keys = await iterator.retrieve(0, 9, "derivation-path")

export function isValidPrivateKey(value: string): boolean {
  try {
    return !!new Wallet(value)
  } catch {
    return false
  }
}

export class KeyIterator implements KeyIteratorInterface {
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

  async retrieve(from: number, to: number, derivation: string = BIP44_HD_PATH) {
    if ((!from && from !== 0) || (!to && to !== 0) || !derivation)
      throw new Error('keyIterator: invalid or missing arguments')

    const keys: string[] = []

    if (this.#privateKey) {
      keys.push(new Wallet(this.#privateKey).address)
    }

    if (this.#seedPhrase) {
      const mnemonic = Mnemonic.fromPhrase(this.#seedPhrase)
      const wallet = HDNodeWallet.fromMnemonic(mnemonic, derivation)

      for (let i = from; i <= to; i++) {
        keys.push(wallet.deriveChild(i).address)
      }
    }

    return keys
  }
}
