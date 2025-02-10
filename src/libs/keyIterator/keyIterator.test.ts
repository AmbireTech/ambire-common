import { Wallet } from 'ethers'

/* eslint-disable no-new */
import { describe, expect, test } from '@jest/globals'

import { BIP44_STANDARD_DERIVATION_TEMPLATE } from '../../consts/derivation'
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
})
