import { hexlify, MaxUint256, parseEther, toUtf8Bytes } from 'ethers'

import { beforeEach, describe, expect } from '@jest/globals'

import { Message, TypedMessageUserRequest } from '../../interfaces/userRequest'
import { ENTRY_POINT_AUTHORIZATION_REQUEST_ID } from '../userOperation/userOperation'
import { humanizeMessage } from './index'
import { getTypedMessageHumanizer } from './messageModules'
import { compareVisualizations } from './testHelpers'
import { getAction, getAddressVisualization, getDeadline, getLabel, getToken } from './utils'

const address1 = '0x6942069420694206942069420694206942069420'
const address2 = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const address3 = '0xcccccccccccccccccccccccccccccccccccccccc'
const WETH_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const NFT_ADDRESS = '0x026224A2940bFE258D0dbE947919B62fE321F042'
const DAI_ADDRESS = '0x6b175474e89094c44da98b954eedeac495271d0f'
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

  daiPermit: [
    // grant with expiry
    {
      holder: address1,
      spender: address2,
      nonce: 1n,
      expiry: 968187600n,
      allowed: true
    },
    // grant without expiry (0 means the permit never expires)
    {
      holder: address1,
      spender: address2,
      nonce: 1n,
      expiry: 0n,
      allowed: true
    },
    // revoke
    {
      holder: address1,
      spender: address2,
      nonce: 1n,
      expiry: 968187600n,
      allowed: false
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
  PermitWitnessTransferFrom: [
    // witness with an explicit recipient
    {
      permitted: {
        token: WETH_ADDRESS,
        amount: parseEther('1')
      },
      spender: address2,
      nonce: 1n,
      deadline: 968187600n,
      witness: {
        recipient: address3,
        orderId: 1n
      }
    },
    // witness with a zero recipient - anyone who submits the transfer picks the receiver
    {
      permitted: {
        token: WETH_ADDRESS,
        amount: parseEther('1')
      },
      spender: address2,
      nonce: 1n,
      deadline: 968187600n,
      witness: {
        recipient: '0x0000000000000000000000000000000000000000',
        orderId: 1n
      }
    },
    // batch witness without a recipient field
    {
      permitted: [
        {
          token: WETH_ADDRESS,
          amount: parseEther('1')
        },
        {
          token: DAI_ADDRESS,
          amount: parseEther('0.5')
        }
      ],
      spender: address2,
      nonce: 1n,
      deadline: 968187600n,
      witness: {
        orderId: 1n
      }
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

const ERC2612_PERMIT_FIELDS = [
  { name: 'owner', type: 'address' },
  { name: 'spender', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'nonce', type: 'uint256' },
  { name: 'deadline', type: 'uint256' }
]
const DAI_PERMIT_FIELDS = [
  { name: 'holder', type: 'address' },
  { name: 'spender', type: 'address' },
  { name: 'nonce', type: 'uint256' },
  { name: 'expiry', type: 'uint256' },
  { name: 'allowed', type: 'bool' }
]

const ERC721_PERMIT_FIELDS = [
  { name: 'spender', type: 'address' },
  { name: 'tokenId', type: 'uint256' },
  { name: 'nonce', type: 'uint256' },
  { name: 'deadline', type: 'uint256' }
]
const PERMIT2_TOKEN_PERMISSIONS_FIELDS = [
  { name: 'token', type: 'address' },
  { name: 'amount', type: 'uint256' }
]
const PERMIT2_EXAMPLE_WITNESS_FIELDS = [
  { name: 'recipient', type: 'address' },
  { name: 'orderId', type: 'uint256' }
]
const getPermit2WitnessTransferFields = (permittedType: string) => [
  { name: 'permitted', type: permittedType },
  { name: 'spender', type: 'address' },
  { name: 'nonce', type: 'uint256' },
  { name: 'deadline', type: 'uint256' },
  { name: 'witness', type: 'ExampleWitness' }
]
const PERMIT2_WITNESS_TRANSFER_TYPES = {
  PermitWitnessTransferFrom: getPermit2WitnessTransferFields('TokenPermissions'),
  TokenPermissions: PERMIT2_TOKEN_PERMISSIONS_FIELDS,
  ExampleWitness: PERMIT2_EXAMPLE_WITNESS_FIELDS
}

const SEAPORT_ADDRESS = '0x0000000000000068F116a894984e2DB1123eB395'
const SEAPORT_ORDER_COMPONENTS_FIELDS = [
  { name: 'offerer', type: 'address' },
  { name: 'zone', type: 'address' },
  { name: 'offer', type: 'OfferItem[]' },
  { name: 'consideration', type: 'ConsiderationItem[]' },
  { name: 'orderType', type: 'uint8' },
  { name: 'startTime', type: 'uint256' },
  { name: 'endTime', type: 'uint256' },
  { name: 'zoneHash', type: 'bytes32' },
  { name: 'salt', type: 'uint256' },
  { name: 'conduitKey', type: 'bytes32' },
  { name: 'counter', type: 'uint256' }
]
const getSeaportOrder = (offerTokenId: string) => ({
  offerer: address1,
  zone: '0x0000000000000000000000000000000000000000',
  offer: [
    {
      itemType: '2',
      token: NFT_ADDRESS,
      identifierOrCriteria: offerTokenId,
      startAmount: '1',
      endAmount: '1'
    }
  ],
  consideration: [
    {
      itemType: '1',
      token: WETH_ADDRESS,
      identifierOrCriteria: '0',
      startAmount: '1000',
      endAmount: '1000',
      recipient: address1
    }
  ]
})

const SNAPSHOT_VOTE_FIELDS = [
  { name: 'from', type: 'address' },
  { name: 'space', type: 'string' },
  { name: 'timestamp', type: 'uint64' },
  { name: 'proposal', type: 'bytes32' },
  { name: 'choice', type: 'uint32' },
  { name: 'reason', type: 'string' },
  { name: 'app', type: 'string' },
  { name: 'metadata', type: 'string' }
]
const SNAPSHOT_ALIAS_FIELDS = [
  { name: 'from', type: 'address' },
  { name: 'alias', type: 'address' },
  { name: 'timestamp', type: 'uint64' }
]
const ENS_UPLOAD_FIELDS = [
  { name: 'upload', type: 'string' },
  { name: 'expiry', type: 'string' },
  { name: 'name', type: 'string' },
  { name: 'hash', type: 'string' }
]

let messageTemplate: Message

/** Humanizes the message through the real entry point, so the primary type routing is tested too */
const humanize = (message: Message) => {
  const { fullVisualization = [], warnings } = humanizeMessage(message)
  return { fullVisualization, warnings }
}
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
        types: { EIP712Domain: [], Permit: ERC2612_PERMIT_FIELDS },
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
    const { fullVisualization } = humanize(messageTemplate)
    expect(fullVisualization).toBeTruthy()
    compareVisualizations(fullVisualization!, expectedVisualization)
  })
  const setDaiPermitMessage = (message: Record<string, any>) => {
    ;(messageTemplate.content as TypedMessageUserRequest['meta']['params']).types = {
      EIP712Domain: [],
      Permit: DAI_PERMIT_FIELDS
    }
    messageTemplate.content.message = message
  }

  test('erc20 module with DAI-style permit (grant)', () => {
    const expectedVisualization = [
      getAction('Grant approval'),
      getLabel('for'),
      getToken(DAI_ADDRESS, MaxUint256),
      getLabel('to'),
      getAddressVisualization(address2),
      getDeadline(968187600n)
    ]

    setDaiPermitMessage(typedMessages.daiPermit[0]!)
    ;(
      messageTemplate.content as TypedMessageUserRequest['meta']['params']
    ).domain.verifyingContract = DAI_ADDRESS
    const { fullVisualization } = humanize(messageTemplate)
    expect(fullVisualization).toBeTruthy()
    compareVisualizations(fullVisualization!, expectedVisualization)
  })
  test('erc20 module with DAI-style permit (grant, no expiry)', () => {
    const expectedVisualization = [
      getAction('Grant approval'),
      getLabel('for'),
      getToken(DAI_ADDRESS, MaxUint256),
      getLabel('to'),
      getAddressVisualization(address2)
    ]

    setDaiPermitMessage(typedMessages.daiPermit[1]!)
    ;(
      messageTemplate.content as TypedMessageUserRequest['meta']['params']
    ).domain.verifyingContract = DAI_ADDRESS
    const { fullVisualization } = humanize(messageTemplate)
    expect(fullVisualization).toBeTruthy()
    compareVisualizations(fullVisualization!, expectedVisualization)
  })
  test('erc20 module with DAI-style permit (revoke)', () => {
    const expectedVisualization = [
      getAction('Revoke approval'),
      getToken(DAI_ADDRESS, 0n),
      getLabel('for'),
      getAddressVisualization(address2)
    ]

    setDaiPermitMessage(typedMessages.daiPermit[2]!)
    ;(
      messageTemplate.content as TypedMessageUserRequest['meta']['params']
    ).domain.verifyingContract = DAI_ADDRESS
    const { fullVisualization } = humanize(messageTemplate)
    expect(fullVisualization).toBeTruthy()
    compareVisualizations(fullVisualization!, expectedVisualization)
  })
  test('erc20 module shows a DAI-style permit with unsigned EIP-2612 keys as unlimited', () => {
    const expectedVisualization = [
      getAction('Grant approval'),
      getLabel('for'),
      getToken(DAI_ADDRESS, MaxUint256),
      getLabel('to'),
      getAddressVisualization(address2)
    ]

    // `owner`, `value` and `deadline` are not in the DAI Permit type, so they are not signed
    setDaiPermitMessage({
      ...typedMessages.daiPermit[1]!,
      owner: address1,
      value: parseEther('1'),
      deadline: 968187600n
    })
    ;(
      messageTemplate.content as TypedMessageUserRequest['meta']['params']
    ).domain.verifyingContract = DAI_ADDRESS
    const { fullVisualization } = humanize(messageTemplate)
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

    ;(messageTemplate.content as TypedMessageUserRequest['meta']['params']).types = {
      EIP712Domain: [],
      Permit: ERC721_PERMIT_FIELDS
    }
    messageTemplate.content.message = typedMessages.erc721[0]!
    ;(
      messageTemplate.content as TypedMessageUserRequest['meta']['params']
    ).domain.verifyingContract = NFT_ADDRESS
    const { fullVisualization } = humanize(messageTemplate)
    expect(fullVisualization).toBeTruthy()
    compareVisualizations(fullVisualization!, expectedVisualization)
  })
  test('erc721 module ignores unsigned NFT permit keys in a permit with other fields', () => {
    // `amount` instead of `value` is not recognized by the erc20 module. `tokenId`
    // and `deadline` are not in the signed Permit type, so they must not be shown
    ;(messageTemplate.content as TypedMessageUserRequest['meta']['params']).types = {
      EIP712Domain: [],
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'expiry', type: 'uint256' }
      ]
    }
    messageTemplate.content.message = {
      owner: address1,
      spender: address2,
      amount: MaxUint256,
      nonce: 1n,
      expiry: 968187600n,
      tokenId: 1n,
      deadline: 968187600n
    }
    expect(humanize(messageTemplate).fullVisualization).toHaveLength(0)
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
    ;(messageTemplate.content as TypedMessageUserRequest['meta']['params']).primaryType =
      'PermitSingle'
    ;(
      messageTemplate.content as TypedMessageUserRequest['meta']['params']
    ).domain.verifyingContract = '0x000000000022d473030f116ddee9f6b43ac78ba3'
    messageTemplate.content.message = typedMessages.permit2[0]!
    const { fullVisualization } = humanize(messageTemplate)
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
    ;(messageTemplate.content as TypedMessageUserRequest['meta']['params']).primaryType =
      'PermitBatch'
    ;(
      messageTemplate.content as TypedMessageUserRequest['meta']['params']
    ).domain.verifyingContract = '0x000000000022d473030f116ddee9f6b43ac78ba3'
    messageTemplate.content.message = typedMessages.permit2[1]!
    const { fullVisualization } = humanize(messageTemplate)
    expect(fullVisualization).toBeTruthy()
    compareVisualizations(fullVisualization!, expectedBatchVisualization)
  })

  test('permit2 module permit transfer from', () => {
    const expectedBatchVisualization = [
      getAction('Approve'),
      getAddressVisualization('0x1fa57f879417e029ef57d7ce915b0aa56a507c31'),
      getLabel('to use'),
      getToken('0xdac17f958d2ee523a2206206994597c13d831ec7', 2022432608n),
      getDeadline(1770952162n)
    ]
    ;(messageTemplate.content as TypedMessageUserRequest['meta']['params']).types = {
      EIP712Domain: [],
      PermitTransferFrom: [{ name: 'permitted', type: 'TokenPermissions' }]
    }
    ;(messageTemplate.content as TypedMessageUserRequest['meta']['params']).primaryType =
      'PermitTransferFrom'
    ;(
      messageTemplate.content as TypedMessageUserRequest['meta']['params']
    ).domain.verifyingContract = '0x000000000022d473030f116ddee9f6b43ac78ba3'
    messageTemplate.content.message = typedMessages.PermitTransferFrom[0]!
    const { fullVisualization } = humanize(messageTemplate)
    expect(fullVisualization).toBeTruthy()
    compareVisualizations(fullVisualization!, expectedBatchVisualization)
  })

  const setPermit2WitnessMessage = (
    types: Record<string, { name: string; type: string }[]>,
    message: Record<string, any>
  ) => {
    ;(messageTemplate.content as TypedMessageUserRequest['meta']['params']).types = {
      EIP712Domain: [],
      ...types
    }
    ;(messageTemplate.content as TypedMessageUserRequest['meta']['params']).primaryType =
      Object.keys(types)[0]!
    ;(
      messageTemplate.content as TypedMessageUserRequest['meta']['params']
    ).domain.verifyingContract = '0x000000000022d473030f116ddee9f6b43ac78ba3'
    messageTemplate.content.message = message
  }

  test('permit2 witness transfer with a recipient', () => {
    const expectedVisualization = [
      getAction('Approve'),
      getAddressVisualization(address2),
      getLabel('to transfer'),
      getToken(WETH_ADDRESS, 1000000000000000000n),
      getLabel('and send it to'),
      getAddressVisualization(address3),
      getDeadline(968187600n)
    ]
    setPermit2WitnessMessage(
      PERMIT2_WITNESS_TRANSFER_TYPES,
      typedMessages.PermitWitnessTransferFrom[0]!
    )
    const { fullVisualization, warnings } = humanize(messageTemplate)
    expect(fullVisualization).toBeTruthy()
    compareVisualizations(fullVisualization!, expectedVisualization)
    expect(warnings).toHaveLength(0)
  })

  test('permit2 witness transfer with a zero recipient warns instead of showing the zero address', () => {
    const expectedVisualization = [
      getAction('Approve'),
      getAddressVisualization(address2),
      getLabel('to transfer'),
      getToken(WETH_ADDRESS, 1000000000000000000n),
      getLabel('and send them to anyone', true),
      getDeadline(968187600n)
    ]
    setPermit2WitnessMessage(
      PERMIT2_WITNESS_TRANSFER_TYPES,
      typedMessages.PermitWitnessTransferFrom[1]!
    )
    const { fullVisualization, warnings } = humanize(messageTemplate)
    expect(fullVisualization).toBeTruthy()
    compareVisualizations(fullVisualization!, expectedVisualization)
    expect(
      fullVisualization!.some(
        (v) => v.type === 'address' && v.address === '0x0000000000000000000000000000000000000000'
      )
    ).toBe(false)
    expect(warnings).toHaveLength(1)
    expect(warnings![0]!.code).toBe('PERMIT2_MISSING_RECIPIENT')
  })

  test('permit2 batch witness transfer without a recipient in the witness', () => {
    const expectedVisualization = [
      getAction('Approve'),
      getAddressVisualization(address2),
      getLabel('to transfer'),
      getToken(WETH_ADDRESS, 1000000000000000000n),
      getLabel('and'),
      getToken(DAI_ADDRESS, 500000000000000000n),
      getDeadline(968187600n)
    ]
    setPermit2WitnessMessage(
      { PermitBatchWitnessTransferFrom: [{ name: 'permitted', type: 'TokenPermissions[]' }] },
      typedMessages.PermitWitnessTransferFrom[2]!
    )
    const { fullVisualization, warnings } = humanize(messageTemplate)
    expect(fullVisualization).toBeTruthy()
    compareVisualizations(fullVisualization!, expectedVisualization)
    expect(warnings).toHaveLength(0)
  })

  test('permit2 witness transfer does not show a recipient from an undeclared witness field', () => {
    const expectedVisualization = [
      getAction('Approve'),
      getAddressVisualization(address2),
      getLabel('to transfer'),
      getToken(WETH_ADDRESS, 1000000000000000000n),
      getDeadline(968187600n)
    ]
    // The signed witness field is `order`, so the `witness` key is not signed
    setPermit2WitnessMessage(
      {
        PermitWitnessTransferFrom: [
          ...getPermit2WitnessTransferFields('TokenPermissions').filter(
            (field) => field.name !== 'witness'
          ),
          { name: 'order', type: 'ExampleWitness' }
        ],
        TokenPermissions: PERMIT2_TOKEN_PERMISSIONS_FIELDS,
        ExampleWitness: PERMIT2_EXAMPLE_WITNESS_FIELDS
      },
      {
        ...typedMessages.PermitWitnessTransferFrom[0]!,
        order: { recipient: address2, orderId: 1n },
        witness: { recipient: address3 }
      }
    )
    const { fullVisualization, warnings } = humanize(messageTemplate)
    compareVisualizations(fullVisualization!, expectedVisualization)
    expect(warnings).toHaveLength(0)
  })

  test('permit2 witness transfer does not show a recipient that the witness type does not declare', () => {
    const expectedVisualization = [
      getAction('Approve'),
      getAddressVisualization(address2),
      getLabel('to transfer'),
      getToken(WETH_ADDRESS, 1000000000000000000n),
      getDeadline(968187600n)
    ]
    // ExampleWitness declares only `orderId`, so `recipient` is not signed
    setPermit2WitnessMessage(
      {
        ...PERMIT2_WITNESS_TRANSFER_TYPES,
        ExampleWitness: [{ name: 'orderId', type: 'uint256' }]
      },
      {
        ...typedMessages.PermitWitnessTransferFrom[0]!,
        witness: { recipient: address3, orderId: 1n }
      }
    )
    const { fullVisualization, warnings } = humanize(messageTemplate)
    compareVisualizations(fullVisualization!, expectedVisualization)
    expect(warnings).toHaveLength(0)
  })

  test('permit2 witness transfer with an incomplete permitted struct is not humanized', () => {
    setPermit2WitnessMessage(
      { PermitWitnessTransferFrom: [{ name: 'permitted', type: 'TokenPermissions' }] },
      {
        permitted: { token: WETH_ADDRESS },
        spender: address2,
        nonce: 1n,
        deadline: 968187600n,
        witness: { recipient: address3 }
      }
    )
    expect(humanize(messageTemplate).fullVisualization).toHaveLength(0)
  })

  test('permit2 single with an unused witness type and unsigned keys shows the signed details', () => {
    const expectedVisualization = [
      getAction('Approve'),
      getAddressVisualization(address2),
      getLabel('to use'),
      getToken(WETH_ADDRESS, 1000000000000000000n),
      getDeadline(968187600n)
    ]
    // PermitWitnessTransferFrom, `permitted` and `deadline` are not part of PermitSingle,
    // so they are not signed and must not change what is shown
    setPermit2WitnessMessage(
      {
        PermitSingle: [{ name: 'details', type: 'PermitDetails' }],
        PermitWitnessTransferFrom: [{ name: 'permitted', type: 'TokenPermissions' }]
      },
      {
        ...typedMessages.permit2[0]!,
        permitted: { token: WETH_ADDRESS, amount: 1n },
        nonce: 1n,
        deadline: 1n
      }
    )
    const { fullVisualization } = humanize(messageTemplate)
    compareVisualizations(fullVisualization!, expectedVisualization)
  })

  const setSeaportMessage = (
    primaryType: string,
    types: Record<string, { name: string; type: string }[]>,
    message: Record<string, any>
  ) => {
    const content = messageTemplate.content as TypedMessageUserRequest['meta']['params']
    content.domain = {
      name: 'Seaport',
      version: '1.6',
      chainId: 1n,
      verifyingContract: SEAPORT_ADDRESS
    }
    content.types = { EIP712Domain: [], ...types }
    content.primaryType = primaryType
    messageTemplate.content.message = message
  }

  test('opensea module single Seaport order', () => {
    const expectedVisualization = [
      getAction('Make offer to swap'),
      getToken(NFT_ADDRESS, 1n),
      getLabel('for'),
      getToken(WETH_ADDRESS, 1000n)
    ]
    setSeaportMessage(
      'OrderComponents',
      { OrderComponents: SEAPORT_ORDER_COMPONENTS_FIELDS },
      getSeaportOrder('1')
    )
    const { fullVisualization } = humanize(messageTemplate)
    compareVisualizations(fullVisualization!, expectedVisualization)
  })

  test('opensea module ignores unsigned top-level order keys in a Seaport bulk order', () => {
    // A bulk order signs only `tree`, so the top-level `offer` and `consideration` are a decoy
    setSeaportMessage(
      'BulkOrder',
      {
        BulkOrder: [{ name: 'tree', type: 'OrderComponents[2]' }],
        OrderComponents: SEAPORT_ORDER_COMPONENTS_FIELDS
      },
      {
        tree: [getSeaportOrder('1'), getSeaportOrder('2')],
        ...getSeaportOrder('3')
      }
    )
    expect(humanize(messageTemplate).fullVisualization).toHaveLength(0)
  })

  const setSnapshotMessage = (
    primaryType: string,
    fields: { name: string; type: string }[],
    message: Record<string, any>
  ) => {
    const content = messageTemplate.content as TypedMessageUserRequest['meta']['params']
    content.domain = { name: 'snapshot', version: '0.1.4' }
    content.types = { EIP712Domain: [], [primaryType]: fields }
    content.primaryType = primaryType
    messageTemplate.content.message = message
  }

  test('snapshot module vote', () => {
    const expectedVisualization = [
      getAction('Vote'),
      getLabel('in'),
      getLabel('Snapshot:', true),
      getLabel('ambire.eth', true)
    ]
    setSnapshotMessage('Vote', SNAPSHOT_VOTE_FIELDS, {
      from: address1,
      space: 'ambire.eth',
      timestamp: 1n,
      proposal: `0x${'11'.repeat(32)}`,
      choice: 1,
      reason: '',
      app: 'snapshot',
      metadata: '{}'
    })
    const { fullVisualization } = humanize(messageTemplate)
    compareVisualizations(fullVisualization!, expectedVisualization)
  })

  test('snapshot module does not show a vote for an alias with unsigned vote keys', () => {
    // An alias lets another address act for the user. `choice` and `space` are not signed
    setSnapshotMessage('Alias', SNAPSHOT_ALIAS_FIELDS, {
      from: address1,
      alias: address2,
      timestamp: 1n,
      choice: 1,
      space: 'ambire.eth'
    })
    expect(humanize(messageTemplate).fullVisualization).toHaveLength(0)
  })

  const setEnsUploadMessage = (
    fields: { name: string; type: string }[],
    message: Record<string, any>
  ) => {
    const content = messageTemplate.content as TypedMessageUserRequest['meta']['params']
    content.domain = { name: 'Ethereum Name Service', version: '1' }
    content.types = { EIP712Domain: [], Upload: fields }
    content.primaryType = 'Upload'
    messageTemplate.content.message = message
  }

  test('ens module avatar upload', () => {
    const expectedVisualization = [
      getAction('Update'),
      getLabel('ENS profile pic of'),
      getLabel('ambire.eth'),
      getDeadline(968187600n)
    ]
    setEnsUploadMessage(ENS_UPLOAD_FIELDS, {
      upload: 'avatar',
      expiry: '968187600000',
      name: 'ambire.eth',
      hash: '0x1234'
    })
    const { fullVisualization } = humanize(messageTemplate)
    compareVisualizations(fullVisualization!, expectedVisualization)
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

    const { fullVisualization } = humanize(messageTemplate)
    expect(fullVisualization).toBeTruthy()
    compareVisualizations(fullVisualization!, expectedVisualization)
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

    const { fullVisualization } = humanize(messageTemplate)
    expect(fullVisualization).toBeTruthy()
    compareVisualizations(fullVisualization!, expectedVisualization)
  })

  test('Entry point module', () => {
    messageTemplate.fromRequestId = ENTRY_POINT_AUTHORIZATION_REQUEST_ID
    ;(messageTemplate.content as TypedMessageUserRequest['meta']['params']).primaryType =
      'AmbireOperation'
    const { fullVisualization: received } = humanize(messageTemplate)
    const expected = [
      getAction('Authorize entry point'),
      getLabel('for'),
      getAddressVisualization(messageTemplate.accountAddr)
    ]
    compareVisualizations(expected, received!)
  })

  test('a typed message is humanized only by the humanizer of its primary type', () => {
    // Only `Mail` is signed. The unused `PermitSingle` type and the permit keys are not
    ;(messageTemplate.content as TypedMessageUserRequest['meta']['params']).types = {
      EIP712Domain: [],
      Mail: [{ name: 'contents', type: 'string' }],
      PermitSingle: [{ name: 'details', type: 'PermitDetails' }]
    }
    ;(messageTemplate.content as TypedMessageUserRequest['meta']['params']).primaryType = 'Mail'
    ;(
      messageTemplate.content as TypedMessageUserRequest['meta']['params']
    ).domain.verifyingContract = '0x000000000022d473030f116ddee9f6b43ac78ba3'
    messageTemplate.content.message = { contents: 'hello', ...typedMessages.permit2[0]! }
    expect(humanize(messageTemplate).fullVisualization).toHaveLength(0)
  })

  test.each([
    {
      primaryType: 'Order',
      fields: [{ name: 'salt', type: 'uint256' }],
      verifyingContract: '0x111111125421ca6dc452d289314280a0f8842a65'
    },
    {
      primaryType: 'Permit',
      fields: [
        { name: 'owner', type: 'address' },
        { name: 'amount', type: 'uint256' }
      ],
      verifyingContract: WETH_ADDRESS
    },
    {
      primaryType: 'Vote',
      fields: [{ name: 'choice', type: 'uint32' }],
      verifyingContract: WETH_ADDRESS
    },
    {
      primaryType: 'PermitSingle',
      fields: [{ name: 'details', type: 'PermitDetails' }],
      verifyingContract: WETH_ADDRESS
    }
  ])(
    'an unrecognized $primaryType gives no visualization, not an empty one',
    ({ primaryType, fields, verifyingContract }) => {
      // An empty array is truthy. The sign screen would treat it as humanized and
      // let the user sign without reading the raw message
      const content = messageTemplate.content as TypedMessageUserRequest['meta']['params']
      content.types = { EIP712Domain: [], [primaryType]: fields }
      content.primaryType = primaryType
      content.domain.verifyingContract = verifyingContract
      messageTemplate.content.message = { salt: 1n, choice: 1, space: 'x', details: {} }
      expect(humanizeMessage(messageTemplate).fullVisualization).toBeUndefined()
    }
  )

  test.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'primary type %s does not reach Object.prototype',
    (primaryType) => {
      expect(getTypedMessageHumanizer(primaryType)).toBeUndefined()
      ;(messageTemplate.content as TypedMessageUserRequest['meta']['params']).primaryType =
        primaryType
      messageTemplate.content.message = typedMessages.erc20[0]!
      expect(humanize(messageTemplate).fullVisualization).toHaveLength(0)
    }
  )

  test('every primary type in the record has a humanizer', () => {
    ;[
      'Permit',
      'PermitSingle',
      'PermitBatch',
      'PermitTransferFrom',
      'PermitWitnessTransferFrom',
      'PermitBatchWitnessTransferFrom',
      'Order',
      'OrderCancellations',
      'OrderComponents',
      'SafeTx',
      'Vote',
      'Upload',
      'AmbireOperation'
    ].forEach((primaryType) =>
      expect(getTypedMessageHumanizer(primaryType)).toBeInstanceOf(Function)
    )
  })
})

describe('plain text and authorization messages', () => {
  const getPlainTextMessage = (text: string): Message => ({
    fromRequestId: 'randomActionId',
    accountAddr: address1,
    chainId: 1n,
    signature: null,
    content: { kind: 'message', message: hexlify(toUtf8Bytes(text)) as `0x${string}` }
  })

  test('a short plain text message uses the plain text fallback', () => {
    const { fullVisualization } = humanize(getPlainTextMessage(`Hello ${address2}`))
    compareVisualizations(fullVisualization, [
      getAction('Message: '),
      getLabel('Hello'),
      getAddressVisualization(address2)
    ])
  })

  test('a plain text module that matches comes before the fallback', () => {
    const { fullVisualization } = humanize(
      getPlainTextMessage(`Welcome to OpenSea! Wallet address: ${address1}`)
    )
    compareVisualizations(fullVisualization, [getAction('Log in'), getLabel('OpenSea', true)])
  })

  test('a plain text message that reads like a typed message is not humanized as one', () => {
    const { fullVisualization } = humanize(getPlainTextMessage('Permit'))
    compareVisualizations(fullVisualization, [getAction('Message: '), getLabel('Permit')])
  })

  test('an EIP-7702 authorization uses its own humanizer', () => {
    const { fullVisualization } = humanize({
      fromRequestId: 'randomActionId',
      accountAddr: address1,
      chainId: 1n,
      signature: null,
      content: {
        kind: 'authorization-7702',
        message: '0x',
        contractAddr: address2,
        nonce: 1n
      }
    })
    expect(fullVisualization[0]).toMatchObject({
      type: 'action',
      content: 'EIP-7702 Authorization'
    })
  })
})
