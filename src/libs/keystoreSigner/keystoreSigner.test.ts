import { computeAddress, concat, getBytes, hexlify, Wallet } from 'ethers'
import { ecdsaRecover } from 'secp256k1'

/* eslint-disable no-new */
import { describe, expect, test } from '@jest/globals'

import { EIP_7702_AMBIRE_ACCOUNT } from '../../consts/deploy'
import { BIP44_STANDARD_DERIVATION_TEMPLATE } from '../../consts/derivation'
import { Key } from '../../interfaces/keystore'
import { getPrivateKeyFromSeed } from '../keyIterator/keyIterator'
import { getAuthorizationHash } from '../signMessage/signMessage'
import { KeystoreSigner } from './keystoreSigner'

const privKey = getPrivateKeyFromSeed(
  process.env.SEED,
  null,
  199,
  BIP44_STANDARD_DERIVATION_TEMPLATE
)
const keyPublicAddress = new Wallet(privKey).address

const key: Key = {
  addr: keyPublicAddress,
  type: 'internal',
  label: 'Key 1',
  dedicatedToOneSA: true,
  isExternallyStored: false,
  meta: {
    createdAt: new Date().getTime()
  }
}

describe('KeystoreSigner', () => {
  test('should initialize KeystoreSigner', () => {
    expect.assertions(3)
    const signer = new KeystoreSigner(key, privKey)
    expect((signer as any)['#signer']).toBe(undefined)
    expect((signer as any).key?.addr).toEqual(keyPublicAddress)
    expect((signer as any).key?.type).toEqual('internal')
  })
  test('should sign transaction', async () => {
    expect.assertions(1)
    const signer = new KeystoreSigner(key, privKey)
    const transactionRequest = {
      type: null,
      to: '0x5C657c725928FF3108bD98aAFB587592b3c94681',
      from: keyPublicAddress,
      nonce: 0,
      gasLimit: '200000',
      gasPrice: '1000000000',
      maxPriorityFeePerGas: '1500000000',
      maxFeePerGas: '2000000000',
      data: '0xabcdef',
      value: '1000000000000000000',
      chainId: 1,
      accessList: null,
      customData: {},
      blockTag: 'latest',
      enableCcipRead: false
    }
    const res = await signer.signRawTransaction(transactionRequest)
    expect(res).toMatch(/^0x/)
  })
  test('should sign typed data', async () => {
    expect.assertions(1)
    const signer = new KeystoreSigner(key, privKey)
    const res = await signer.signTypedData({
      kind: 'typedMessage',
      domain: {
        name: 'TestContract',
        version: '1',
        chainId: 1,
        verifyingContract: '0x1234567890abcdef1234567890abcdef12345678'
      },
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' }
        ],
        Person: [
          { name: 'name', type: 'string' },
          { name: 'age', type: 'uint256' }
        ]
      },
      message: {
        name: 'Alice',
        age: 30
      },
      primaryType: 'Person'
    })
    expect(res).toMatch(/^0x/)
  })
  test('should sign message', async () => {
    expect.assertions(1)
    const signer = new KeystoreSigner(key, privKey)
    // message = 'test'
    const res = await signer.signMessage('0x74657374')
    expect(res).toMatch(/^0x/)
  })
})

describe('Sign eip-7702 authorization', () => {
  it('should sign successfully', async () => {
    const hash = getAuthorizationHash(1n, EIP_7702_AMBIRE_ACCOUNT, 0n)
    const signer = new KeystoreSigner(key, privKey)
    const signature = signer.sign7702(hash)

    expect(signature.yParity === '0x00' || signature.yParity === '0x01').toBe(true)
    expect(signature.r.length).toBe(66)
    expect(signature.s.length).toBe(66)

    // r,s concatenated
    const rsSig = getBytes(concat([signature.r, signature.s]))

    // recover the public key
    const publicKey = ecdsaRecover(rsSig, Number(BigInt(signature.yParity)), getBytes(hash))

    const originalAddr = computeAddress(privKey)
    const derivedAddr = computeAddress(hexlify(publicKey))
    expect(derivedAddr).toBe(originalAddr)
  })
})
