import { parseEther } from 'ethers'

import { beforeEach, describe, expect } from '@jest/globals'

import { TypedMessage } from '../../interfaces/userRequest'
import { erc20Module, erc721Module, permit2Module } from './typedMessageModules'

const address1 = '0x6942069420694206942069420694206942069420'
const address2 = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const WETH_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'

const typedMessages = {
  erc20: [
    {
      owner: address1,
      spender: address2,
      value: parseEther('1'),
      nonce: 1n,
      deadline: 968187600n
    }
  ],

  erc721: [
    {
      spender: address2,
      tokenId: 1n,
      nonce: 1n,
      deadline: 968187600n
    }
  ],
  permit2: [
    // permit single
    {
      details: {
        token: WETH_ADDRESS,
        amount: parseEther('1'),
        expiration: 968187600n,
        nonce: 1n
      },
      spender: address2,
      sigDeadline: 968187600n
    },
    // batch permit
    {
      details: [
        {
          token: WETH_ADDRESS,
          amount: parseEther('1'),
          expiration: 968187600n,
          nonce: 1n
        },
        {
          token: WETH_ADDRESS,
          amount: parseEther('0.5'),
          expiration: 969187600n,
          nonce: 2n
        }
      ],
      spender: address2,
      sigDeadline: 968187600n
    }
  ],
  fallback: [
    {
      from: {
        name: 'A',
        address: address1
      },
      to: {
        name: 'B',
        address: address2
      },
      subject: 'angry mail',
      withRegards: false
    }
  ]
}

let tmTemplate: TypedMessage = {
  kind: 'typedMessage',
  domain: {
    name: 'random contract',
    version: '1',
    chainId: 1n,
    verifyingContract: WETH_ADDRESS,
    salt: '1'
  },
  types: { Permit: [] },
  message: {},
  primaryType: 'Permit'
}
describe('typed message tests', () => {
  beforeEach(() => {
    tmTemplate = {
      kind: 'typedMessage',
      domain: {
        name: 'random contract',
        version: '1',
        chainId: 1n,
        verifyingContract: WETH_ADDRESS,
        salt: '1'
      },
      types: { Permit: [] },
      message: {},
      primaryType: 'Permit'
    }
  })
  test('erc20 module', () => {
    const expectedVisualization = [
      { type: 'action', content: 'Grant approval' },
      { type: 'label', content: 'for' },
      {
        type: 'token',
        address: WETH_ADDRESS
      },
      { type: 'label', content: 'to' },
      {
        type: 'address',
        address: address2
      },
      { type: 'deadline', amount: 968187600000n }
    ]

    tmTemplate.message = typedMessages.erc20[0]
    const { fullVisualization } = erc20Module(tmTemplate)
    expect(expectedVisualization.length).toEqual(fullVisualization?.length)
    fullVisualization?.forEach((v, i) => expect(v).toMatchObject(expectedVisualization[i]))
  })
  test('erc721 module', () => {
    const expectedVisualization = [
      { type: 'action', content: 'Permit use of' },
      {
        type: 'nft',
        address: WETH_ADDRESS
      },
      { type: 'label', content: 'to' },
      {
        type: 'address',
        address: address2
      },
      { type: 'deadline', amount: 968187600000n }
    ]

    tmTemplate.message = typedMessages.erc721[0]
    const { fullVisualization } = erc721Module(tmTemplate)
    expect(expectedVisualization.length).toEqual(fullVisualization?.length)
    fullVisualization?.forEach((v, i) => expect(v).toMatchObject(expectedVisualization[i]))
  })

  test('permit2 single module', () => {
    const expectedSingleVisualization = [
      { type: 'action', content: 'Permit' },
      {
        type: 'address',
        address: '0x000000000022d473030f116ddee9f6b43ac78ba3'
      },
      { type: 'label', content: 'to use' },
      {
        type: 'token',
        address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        amount: 1000000000000000000n
      },
      { type: 'label', content: 'for time period' },
      { type: 'deadline', amount: 968187600000n },
      { type: 'label', content: 'this whole signatuere' },
      { type: 'deadline', amount: 968187600000n }
    ]
    tmTemplate.types = { PermitSingle: [{ name: 'details', type: 'PermitDetails' }] }
    tmTemplate.domain.verifyingContract = '0x000000000022d473030f116ddee9f6b43ac78ba3'
    tmTemplate.message = typedMessages.permit2[0]
    const { fullVisualization } = permit2Module(tmTemplate)
    expect(expectedSingleVisualization.length).toEqual(fullVisualization?.length)
    fullVisualization?.forEach((v, i) => expect(v).toMatchObject(expectedSingleVisualization[i]))
  })

  test('permit2 module batch permit', () => {
    const expectedBatchVisualization = [
      { type: 'label', content: 'Permit #1' },
      { type: 'action', content: 'Permit' },
      {
        type: 'address',
        address: '0x000000000022d473030f116ddee9f6b43ac78ba3'
      },
      { type: 'label', content: 'to use' },
      {
        type: 'token',
        address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        amount: 1000000000000000000n
      },
      { type: 'label', content: 'for time period' },
      { type: 'deadline', amount: 968187600000n },
      { type: 'label', content: 'this whole signatuere' },
      { type: 'deadline', amount: 968187600000n },
      { type: 'label', content: 'Permit #2' },
      { type: 'action', content: 'Permit' },
      {
        type: 'address',
        address: '0x000000000022d473030f116ddee9f6b43ac78ba3'
      },
      { type: 'label', content: 'to use' },
      {
        type: 'token',
        address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        amount: 500000000000000000n
      },
      { type: 'label', content: 'for time period' },
      { type: 'deadline', amount: 969187600000n },
      { type: 'label', content: 'this whole signatuere' },
      { type: 'deadline', amount: 968187600000n }
    ]
    tmTemplate.types = { PermitBatch: [{ name: 'details', type: 'PermitDetails[]' }] }
    tmTemplate.domain.verifyingContract = '0x000000000022d473030f116ddee9f6b43ac78ba3'
    tmTemplate.message = typedMessages.permit2[1]
    const { fullVisualization } = permit2Module(tmTemplate)
    expect(fullVisualization?.length).toEqual(expectedBatchVisualization.length)
    expectedBatchVisualization.forEach((v, i) => {
      expect(fullVisualization?.[i]).toMatchObject(v)
    })
  })
})
