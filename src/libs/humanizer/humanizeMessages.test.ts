import { parseEther } from 'ethers'

import { beforeEach, describe, expect } from '@jest/globals'

import { Message, TypedMessage } from '../../interfaces/userRequest'
import { ENTRY_POINT_AUTHORIZATION_REQUEST_ID } from '../userOperation/userOperation'
import { erc20Module, erc721Module, permit2Module } from './messageModules'
import { entryPointModule } from './messageModules/entryPointModule'
import { compareVisualizations } from './testHelpers'
import { getAction, getAddressVisualization, getDeadline, getLabel, getToken } from './utils'

const address1 = '0x6942069420694206942069420694206942069420'
const address2 = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const WETH_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const NFT_ADDRESS = '0x026224A2940bFE258D0dbE947919B62fE321F042'
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

let messageTemplate: Message
describe('typed message tests', () => {
  beforeEach(() => {
    messageTemplate = {
      fromActionId: 'randomActionId',
      accountAddr: address1,
      chainId: 1n,
      signature: null,
      content: {
        kind: 'typedMessage',
        domain: {
          name: 'random contract',
          version: '1',
          chainId: 1n,
          verifyingContract: WETH_ADDRESS,
          salt: '1'
        },
        types: { EIP712Domain: [], Permit: [] },
        message: {},
        primaryType: 'Permit'
      }
    }
  })
  test('erc20 module', () => {
    const expectedVisualization = [
      getAction('Grant approval'),
      getLabel('for'),
      getToken(WETH_ADDRESS, 1000000000000000000n),
      getLabel('to'),
      getAddressVisualization(address2),
      getDeadline(968187600n)
    ]

    messageTemplate.content.message = typedMessages.erc20[0]
    const { fullVisualization } = erc20Module(messageTemplate)
    expect(fullVisualization).toBeTruthy()
    compareVisualizations(fullVisualization!, expectedVisualization)
  })
  test('erc721 module', () => {
    const expectedVisualization = [
      getAction('Permit use of'),
      getToken(NFT_ADDRESS, 1n),
      getLabel('to'),
      getAddressVisualization(address2),
      getDeadline(968187600n)
    ]

    messageTemplate.content.message = typedMessages.erc721[0]
    ;(messageTemplate.content as TypedMessage).domain.verifyingContract = NFT_ADDRESS
    const { fullVisualization } = erc721Module(messageTemplate)
    expect(fullVisualization).toBeTruthy()
    compareVisualizations(fullVisualization!, expectedVisualization)
  })

  test('permit2 single module', () => {
    const expectedSingleVisualization = [
      getAction('Approve'),
      getAddressVisualization(address2),
      getLabel('to use'),
      getToken(WETH_ADDRESS, 1000000000000000000n),
      getDeadline(968187600n)
    ]
    ;(messageTemplate.content as TypedMessage).types = {
      EIP712Domain: [],
      PermitSingle: [{ name: 'details', type: 'PermitDetails' }]
    }
    ;(messageTemplate.content as TypedMessage).domain.verifyingContract =
      '0x000000000022d473030f116ddee9f6b43ac78ba3'
    messageTemplate.content.message = typedMessages.permit2[0]
    const { fullVisualization } = permit2Module(messageTemplate)
    expect(fullVisualization).toBeTruthy()
    compareVisualizations(fullVisualization!, expectedSingleVisualization)
  })

  test('permit2 module batch permit', () => {
    const expectedBatchVisualization = [
      getAction('Approve'),
      getAddressVisualization(address2),
      getLabel('to use'),
      getToken(WETH_ADDRESS, 1000000000000000000n),
      getLabel('and'),
      getAddressVisualization(address2),
      getLabel('to use'),
      getToken(WETH_ADDRESS, 500000000000000000n),
      getDeadline(968187600n)
    ]
    ;(messageTemplate.content as TypedMessage).types = {
      EIP712Domain: [],
      PermitBatch: [{ name: 'details', type: 'PermitDetails[]' }]
    }
    ;(messageTemplate.content as TypedMessage).domain.verifyingContract =
      '0x000000000022d473030f116ddee9f6b43ac78ba3'
    messageTemplate.content.message = typedMessages.permit2[1]
    const { fullVisualization } = permit2Module(messageTemplate)
    expect(fullVisualization).toBeTruthy()
    compareVisualizations(fullVisualization!, expectedBatchVisualization)
  })

  test('Entry point module', () => {
    messageTemplate.fromActionId = ENTRY_POINT_AUTHORIZATION_REQUEST_ID
    const { fullVisualization: received } = entryPointModule(messageTemplate)
    const expected = [
      getAction('Authorize entry point'),
      getLabel('for'),
      getAddressVisualization(messageTemplate.accountAddr)
    ]
    compareVisualizations(expected, received!)
  })
})
