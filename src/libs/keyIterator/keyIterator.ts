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

/**
 * The maximum number of private keys that can be imported at once (bulk import).
 * Every imported account adds background work (portfolio and account state updates on every
 * network), so the limit is kept low until the performance with more accounts is measured.
 */
export const MAX_BULK_PRIVATE_KEYS = 20

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
 * Brings a private key to a single comparable form (trimmed, lowercase, without the `0x` prefix),
 * so that the same key entered with or without a prefix or in a different case is detected as a duplicate.
 */
export const normalizePrivateKey = (privateKey: string) => {
  const trimmedPrivateKey = privateKey.trim().toLowerCase()

  return trimmedPrivateKey.startsWith('0x') ? trimmedPrivateKey.slice(2) : trimmedPrivateKey
}

/**
 * Serves for retrieving a range of addresses/keys from a given seed phrase, a private key
 * or a list of private keys (bulk import). For a list, the key at position N is served at index N.
 */
export class KeyIterator implements KeyIteratorInterface {
  type = 'internal' as const

  subType: 'seed' | 'private-key'

  #privateKeys: string[] = []

  #seedPhrase: string | null = null

  #seedPassphrase: string | null = null

  #cachedBaseWallet: HDNodeWallet | null = null

  constructor(_privKeyOrSeed: string | string[], _seedPassphrase?: string | null) {
    if (!_privKeyOrSeed?.length)
      throw new Error('keyIterator: no private key or seed phrase provided')

    if (Array.isArray(_privKeyOrSeed)) {
      // Duplicates are dropped, otherwise the same account would be listed more than once
      const uniquePrivateKeys = [...new Set(_privKeyOrSeed.map(normalizePrivateKey))]
      if (!uniquePrivateKeys.every(isValidPrivateKey))
        throw new Error('keyIterator: invalid argument provided to constructor')

      this.#privateKeys = uniquePrivateKeys
      this.subType = 'private-key'
      return
    }

    if (isValidPrivateKey(_privKeyOrSeed)) {
      this.#privateKeys = [_privKeyOrSeed]
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

  /**
   * How many keys the iterator can serve. Only set for private keys, since a seed phrase
   * can derive keys at any index (undefined means there is no limit).
   */
  get keysCount(): number | undefined {
    return this.subType === 'private-key' ? this.#privateKeys.length : undefined
  }

  #getBaseWallet(): HDNodeWallet | null {
    if (this.#cachedBaseWallet) return this.#cachedBaseWallet
    if (this.subType !== 'seed' || !this.#seedPhrase) return null

    const mnemonic = Mnemonic.fromPhrase(this.#seedPhrase, this.#seedPassphrase)
    this.#cachedBaseWallet = HDNodeWallet.fromMnemonic(mnemonic, 'm')

    return this.#cachedBaseWallet
  }

  async retrieve(
    fromToArr: { from: number; to: number }[],
    hdPathTemplate?: HD_PATH_TEMPLATE_TYPE
  ) {
    const keys: string[] = []

    const baseWallet = this.#getBaseWallet()

    for (const { from, to } of fromToArr) {
      if ((!from && from !== 0) || (!to && to !== 0) || !hdPathTemplate)
        throw new Error('keyIterator: invalid or missing arguments')

      if (this.#privateKeys.length) {
        // Before v4.31.0, private keys for accounts used as smart account keys
        // were derived. That's no longer the case. Importing private keys
        // does not generate smart accounts anymore.
        const shouldDerive = from >= SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET
        if (!shouldDerive) {
          this.#privateKeys
            .slice(from, to + 1)
            .forEach((privateKey) => keys.push(new Wallet(privateKey).address))
        }
      }

      if (this.#seedPhrase && baseWallet) {
        for (let i = from; i <= to; i++) {
          // Yield to the event loop every 2 derivations to keep UI responsive
          if (i > from && i % 2 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 0))
          }
          const path = getHdPathFromTemplate(hdPathTemplate, i)
          const wallet = baseWallet.derivePath(path)
          keys.push(wallet.address)
        }
      }
    }

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

      // Instead of parsing the seed individually for every child key (which executes pbkdf2),
      // we cache the base node beforehand and only extract standard children indexes.
      const baseWallet = this.#getBaseWallet()

      return acc.accountKeys.flatMap(({ index }: { index: number }, i) => {
        // In case it is a seed, the private keys have to be extracted
        if (this.subType === 'seed') {
          if (!this.#seedPhrase || !baseWallet) {
            // Should never happen
            console.error('keyIterator: no seed phrase provided')
            return []
          }

          const path = getHdPathFromTemplate(hdPathTemplate, index)
          const privateKey = baseWallet.derivePath(path).privateKey

          return [
            {
              addr: new Wallet(privateKey).address,
              type: 'internal' as const,
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
        // Before v4.31.0, private keys for accounts used as smart account keys
        // were derived. That's no longer the case. Importing private keys
        // does not generate smart accounts anymore.
        const isPrivateKeyThatShouldBeDerived = index >= SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET
        if (isPrivateKeyThatShouldBeDerived) {
          // Should never happen
          console.error(
            'keyIterator: since v4.31.0, private keys should not be derived and importing them does not retrieve a smart account'
          )
          return []
        }

        // The private key at position N in the list is served at index N
        const privateKey = this.#privateKeys[index]
        if (!privateKey) {
          // Should never happen
          console.error('keyIterator: no private key provided for index', index)
          return []
        }

        return [
          {
            addr: new Wallet(privateKey).address,
            type: 'internal' as const,
            label:
              getExistingKeyLabel(keystoreKeys, acc.account.addr, this.type) ||
              getDefaultKeyLabel(
                keystoreKeys.filter((key) => acc.account.associatedKeys.includes(key.addr)),
                0
              ),
            privateKey,
            dedicatedToOneSA: false,
            meta: {
              createdAt: new Date().getTime()
            }
          }
        ]
      })
    })
  }

  isSeedMatching(seedPhraseToCompareWith: string, passphraseToCompareWith: string | null): boolean {
    if (!this.#seedPhrase) return false
    if (
      passphraseToCompareWith !== undefined &&
      (passphraseToCompareWith ?? '') !== (this.#seedPassphrase ?? '')
    ) {
      return false
    }

    const baseWallet = this.#getBaseWallet()
    if (baseWallet) {
      const otherMnemonic = Mnemonic.fromPhrase(seedPhraseToCompareWith)
      return baseWallet.mnemonic?.phrase === otherMnemonic.phrase
    }

    return (
      Mnemonic.fromPhrase(this.#seedPhrase, this.#seedPassphrase).phrase ===
      Mnemonic.fromPhrase(seedPhraseToCompareWith).phrase
    )
  }
}
