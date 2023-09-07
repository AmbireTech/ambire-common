import { expect, describe, beforeEach } from '@jest/globals'
import { parseEther } from 'ethers'
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
      { type: 'action', content: 'Sign permit' },
      { type: 'label', content: 'to' },
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
      { type: 'label', content: 'already expired' }
    ]

    tmTemplate.message = typedMessages.erc20[0]
    const visualization = erc20Module(tmTemplate)[0]
    expect(expectedVisualization.length).toEqual(visualization.length)
    visualization.forEach((v, i) => expect(v).toMatchObject(expectedVisualization[i]))
  })
  test('erc721 module', () => {
    const expectedVisualization = [
      { type: 'action', content: 'Sign permit' },
      { type: 'label', content: 'to' },
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
      { type: 'label', content: 'already expired' }
    ]

    tmTemplate.message = typedMessages.erc721[0]
    const visualization = erc721Module(tmTemplate)[0]
    expect(expectedVisualization.length).toEqual(visualization.length)
    visualization.forEach((v, i) => expect(v).toMatchObject(expectedVisualization[i]))
  })

  test('permit2 single module', () => {
    const expectedSingleVisualization = [
      { type: 'action', content: 'Permit' },
      {
        type: 'address',
        address: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
        name: 'Permi 2 contract'
      },
      { type: 'label', content: 'to use' },
      {
        type: 'token',
        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        amount: 1000000000000000000n
      },
      { type: 'label', content: 'for time period' },
      { type: 'label', content: 'already expired' },
      { type: 'label', content: 'this whole signatuere' },
      { type: 'label', content: 'already expired' }
    ]
    tmTemplate.types = { PermitSingle: [{ name: 'details', type: 'PermitDetails' }] }
    tmTemplate.domain.verifyingContract = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
    tmTemplate.message = typedMessages.permit2[0]
    const visualization = permit2Module(tmTemplate)[0]
    expect(expectedSingleVisualization.length).toEqual(visualization.length)
    visualization.forEach((v, i) => expect(v).toMatchObject(expectedSingleVisualization[i]))
  })

  test('permit2 module batch permit', () => {
    const expectedBatchVisualization = [
      [
        { type: 'action', content: 'Permit' },
        {
          type: 'address',
          address: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
          name: 'Permi 2 contract'
        },
        { type: 'label', content: 'to use' },
        {
          type: 'token',
          address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          amount: 1000000000000000000n
        },
        { type: 'label', content: 'for time period' },
        { type: 'label', content: 'already expired' },
        { type: 'label', content: 'this whole signatuere' },
        { type: 'label', content: 'already expired' }
      ],
      [
        { type: 'action', content: 'Permit' },
        {
          type: 'address',
          address: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
          name: 'Permi 2 contract'
        },
        { type: 'label', content: 'to use' },
        {
          type: 'token',
          address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          amount: 500000000000000000n
        },
        { type: 'label', content: 'for time period' },
        { type: 'label', content: 'already expired' },
        { type: 'label', content: 'this whole signatuere' },
        { type: 'label', content: 'already expired' }
      ]
    ]
    tmTemplate.types = { PermitBatch: [{ name: 'details', type: 'PermitDetails[]' }] }
    tmTemplate.domain.verifyingContract = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
    tmTemplate.message = typedMessages.permit2[1]
    const visualization = permit2Module(tmTemplate)
    console.log(visualization)
    expectedBatchVisualization.forEach((ev, i) => {
      expect(ev.length).toEqual(visualization[i].length)
      ev.forEach((v, j) => {
        console.log(v, ev[j])
        expect(v).toEqual(visualization[i][j])
      })
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

    const visualization = fallbackEIP712Humanizer(tmTemplate)
    expect(expectedVisualizationContent.length).toEqual(visualization[0].length)
    visualization[0].map((v, i) => expect(v.content).toEqual(expectedVisualizationContent[i]))
  })
})
