import { parseEther } from 'ethers'

import { beforeEach, describe, expect } from '@jest/globals'

import { TypedMessage } from '../../interfaces/userRequest'
import {
  erc20Module,
  erc721Module,
  fallbackEIP712Humanizer,
  permit2Module
} from './typedMessageModules'

const address1 = '0x6942069420694206942069420694206942069420'
const address2 = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa'
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

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
      { type: 'action', content: 'Send' },
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
        address: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
        name: 'Permit 2 contract'
      },
      { type: 'label', content: 'to use' },
      {
        type: 'token',
        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        amount: 1000000000000000000n
      },
      { type: 'label', content: 'for time period' },
      { type: 'deadline', amount: 968187600000n },
      { type: 'label', content: 'this whole signatuere' },
      { type: 'deadline', amount: 968187600000n }
    ]
    tmTemplate.types = { PermitSingle: [{ name: 'details', type: 'PermitDetails' }] }
    tmTemplate.domain.verifyingContract = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
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
        address: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
        name: 'Permit 2 contract'
      },
      { type: 'label', content: 'to use' },
      {
        type: 'token',
        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
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
        address: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
        name: 'Permit 2 contract'
      },
      { type: 'label', content: 'to use' },
      {
        type: 'token',
        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        amount: 500000000000000000n
      },
      { type: 'label', content: 'for time period' },
      { type: 'deadline', amount: 969187600000n },
      { type: 'label', content: 'this whole signatuere' },
      { type: 'deadline', amount: 968187600000n }
    ]
    tmTemplate.types = { PermitBatch: [{ name: 'details', type: 'PermitDetails[]' }] }
    tmTemplate.domain.verifyingContract = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
    tmTemplate.message = typedMessages.permit2[1]
    const { fullVisualization } = permit2Module(tmTemplate)
    expect(fullVisualization?.length).toEqual(expectedBatchVisualization.length)
    expectedBatchVisualization.forEach((v, i) => {
      expect(v).toEqual(fullVisualization?.[i])
    })
  })
  test('fallback module', () => {
    tmTemplate.message = typedMessages.fallback[0]
    const expectedVisualizationContent = [
      'from: \n',
      ' name: A\n',
      ' address: 0x6942069420694206942069420694206942069420\n',
      'to: \n',
      ' name: B\n',
      ' address: 0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa\n',
      'subject: angry mail\n',
      'withRegards: false\n'
    ]

    const { fullVisualization } = fallbackEIP712Humanizer(tmTemplate)
    expect(expectedVisualizationContent.length).toEqual(fullVisualization?.length)
    fullVisualization?.map((v, i) => expect(v.content).toEqual(expectedVisualizationContent[i]))
  })
})
