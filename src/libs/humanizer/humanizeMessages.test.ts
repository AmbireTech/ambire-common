import { parseEther } from 'ethers'

import { beforeEach, describe, expect } from '@jest/globals'

import { Message, TypedMessageUserRequest } from '../../interfaces/userRequest'
import { ENTRY_POINT_AUTHORIZATION_REQUEST_ID } from '../userOperation/userOperation'
import { humanizeMessage } from './index'
import { cowSwapModule, erc20Module, erc721Module, permit2Module } from './messageModules'
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
  PermitTransferFrom: [
    {
      permitted: {
        token: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        amount: 2022432608n
      },
      spender: '0x1fa57f879417e029ef57d7ce915b0aa56a507c31',
      nonce: 144965843626974229045100328034567758130n,
      deadline: 1770952162
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
      fromRequestId: 'randomActionId',
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

    messageTemplate.content.message = typedMessages.erc20[0]!
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

    messageTemplate.content.message = typedMessages.erc721[0]!
    ;(
      messageTemplate.content as TypedMessageUserRequest['meta']['params']
    ).domain.verifyingContract = NFT_ADDRESS
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
    ;(messageTemplate.content as TypedMessageUserRequest['meta']['params']).types = {
      EIP712Domain: [],
      PermitSingle: [{ name: 'details', type: 'PermitDetails' }]
    }
    ;(
      messageTemplate.content as TypedMessageUserRequest['meta']['params']
    ).domain.verifyingContract = '0x000000000022d473030f116ddee9f6b43ac78ba3'
    messageTemplate.content.message = typedMessages.permit2[0]!
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
    ;(messageTemplate.content as TypedMessageUserRequest['meta']['params']).types = {
      EIP712Domain: [],
      PermitBatch: [{ name: 'details', type: 'PermitDetails[]' }]
    }
    ;(
      messageTemplate.content as TypedMessageUserRequest['meta']['params']
    ).domain.verifyingContract = '0x000000000022d473030f116ddee9f6b43ac78ba3'
    messageTemplate.content.message = typedMessages.permit2[1]!
    const { fullVisualization } = permit2Module(messageTemplate)
    expect(fullVisualization).toBeTruthy()
    compareVisualizations(fullVisualization!, expectedBatchVisualization)
  })

  test('permit2 module batch permit', () => {
    const expectedBatchVisualization = [
      getAction('Approve'),
      getAddressVisualization('0x1fa57f879417e029ef57d7ce915b0aa56a507c31'),
      getLabel('to use'),
      getToken('0xdac17f958d2ee523a2206206994597c13d831ec7', 2022432608n),
      getDeadline(1770952162n)
    ]
    ;(messageTemplate.content as TypedMessageUserRequest['meta']['params']).types = {
      EIP712Domain: [],
      PermitBatch: [{ name: 'details', type: 'TokenPermissions' }]
    }
    ;(
      messageTemplate.content as TypedMessageUserRequest['meta']['params']
    ).domain.verifyingContract = '0x000000000022d473030f116ddee9f6b43ac78ba3'
    messageTemplate.content.message = typedMessages.PermitTransferFrom[0]!
    const { fullVisualization } = permit2Module(messageTemplate)
    expect(fullVisualization).toBeTruthy()
    compareVisualizations(fullVisualization!, expectedBatchVisualization)
  })

  test('cowswap module sell order', () => {
    const accountAddr = '0xd8293ad21678c6f09da139b4b62d38e514a03b78'
    const sellToken = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
    const buyToken = '0x63706e401c06ac8513145b7687a14804d17f814b'
    const sellAmount = 934812n
    const buyAmount = 10404139468585152n
    const validTo = 1783581106n
    const expectedVisualization = [
      getAction('Place an order to Sell'),
      getToken(sellToken, sellAmount, 8453n),
      getLabel('for at least'),
      getToken(buyToken, buyAmount, 8453n),
      getDeadline(validTo)
    ]

    messageTemplate.accountAddr = accountAddr
    messageTemplate.chainId = 8453n
    ;(messageTemplate.content as TypedMessageUserRequest['meta']['params']).domain = {
      name: 'Gnosis Protocol',
      version: 'v2',
      chainId: 8453n,
      verifyingContract: '0x9008D19f58AAbD9eD0D60971565AA8510560ab41'
    }
    ;(messageTemplate.content as TypedMessageUserRequest['meta']['params']).types = {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' }
      ],
      Order: [
        { name: 'sellToken', type: 'address' },
        { name: 'buyToken', type: 'address' },
        { name: 'receiver', type: 'address' },
        { name: 'sellAmount', type: 'uint256' },
        { name: 'buyAmount', type: 'uint256' },
        { name: 'validTo', type: 'uint32' },
        { name: 'appData', type: 'bytes32' },
        { name: 'feeAmount', type: 'uint256' },
        { name: 'kind', type: 'string' },
        { name: 'partiallyFillable', type: 'bool' },
        { name: 'sellTokenBalance', type: 'string' },
        { name: 'buyTokenBalance', type: 'string' }
      ]
    }
    ;(messageTemplate.content as TypedMessageUserRequest['meta']['params']).primaryType = 'Order'
    messageTemplate.content.message = {
      sellToken,
      buyToken,
      sellAmount: sellAmount.toString(),
      buyAmount: buyAmount.toString(),
      validTo: Number(validTo),
      kind: 'sell',
      partiallyFillable: false,
      appData: '0x767a9774c9a589f88b23530486fb7d8836613b44a3e82e01ba1351e9c68584b2',
      receiver: accountAddr,
      feeAmount: '0',
      sellTokenBalance: 'erc20',
      buyTokenBalance: 'erc20'
    }

    const { fullVisualization } = cowSwapModule(messageTemplate)
    expect(fullVisualization).toBeTruthy()
    compareVisualizations(fullVisualization!, expectedVisualization)

    const irMessage = humanizeMessage(messageTemplate)
    compareVisualizations(irMessage.fullVisualization!, expectedVisualization)
  })

  test('cowswap module order cancellations', () => {
    const accountAddr = '0xd8293ad21678c6f09da139b4b62d38e514a03b78'
    const orderUid =
      '0x6ebba3d3f1ee5a04be5c4a6fd2e13bc3a8bbda2f8caae7b5e420ad8b99473242d8293ad21678c6f09da139b4b62d38e514a03b786a4f91c9'
    const validTo = BigInt('0x6a4f91c9')
    const expectedVisualization = [
      getAction('Cancel CowSwap order'),
      getLabel(`with order ID ${orderUid.slice(0, 8)}...${orderUid.slice(-6)}`),
      getDeadline(validTo)
    ]

    messageTemplate.accountAddr = accountAddr
    messageTemplate.chainId = 8453n
    ;(messageTemplate.content as TypedMessageUserRequest['meta']['params']).domain = {
      name: 'Gnosis Protocol',
      version: 'v2',
      chainId: 8453n,
      verifyingContract: '0x9008d19f58aabd9ed0d60971565aa8510560ab41'
    }
    ;(messageTemplate.content as TypedMessageUserRequest['meta']['params']).types = {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' }
      ],
      OrderCancellations: [{ name: 'orderUids', type: 'bytes[]' }]
    }
    ;(messageTemplate.content as TypedMessageUserRequest['meta']['params']).primaryType =
      'OrderCancellations'
    messageTemplate.content.message = { orderUids: [orderUid] }

    const { fullVisualization } = cowSwapModule(messageTemplate)
    expect(fullVisualization).toBeTruthy()
    compareVisualizations(fullVisualization!, expectedVisualization)

    const irMessage = humanizeMessage(messageTemplate)
    compareVisualizations(irMessage.fullVisualization!, expectedVisualization)
  })

  test('Entry point module', () => {
    messageTemplate.fromRequestId = ENTRY_POINT_AUTHORIZATION_REQUEST_ID
    const { fullVisualization: received } = entryPointModule(messageTemplate)
    const expected = [
      getAction('Authorize entry point'),
      getLabel('for'),
      getAddressVisualization(messageTemplate.accountAddr)
    ]
    compareVisualizations(expected, received!)
  })
})
