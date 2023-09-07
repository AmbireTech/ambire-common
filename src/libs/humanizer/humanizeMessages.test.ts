import { expect, describe, beforeEach } from '@jest/globals'
import { parseEther } from 'ethers'
import { TypedMessage } from '../../interfaces/userRequest'
import { erc20Module, erc721Module } from './typedMessageModules'
// export interface TypedMessage {
//     kind: 'typedMessage'
//     domain: TypedDataDomain
//     types: Record<string, Array<TypedDataField>>
//     message: Record<string, any>
//     primaryType?: string
//   }
const address1 = '0x6942069420694206942069420694206942069420'
const address2 = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa'
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

const typedMessages = {
  erc20: [
    {
      owner: address1,
      spender: address2,
      value: parseEther('1'),
      nonce: 1,
      deadline: 968187600n
    }
  ],

  erc721: [
    {
      spender: address2,
      tokenId: 1n,
      nonce: 1,
      deadline: 968187600n
    }
  ]
}

const tmTemplate: TypedMessage = {
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
    tmTemplate.message = {}
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
    const visualization = erc20Module(tmTemplate)
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
    const visualization = erc721Module(tmTemplate)
    expect(expectedVisualization.length).toEqual(visualization.length)
    visualization.forEach((v, i) => expect(v).toMatchObject(expectedVisualization[i]))
  })
})
