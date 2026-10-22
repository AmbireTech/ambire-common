import { Wallet } from 'ethers'

import { describe, expect, jest, test } from '@jest/globals'

import {
  BIP44_STANDARD_DERIVATION_TEMPLATE,
  SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET
} from '../../consts/derivation'
import { SelectedAccountForImport } from '../../interfaces/account'
import { getBasicAccount } from '../account/account'
import { getPrivateKeyFromSeed, KeyIterator } from './keyIterator'

const seedPhrasePublicAddress1 = new Wallet(
  getPrivateKeyFromSeed(process.env.SEED, null, 0, BIP44_STANDARD_DERIVATION_TEMPLATE)
).address
const seedPhrasePublicAddress2 = new Wallet(
  getPrivateKeyFromSeed(process.env.SEED, null, 1, BIP44_STANDARD_DERIVATION_TEMPLATE)
).address
const seedPhrasePublicAddress3 = new Wallet(
  getPrivateKeyFromSeed(process.env.SEED, null, 2, BIP44_STANDARD_DERIVATION_TEMPLATE)
).address

const privKey150 = getPrivateKeyFromSeed(
  process.env.SEED,
  null,
  149,
  BIP44_STANDARD_DERIVATION_TEMPLATE
)
const seedPhrasePublicAddress150 = new Wallet(privKey150).address

const bulkPrivateKeys = [0, 1, 2].map((index) =>
  getPrivateKeyFromSeed(process.env.SEED, null, index, BIP44_STANDARD_DERIVATION_TEMPLATE)
)
const bulkAddresses = bulkPrivateKeys.map((privateKey) => new Wallet(privateKey).address)

const getSelectedAccountForImport = (addr: string, index: number): SelectedAccountForImport => ({
  account: getBasicAccount(addr, []),
  isLinked: false,
  accountKeys: [{ addr, index, slot: index + 1 }]
})

describe('KeyIterator', () => {
  test('should initialize keyIterator', () => {
    expect.assertions(2)
    const keyIteratorWithPrivKey = new KeyIterator(privKey150)
    expect((keyIteratorWithPrivKey as any)['#privateKey']).toBe(undefined)
    expect((keyIteratorWithPrivKey as any)['#seedPhrase']).toBe(undefined)
  })
  test('should fail initializing keyIterator', async () => {
    expect.assertions(1)
    try {
      new KeyIterator(`${process.env.SEED}invalid-seed-phrase`)
    } catch (e) {
      // @ts-ignore
      expect(e.message).toBe('keyIterator: invalid argument provided to constructor')
    }
  })
  test('should retrieve a single key', async () => {
    expect.assertions(2)
    const keyIteratorWithPrivKey = new KeyIterator(privKey150)
    const keys = await keyIteratorWithPrivKey.retrieve(
      [{ from: 0, to: 9 }],
      BIP44_STANDARD_DERIVATION_TEMPLATE
    )
    expect(keys).toHaveLength(1)
    expect(keys?.[0]).toEqual(seedPhrasePublicAddress150)
  })
  test('should retrieve first 10 keys', async () => {
    expect.assertions(2)
    const keyIteratorWithPrivKey = new KeyIterator(process.env.SEED)
    const keys = await keyIteratorWithPrivKey.retrieve(
      [{ from: 0, to: 9 }],
      BIP44_STANDARD_DERIVATION_TEMPLATE
    )
    expect(keys).toHaveLength(10)
    expect(keys?.[0]).toEqual(seedPhrasePublicAddress1)
  })
  test('should fail retrieving', async () => {
    expect.assertions(1)
    try {
      const keyIteratorWithPrivKey = new KeyIterator(privKey150)
      // @ts-ignore
      await keyIteratorWithPrivKey.retrieve([{ from: 0 }])
    } catch (e) {
      // @ts-ignore
      expect(e.message).toBe('keyIterator: invalid or missing arguments')
    }
  })
  test('should retrieve the correct addresses with BIP-44 derivation path', async () => {
    expect.assertions(3)
    const keyIteratorWithPrivKey = new KeyIterator(process.env.SEED)
    const keys = await keyIteratorWithPrivKey.retrieve(
      [{ from: 0, to: 2 }],
      BIP44_STANDARD_DERIVATION_TEMPLATE
    )

    expect(keys?.[0]).toEqual(seedPhrasePublicAddress1)
    expect(keys?.[1]).toEqual(seedPhrasePublicAddress2)
    expect(keys?.[2]).toEqual(seedPhrasePublicAddress3)
  })
  test('should not serve the single private key on indexes other than 0', async () => {
    const keyIteratorWithPrivKey = new KeyIterator(privKey150)
    const keys = await keyIteratorWithPrivKey.retrieve(
      [{ from: 1, to: 1 }],
      BIP44_STANDARD_DERIVATION_TEMPLATE
    )
    expect(keys).toEqual([])
  })

  describe('bulk private keys', () => {
    test('should initialize with a list of private keys', () => {
      const keyIterator = new KeyIterator(bulkPrivateKeys)
      expect(keyIterator.subType).toBe('private-key')
    })
    test('should fail initializing with an empty list', () => {
      expect(() => new KeyIterator([])).toThrow(
        'keyIterator: no private key or seed phrase provided'
      )
    })
    test('should fail initializing if any of the private keys is invalid', () => {
      expect(() => new KeyIterator([...bulkPrivateKeys, 'not-a-private-key'])).toThrow(
        'keyIterator: invalid argument provided to constructor'
      )
    })
    test('should fail initializing with a seed phrase in the list', () => {
      expect(() => new KeyIterator([bulkPrivateKeys[0]!, process.env.SEED!])).toThrow(
        'keyIterator: invalid argument provided to constructor'
      )
    })
    test('should retrieve the address of every private key in order', async () => {
      const keyIterator = new KeyIterator(bulkPrivateKeys)
      const keys = await keyIterator.retrieve(
        [{ from: 0, to: 9 }],
        BIP44_STANDARD_DERIVATION_TEMPLATE
      )
      expect(keys).toEqual(bulkAddresses)
    })
    test('should retrieve only the addresses in the requested range (paging)', async () => {
      const keyIterator = new KeyIterator(bulkPrivateKeys)
      const firstPage = await keyIterator.retrieve(
        [{ from: 0, to: 1 }],
        BIP44_STANDARD_DERIVATION_TEMPLATE
      )
      const secondPage = await keyIterator.retrieve(
        [{ from: 2, to: 3 }],
        BIP44_STANDARD_DERIVATION_TEMPLATE
      )
      const pageAfterTheLastKey = await keyIterator.retrieve(
        [{ from: 4, to: 5 }],
        BIP44_STANDARD_DERIVATION_TEMPLATE
      )
      expect(firstPage).toEqual([bulkAddresses[0], bulkAddresses[1]])
      expect(secondPage).toEqual([bulkAddresses[2]])
      expect(pageAfterTheLastKey).toEqual([])
    })
    test('should not retrieve smart account key indexes', async () => {
      const keyIterator = new KeyIterator(bulkPrivateKeys)
      const keys = await keyIterator.retrieve(
        [
          {
            from: SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET,
            to: SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET + 2
          }
        ],
        BIP44_STANDARD_DERIVATION_TEMPLATE
      )
      expect(keys).toEqual([])
    })
    test('should drop duplicates, regardless of 0x prefix, case or whitespace', async () => {
      const [firstKey, secondKey] = bulkPrivateKeys as [string, string]
      const keyIterator = new KeyIterator([
        firstKey,
        firstKey.slice(2),
        ` ${firstKey.toUpperCase().replace('0X', '0x')} `,
        secondKey
      ])
      const keys = await keyIterator.retrieve(
        [{ from: 0, to: 9 }],
        BIP44_STANDARD_DERIVATION_TEMPLATE
      )
      expect(keys).toEqual([bulkAddresses[0], bulkAddresses[1]])
    })
    test('should return the matching private key for every selected account', () => {
      const keyIterator = new KeyIterator(bulkPrivateKeys)
      const selectedAccounts = [
        getSelectedAccountForImport(bulkAddresses[2]!, 2),
        getSelectedAccountForImport(bulkAddresses[0]!, 0)
      ]
      const internalKeys = keyIterator.retrieveInternalKeys(
        selectedAccounts,
        BIP44_STANDARD_DERIVATION_TEMPLATE,
        []
      )

      expect(internalKeys).toHaveLength(2)
      internalKeys.forEach((internalKey) => {
        // The returned private key must always belong to the returned address
        expect(new Wallet(internalKey.privateKey).address).toBe(internalKey.addr)
        expect(internalKey.type).toBe('internal')
        expect(internalKey.dedicatedToOneSA).toBe(false)
      })
      expect(internalKeys.map(({ addr }) => addr)).toEqual([bulkAddresses[2], bulkAddresses[0]])
    })
    test('should not return a private key for an index outside of the list', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
      const keyIterator = new KeyIterator(bulkPrivateKeys)
      const internalKeys = keyIterator.retrieveInternalKeys(
        [
          getSelectedAccountForImport(bulkAddresses[0]!, 3),
          getSelectedAccountForImport(bulkAddresses[0]!, SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET)
        ],
        BIP44_STANDARD_DERIVATION_TEMPLATE,
        []
      )
      expect(internalKeys).toEqual([])
      expect(consoleErrorSpy).toHaveBeenCalledTimes(2)
      consoleErrorSpy.mockRestore()
    })
  })
})
