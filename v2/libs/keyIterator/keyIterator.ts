/* eslint-disable new-cap */
import { HDNodeWallet, Mnemonic, Wallet } from 'ethers'

import { KeyIterator as KeyIteratorInterface } from '../../interfaces/keyIterator'

// DOCS
// - Serves for retrieving a range of addresses/keys from a given private key or seed phrase

// USAGE
// const iterator = new KeyIterator('your-private-key-or-seed-phrase')
// const keys = await iterator.retrieve(0, 9, "derivation-path")

function isValidPrivateKey(value: string) {
  try {
    // eslint-disable-next-line no-new
    new Wallet(value)
  } catch (e) {
    return false
  }
  return true
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

  async retrieve(from: number, to: number, derivation: string) {
    if ((!from && from !== 0) || (!to && to !== 0) || !derivation)
      throw new Error('keyIterator: invalid or missing arguments')

    const addresses: string[] = []

    if (this.#privateKey) {
      addresses.push(new Wallet(this.#privateKey).address)
    }

    if (this.#seedPhrase) {
      const mnemonic = Mnemonic.fromPhrase(this.#seedPhrase)
      const wallet = HDNodeWallet.fromMnemonic(mnemonic)

      for (let i = from; i <= to; i++) {
        addresses.push(wallet.derivePath(`${derivation}/${i}`).address)
      }
    }

    return addresses
  }
}
