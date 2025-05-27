/* eslint-disable new-cap */
import { HDNodeWallet, Mnemonic, Wallet } from 'ethers'

import {
  HD_PATH_TEMPLATE_TYPE,
  SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET
} from '../../consts/derivation'
import { SelectedAccountForImport } from '../../interfaces/account'
import { KeyIterator as KeyIteratorInterface } from '../../interfaces/keyIterator'
import { Key } from '../../interfaces/keystore'
import { getHdPathFromTemplate } from '../../utils/hdPath'
import { isDerivedForSmartAccountKeyOnly } from '../account/account'
import { getDefaultKeyLabel, getExistingKeyLabel } from '../keys/keys'

export function isValidPrivateKey(value: string): boolean {
  try {
    return !!new Wallet(value)
  } catch {
    return false
  }
}

export const getPrivateKeyFromSeed = (
  seed: string,
  seedPassphrase: string | null | undefined,
  keyIndex: number,
  hdPathTemplate: HD_PATH_TEMPLATE_TYPE
) => {
  const mnemonic = Mnemonic.fromPhrase(seed, seedPassphrase)
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
 * Serves for retrieving a range of addresses/keys from a given private key or seed phrase
 */
export class KeyIterator implements KeyIteratorInterface {
  type = 'internal' as 'internal'

  subType: 'seed' | 'private-key'

  #privateKey: string | null = null

  #seedPhrase: string | null = null

  #seedPassphrase: string | null = null

  constructor(_privKeyOrSeed: string, _seedPassphrase?: string | null) {
    if (!_privKeyOrSeed) throw new Error('keyIterator: no private key or seed phrase provided')

    if (isValidPrivateKey(_privKeyOrSeed)) {
      this.#privateKey = _privKeyOrSeed
      this.subType = 'private-key'
      return
    }

    if (Mnemonic.isValidMnemonic(_privKeyOrSeed)) {
      this.#seedPhrase = _privKeyOrSeed
      this.subType = 'seed'

      if (_seedPassphrase) {
        this.#seedPassphrase = _seedPassphrase
      }
      return
    }

    throw new Error('keyIterator: invalid argument provided to constructor')
  }

  async getEncryptedSeed(
    encryptor: (
      seed: string,
      seedPassphrase?: string | null | undefined
    ) => Promise<{
      seed: string
      passphrase: string | null
    }>
  ) {
    if (!this.#seedPhrase) return null
    const encryptedSeed = await encryptor(this.#seedPhrase, this.#seedPassphrase)

    return encryptedSeed
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
        const shouldDerive = from >= SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET
        // Before v4.31.0, private keys for accounts used as smart account keys
        // were derived. That's no longer the case. Importing private keys
        // does not generate smart accounts anymore.
        if (!shouldDerive) keys.push(new Wallet(this.#privateKey).address)
      }

      if (this.#seedPhrase) {
        const mnemonic = Mnemonic.fromPhrase(this.#seedPhrase, this.#seedPassphrase)

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

  retrieveInternalKeys(
    selectedAccountsForImport: SelectedAccountForImport[],
    hdPathTemplate: HD_PATH_TEMPLATE_TYPE,
    keystoreKeys: Key[]
  ) {
    return selectedAccountsForImport.flatMap((acc) => {
      // Should never happen
      if (!['seed', 'private-key'].includes(this.subType)) {
        console.error('keyIterator: invalid subType', this.subType)
        return []
      }

      return acc.accountKeys.flatMap(({ index }: { index: number }, i) => {
        // In case it is a seed, the private keys have to be extracted
        if (this.subType === 'seed') {
          if (!this.#seedPhrase) {
            // Should never happen
            console.error('keyIterator: no seed phrase provided')
            return []
          }

          const privateKey = getPrivateKeyFromSeed(
            this.#seedPhrase,
            this.#seedPassphrase,
            index,
            hdPathTemplate
          )
          return [
            {
              addr: new Wallet(privateKey).address,
              type: 'internal' as 'internal',
              label:
                getExistingKeyLabel(keystoreKeys, acc.account.addr, this.type) ||
                getDefaultKeyLabel(
                  keystoreKeys.filter((key) => acc.account.associatedKeys.includes(key.addr)),
                  i
                ),
              privateKey,
              dedicatedToOneSA: isDerivedForSmartAccountKeyOnly(index),
              meta: {
                createdAt: new Date().getTime()
              }
            }
          ]
        }

        // So the subType is 'private-key' then
        if (!this.#privateKey) {
          // Should never happen
          console.error('keyIterator: no private key provided')
          return []
        }

        // Before v4.31.0, private keys for accounts used as smart account keys
        // were derived. That's no longer the case. Importing private keys
        // does not generate smart accounts anymore.
        const isPrivateKeyThatShouldBeDerived =
          isValidPrivateKey(this.#privateKey) && index >= SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET
        if (isPrivateKeyThatShouldBeDerived) {
          // Should never happen
          console.error(
            'keyIterator: since v4.31.0, private keys should not be derived and importing them does not retrieve a smart account'
          )
          return []
        }

        return [
          {
            addr: new Wallet(this.#privateKey).address,
            type: 'internal' as 'internal',
            label:
              getExistingKeyLabel(keystoreKeys, acc.account.addr, this.type) ||
              getDefaultKeyLabel(
                keystoreKeys.filter((key) => acc.account.associatedKeys.includes(key.addr)),
                0
              ),
            privateKey: this.#privateKey,
            dedicatedToOneSA: false,
            meta: {
              createdAt: new Date().getTime()
            }
          }
        ]
      })
    })
  }

  isSeedMatching(seedPhraseToCompareWith: string) {
    if (!this.#seedPhrase) return false

    return (
      Mnemonic.fromPhrase(this.#seedPhrase).phrase ===
      Mnemonic.fromPhrase(seedPhraseToCompareWith).phrase
    )
  }
}
