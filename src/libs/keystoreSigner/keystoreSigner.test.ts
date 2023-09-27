import { Key } from 'libs/keystore/keystore'

/* eslint-disable no-new */
import { describe, expect, test } from '@jest/globals'

import { KeystoreSigner } from './keystoreSigner'

// const seedPhrase = 'brisk rich glide impose category stuff company you appear remain decorate monkey'
const privKey = '0x574f261b776b26b1ad75a991173d0e8ca2ca1d481bd7822b2b58b2ef8a969f12'
const keyPublicAddress = '0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7'

const key: Key = {
  id: keyPublicAddress,
  type: 'internal',
  label: 'test-key',
  isExternallyStored: false,
  meta: null
}

describe('KeystoreSigner', () => {
  test('should initialize KeystoreSigner', () => {
    expect.assertions(2)
    const signer = new KeystoreSigner(key, privKey)
    expect((signer as any)['#signer']).toBe(undefined)
    expect((signer as any).key?.id).toEqual(keyPublicAddress)
  })
  test('should sign transaction', async () => {
    expect.assertions(1)
    const signer = new KeystoreSigner(key, privKey)
    const transactionRequest = {
      type: null,
      to: '0x5C657c725928FF3108bD98aAFB587592b3c94681',
      from: '0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7',
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
        Person: [
          { name: 'name', type: 'string' },
          { name: 'age', type: 'uint256' }
        ]
      },
      message: {
        name: 'Alice',
        age: 30
      }
    })
    expect(res).toMatch(/^0x/)
  })
  test('should sign message', async () => {
    expect.assertions(1)
    const signer = new KeystoreSigner(key, privKey)
    const res = await signer.signMessage('test')
    expect(res).toMatch(/^0x/)
  })
})
