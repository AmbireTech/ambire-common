import { ethers, ZeroAddress } from 'ethers'

import { beforeEach, describe, jest, test } from '@jest/globals'

import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { execTransactionAbi } from '../../consts/safe'
import { Account } from '../../interfaces/account'
import { Key } from '../../interfaces/keystore'
import { AccountOp } from '../accountOp/accountOp'
import { GeneralAdapter1 } from './const/abis/GeneralAdapter1'
import {
  clearErc7730RegistryCache,
  fetchErc7730DescriptorForMessage,
  fetchErc7730DescriptorsForAccountOp
} from './erc7730'
import { humanizeAccountOp, humanizeMessage } from './index'
import { compareHumanizerVisualizations, compareVisualizations } from './testHelpers'
import {
  getAction,
  getAddressVisualization,
  getDeadline,
  getErc7730Visualization,
  getLabel,
  getText,
  getToken,
  getWarning,
  hasErc7730Humanization
} from './utils'

// const address1 = '0x6942069420694206942069420694206942069420'
const address2 = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const WETH_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'

const accountOp: AccountOp = {
  accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
  chainId: 1n,
  // this may not be defined, in case the user has not picked a key yet
  signingKeyAddr: null,
  signingKeyType: null,
  // signingKeyType: 'internal',
  // this may not be set in case we haven't set it yet
  nonce: null,
  calls: [],
  gasLimit: null,
  signature: null,
  gasFeePayment: null
  // This is fed into the humanizer to help visualize the accountOp
  // This can contain info like the value of specific share tokens at the time of signing,
  // or any other data that needs to otherwise be retrieved in an async manner and/or needs to be
  // "remembered" at the time of signing in order to visualize history properly
  // humanizerMeta: {}
} as any

const accounts: Account[] = [
  {
    addr: '0xAAbBbC841F29Dc6b09EF9f6c8fd59DA807bc6248',
    associatedKeys: ['string[]'],
    initialPrivileges: [],
    creation: null,
    preferences: {
      label: DEFAULT_ACCOUNT_LABEL,
      pfp: '0xAAbBbC841F29Dc6b09EF9f6c8fd59DA807bc6248'
    }
  }
]
const keys: Key[] = [
  {
    addr: '0xABcdeF398CBb1285Eeb2DC42be2c429eB1d55f02',
    type: 'internal',
    label: 'Key 1',
    dedicatedToOneSA: true,
    isExternallyStored: true,
    meta: {
      createdAt: new Date().getTime()
    }
  }
]

beforeEach(() => {
  clearErc7730RegistryCache()
})
const transactions = {
  generic: [
    // simple transafer
    { to: '0xc4ce03b36f057591b2a360d773edb9896255051e', value: BigInt(10 ** 18), data: '0x' },
    // simple contract call (WETH approve)
    {
      to: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      value: BigInt(0),
      data: '0x095ea7b3000000000000000000000000e5c783ee536cf5e63e792988335c4255169be4e1ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      id: 'generic-one'
    }
  ],
  // currently with USDT
  erc20: [
    // approve erc-20 token USDT with hidden eth send
    {
      to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      value: 10n ** 18n,
      data: '0x095ea7b300000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000000000000000000000000000000000003b9aca00',
      id: 'erc20-0'
    },
    // approve erc-20 token USDT
    {
      to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      value: BigInt(0),
      data: '0x095ea7b300000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000000000000000000000000000000000003b9aca00',
      id: 'erc20-1'
    },
    // revoke approval  erc-20 token USDT
    {
      to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      value: BigInt(0),
      data: '0x095ea7b300000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000000000000000000000000000000000003b9aca00',
      id: 'erc20-2'
    },
    // transferFrom A to me  erc-20 token USDT
    {
      to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      value: BigInt(0),
      data: `0x23b872dd00000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000${accountOp.accountAddr.substring(
        2
      )}000000000000000000000000000000000000000000000000000000003b9aca00`,
      id: 'erc20-3'
    },
    // transferFrom A to B (bad example - B is USDT) erc-20 token USDT
    {
      to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      value: BigInt(0),
      data: '0x23b872dd00000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7000000000000000000000000000000000000000000000000000000003b9aca00'
    },
    // transferFrom me to A  erc-20 token USDT (bad example, in such case transfer will be used)
    {
      to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      value: BigInt(0),
      data: `0x23b872dd000000000000000000000000${accountOp.accountAddr.substring(
        2
      )}00000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000000000000000000000000000000000003b9aca00`
    },
    // transfer erc-20 tokens USDT
    {
      to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      value: BigInt(0),
      data: '0xa9059cbb00000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000000000000000000000000000000000003b9aca00'
    }
  ],
  erc721: [
    // grant approval nft 1
    {
      to: '0x59468516a8259058bad1ca5f8f4bff190d30e066',
      value: BigInt(0),
      data: '0x095ea7b300000000000000000000000046705dfff24256421a05d056c29e81bdc09723b80000000000000000000000000000000000000000000000000000000000000001'
    },
    // revoke approval nft 1
    {
      to: '0x59468516a8259058bad1ca5f8f4bff190d30e066',
      value: BigInt(0),
      data: `0x095ea7b3000000000000000000000000${ethers.ZeroAddress.substring(
        2
      )}0000000000000000000000000000000000000000000000000000000000000001`
    },
    // approve all
    {
      to: '0x59468516a8259058bad1ca5f8f4bff190d30e066',
      value: BigInt(0),
      data: '0xa22cb46500000000000000000000000046705dfff24256421a05d056c29e81bdc09723b80000000000000000000000000000000000000000000000000000000000000001'
    },
    // revoke all approvals
    {
      to: '0x59468516a8259058bad1ca5f8f4bff190d30e066',
      value: BigInt(0),
      data: '0xa22cb46500000000000000000000000046705dfff24256421a05d056c29e81bdc09723b80000000000000000000000000000000000000000000000000000000000000000'
    },
    // transfer from me to A
    {
      to: '0x59468516a8259058bad1ca5f8f4bff190d30e066',
      value: BigInt(0),
      data: '0x23b872dd000000000000000000000000B674F3fd5F43464dB0448a57529eAF37F04cceA500000000000000000000000046705dfff24256421a05d056c29e81bdc09723b80000000000000000000000000000000000000000000000000000000000000000'
    },
    // transfer from B to A
    {
      to: '0x59468516a8259058bad1ca5f8f4bff190d30e066',
      value: BigInt(0),
      data: '0x23b872dd000000000000000000000000C89B38119C58536d818f3Bf19a9E3870828C199400000000000000000000000046705dfff24256421a05d056c29e81bdc09723b80000000000000000000000000000000000000000000000000000000000000000'
    },
    // safe transfer from A to B
    {
      to: '0x59468516a8259058bad1ca5f8f4bff190d30e066',
      value: BigInt(0),
      data: '0x42842e0e000000000000000000000000C89B38119C58536d818f3Bf19a9E3870828C199400000000000000000000000046705dfff24256421a05d056c29e81bdc09723b80000000000000000000000000000000000000000000000000000000000000000'
    }
  ],
  toKnownAddresses: [
    // ETH to uniswap (bad example, sending eth to contract)
    {
      to: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d',
      value: BigInt(10 * 18),
      data: '0x'
    },
    // USDT to uniswap (bad example, sending erc-20 to contract)
    {
      to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      value: BigInt(0),
      data: '0xa9059cbb000000000000000000000000B674F3fd5F43464dB0448a57529eAF37F04cceA5000000000000000000000000000000000000000000000000000000003b9aca00'
    }
  ],
  uniV3: [
    // Swap exact WALLET for at least x  USDC
    {
      to: '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45',
      value: BigInt(0),
      data: '0x5ae401dc0000000000000000000000000000000000000000000000000000000064c236530000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000124b858183f00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000080000000000000000000000000b674f3fd5f43464db0448a57529eaf37f04ccea500000000000000000000000000000000000000000000003635c9adc5dea000000000000000000000000000000000000000000000000000000000000000835074000000000000000000000000000000000000000000000000000000000000004288800092ff476844f74dc2fc427974bbee2794ae002710c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20001f4a0b86991c6218b36c1d19d4a2e9eb0ce3606eb4800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
    },
    // Swap up to x Adex to exact DAI
    {
      to: '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45',
      value: BigInt(0),
      data: '0x5ae401dc0000000000000000000000000000000000000000000000000000000064c233bf000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000012409b8134600000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000080000000000000000000000000b674f3fd5f43464db0448a57529eaf37f04ccea50000000000000000000000000000000000000000000000056bc75e2d63100000000000000000000000000000000000000000000000000025faff1f58be30f6ec00000000000000000000000000000000000000000000000000000000000000426b175474e89094c44da98b954eedeac495271d0f000064dac17f958d2ee523a2206206994597c13d831ec7000bb8ade00c28244d5ce17d72e40330b1c318cd12b7c300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
    }
  ],
  unknownFuncSelector: [
    {
      to: '0x519856887af544de7e67f51a4f2271521b01432b',
      value: BigInt(0),
      data: '0xd96a094a0000000000000000000000000000000000000000000000000000000064c233bf'
    }
  ],
  aave: [
    {
      to: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
      value: 0n,
      data: '0xac9650d800000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000002428530a47000000000000000000000000000000000000000000000000000000000000002b000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000084617ba03700000000000000000000000068749665ff8d2d112fa859aa293f07a622782f3800000000000000000000000000000000000000000000000000000000000003e8000000000000000000000000084bb31443b6da9c6007e4b11a5a5c4a019ea5df000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
    }
  ],
  accountOrKeyArg: [
    // approve erc-20 token USDT
    {
      to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      value: BigInt(0),
      data: '0x095ea7b3000000000000000000000000aabbbC841f29Dc6B09eF9F6c8fD59da807Bc6248000000000000000000000000000000000000000000000000000000003b9aca00',
      id: 'key-0'
    },
    {
      to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      value: BigInt(0),
      data: '0x095ea7b3000000000000000000000000ABcdeF398CBb1285Eeb2DC42be2c429eB1d55f02000000000000000000000000000000000000000000000000000000003b9aca00',
      id: 'key-1'
    }
  ]
}

describe('Humanizer main function', () => {
  beforeEach(async () => {
    accountOp.calls = []
  })

  test('generic humanize', async () => {
    // const ir: Ir = []
    const expectedVisualizations = [
      [
        getAction('Send'),
        getToken('0x0000000000000000000000000000000000000000', 1000000000000000000n),
        getLabel('to'),
        getAddressVisualization('0xc4ce03b36f057591b2a360d773edb9896255051e')
      ],
      [
        getAction('Grant approval'),
        getLabel('for'),
        getToken(
          '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          115792089237316195423570985008687907853269984665640564039457584007913129639935n
        ),
        getLabel('to'),
        getAddressVisualization('0xe5c783ee536cf5e63e792988335c4255169be4e1')
      ]
    ]

    accountOp.calls = [...transactions.generic]
    const irCalls = humanizeAccountOp(accountOp)
    compareHumanizerVisualizations(irCalls, expectedVisualizations)
  })

  test('humanizes Safe allowance with no reset instead of every 0 minutes', async () => {
    const allowanceInterface = new ethers.Interface([
      'function setAllowance(address delegate, address token, uint96 allowanceAmount, uint16 resetTimeMin, uint32 resetBaseMin)'
    ])
    const delegate = '0xa04d21b7ae298d8e4a61a507de2b7ceafd90ba01'

    accountOp.calls = [
      {
        to: '0x9641d764fc13c8b624c04430c7356c1c7c8102e2',
        value: 0n,
        data: allowanceInterface.encodeFunctionData('setAllowance', [
          delegate,
          ZeroAddress,
          1000000000000000000n,
          0n,
          0n
        ])
      }
    ]

    const irCalls = humanizeAccountOp(accountOp)

    compareHumanizerVisualizations(irCalls, [
      [
        getAction('Allow'),
        getAddressVisualization(delegate),
        getLabel('to spend'),
        getToken(ZeroAddress, 1000000000000000000n),
        getLabel('No reset')
      ]
    ])
  })

  test('erc20 humanize end to end', async () => {
    // const ir: Ir = []
    const expectedVisualizations = [
      [
        getAction('Send'),
        getToken(ZeroAddress, 10n ** 18n),
        getLabel('and'),
        getAction('Grant approval'),
        getLabel('for'),
        getToken('0xdac17f958d2ee523a2206206994597c13d831ec7', 10n ** 9n),
        getLabel('to'),
        getAddressVisualization('0x46705dfff24256421a05d056c29e81bdc09723b8')
      ],
      [
        getAction('Grant approval'),
        getLabel('for'),
        getToken('0xdac17f958d2ee523a2206206994597c13d831ec7', 1000000000n),
        getLabel('to'),
        getAddressVisualization('0x46705dfff24256421a05d056c29e81bdc09723b8')
      ],
      [
        getAction('Grant approval'),
        getLabel('for'),
        getToken('0xdac17f958d2ee523a2206206994597c13d831ec7', 1000000000n),
        getLabel('to'),
        getAddressVisualization('0x46705dfff24256421a05d056c29e81bdc09723b8')
      ]
    ]
    accountOp.calls = [...transactions.erc20.slice(0, 3)]
    const irCalls = humanizeAccountOp(accountOp)
    compareHumanizerVisualizations(irCalls, expectedVisualizations)
  })

  test('aave not to be parsed by uniswap', async () => {
    // const ir: Ir = []
    const expectedVisualizations = [
      [
        getAction('Interacting'),
        getLabel('with'),
        getAddressVisualization('0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2')
      ]
    ]

    accountOp.calls = [...transactions.aave]
    const irCalls = humanizeAccountOp(accountOp)
    compareHumanizerVisualizations(irCalls, expectedVisualizations)
  })
})

describe('TypedMessages', () => {
  test('simple humanization', async () => {
    const message = {
      details: [
        {
          token: WETH_ADDRESS,
          amount: ethers.parseEther('1'),
          expiration: 968187600n,
          nonce: 1n
        },
        {
          token: WETH_ADDRESS,
          amount: ethers.parseEther('0.5'),
          expiration: 969187600n,
          nonce: 2n
        }
      ],
      spender: address2,
      sigDeadline: 968187600n
    }
    const tmTemplate: any = {
      kind: 'typedMessage',
      domain: {
        name: 'random contract',
        version: '1',
        chainId: 1n,
        verifyingContract: '0x000000000022d473030f116ddee9f6b43ac78ba3',
        salt: '1'
      },
      types: { PermitBatch: [{ name: 'details', type: 'PermitDetails[]' }] },
      message,
      primaryType: 'Permit'
    }
    const fullMessage = {
      fromRequestId: 1,
      accountAddr: accountOp.accountAddr,
      content: tmTemplate,
      signature: null,
      chainId: 1n
    }

    const expectedVisualizations = [
      getAction('Approve'),
      getAddressVisualization(address2),
      getLabel('to use'),
      getToken('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', 1000000000000000000n),
      getLabel('and'),
      getAddressVisualization(address2),
      getLabel('to use'),
      getToken('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', 500000000000000000n),
      getDeadline(968187600n)
    ]

    const irMessage = humanizeMessage(fullMessage)
    compareVisualizations(irMessage.fullVisualization || [], expectedVisualizations)
  })
})

describe('with (Account | Key)[] arg', () => {
  beforeEach(async () => {
    accountOp.calls = []
  })
  test('with calls', async () => {
    const expectedVisualizations = [
      [
        getAction('Grant approval'),
        getLabel('for'),
        getToken('0xdac17f958d2ee523a2206206994597c13d831ec7', 1000000000n),
        getLabel('to'),
        getAddressVisualization(accounts[0]!.addr.toLowerCase())
      ],
      [
        getAction('Grant approval'),
        getLabel('for'),
        getToken('0xdac17f958d2ee523a2206206994597c13d831ec7', 1000000000n),
        getLabel('to'),
        getAddressVisualization(keys[0]!.addr.toLowerCase())
      ]
    ]
    accountOp.calls = [...transactions.accountOrKeyArg]

    const irCalls = humanizeAccountOp(accountOp)
    compareHumanizerVisualizations(irCalls, expectedVisualizations)
  })
})

describe('ERC-7730 descriptors', () => {
  beforeEach(async () => {
    accountOp.calls = []
  })

  test('prioritizes descriptor calldata humanization over local modules', async () => {
    const call = transactions.erc20[1]!
    accountOp.calls = [call]

    const irCalls = humanizeAccountOp(accountOp, {
      erc7730Descriptors: {
        0: {
          descriptor: {
            display: {
              formats: {
                'approve(address _spender, uint256 _value)': {
                  intent: 'Authorize',
                  fields: [
                    {
                      path: '#._spender',
                      label: 'Spender',
                      format: 'addressName',
                      visible: 'always'
                    },
                    {
                      path: '#._value',
                      label: 'Amount allowance',
                      format: 'tokenAmount',
                      params: { tokenPath: '@.to' },
                      visible: 'always'
                    }
                  ]
                }
              }
            }
          }
        }
      }
    })

    compareHumanizerVisualizations(irCalls, [
      [
        getErc7730Visualization('Authorize', [
          {
            label: 'Spender',
            value: [getAddressVisualization('0x46705dfff24256421a05d056c29e81bdc09723b8')]
          },
          {
            label: 'Amount allowance',
            value: [getToken('0xdac17f958d2ee523a2206206994597c13d831ec7', 1000000000n, 1n)]
          }
        ])
      ]
    ])
  })
  test('resolves descriptor root and bracket paths used by registry descriptors', async () => {
    const tokenOut = transactions.erc20[1]!.to
    const recipient = accountOp.accountAddr
    const uniswapRouter = '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45'
    const swapIface = new ethers.Interface([
      'function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to)',
      'function exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum) params)'
    ])
    const exactInputPath = ethers.concat([WETH_ADDRESS, '0x000bb8', tokenOut])

    accountOp.calls = [
      {
        to: uniswapRouter,
        value: 0n,
        data: swapIface.encodeFunctionData('swapExactTokensForTokens', [
          1000000000000000000n,
          1000000n,
          [WETH_ADDRESS, tokenOut],
          recipient
        ])
      },
      {
        to: uniswapRouter,
        value: 0n,
        data: swapIface.encodeFunctionData('exactInput', [
          {
            path: exactInputPath,
            recipient,
            amountIn: 2000000000000000000n,
            amountOutMinimum: 2000000n
          }
        ])
      }
    ]

    const descriptor = {
      display: {
        formats: {
          'swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to)':
            {
              intent: 'Swap',
              fields: [
                {
                  path: 'amountIn',
                  label: 'Amount to Send',
                  format: 'tokenAmount',
                  params: { tokenPath: 'path.[0]' }
                },
                {
                  path: 'amountOutMin',
                  label: 'Minimum to Receive',
                  format: 'tokenAmount',
                  params: { tokenPath: 'path.[-1]' }
                }
              ]
            },
          'exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params)':
            {
              intent: 'Swap',
              fields: [
                {
                  path: 'params.amountIn',
                  label: 'Amount to Send',
                  format: 'tokenAmount',
                  params: { tokenPath: 'params.path.[0:20]' }
                },
                {
                  path: 'params.amountOutMinimum',
                  label: 'Minimum to Receive',
                  format: 'tokenAmount',
                  params: { tokenPath: 'params.path.[-20:]' }
                }
              ]
            }
        }
      }
    }

    const irCalls = humanizeAccountOp(accountOp, {
      erc7730Descriptors: {
        0: { descriptor },
        1: { descriptor }
      }
    })

    compareHumanizerVisualizations(irCalls, [
      [
        getErc7730Visualization('Swap', [
          {
            label: 'Amount to Send',
            value: [getToken(WETH_ADDRESS, 1000000000000000000n, 1n)]
          },
          {
            label: 'Minimum to Receive',
            value: [getToken(tokenOut, 1000000n, 1n)]
          }
        ])
      ],
      [
        getErc7730Visualization('Swap', [
          {
            label: 'Amount to Send',
            value: [getToken(WETH_ADDRESS, 2000000000000000000n, 1n)]
          },
          {
            label: 'Minimum to Receive',
            value: [getToken(tokenOut, 2000000n, 1n)]
          }
        ])
      ]
    ])
  })
  test('treats missing token references in tokenAmount descriptors as native token', async () => {
    const uniswapRouter = '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45'
    const tokenIn = transactions.erc20[1]!.to
    const swapIface = new ethers.Interface([
      'function exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum) params)'
    ])
    const exactInputPath = ethers.concat([tokenIn, '0x000bb8', WETH_ADDRESS])

    accountOp.calls = [
      {
        to: uniswapRouter,
        value: 0n,
        data: swapIface.encodeFunctionData('exactInput', [
          {
            path: exactInputPath,
            recipient: accountOp.accountAddr,
            amountIn: 1000000n,
            amountOutMinimum: 1341586354762554134n
          }
        ])
      }
    ]

    const descriptor = {
      display: {
        formats: {
          'exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params)':
            {
              intent: 'Swap',
              fields: [
                {
                  path: 'params.amountIn',
                  label: 'Amount to Send',
                  format: 'tokenAmount',
                  params: { tokenPath: 'params.path.[0:20]' }
                },
                {
                  path: 'params.amountOutMinimum',
                  label: 'Minimum to Receive',
                  format: 'tokenAmount',
                  params: { tokenPath: 'params.nativeToken' }
                }
              ]
            }
        }
      }
    }

    const irCalls = humanizeAccountOp(accountOp, {
      erc7730Descriptors: {
        0: { descriptor }
      }
    })

    compareHumanizerVisualizations(irCalls, [
      [
        getErc7730Visualization('Swap', [
          {
            label: 'Amount to Send',
            value: [getToken(tokenIn, 1000000n, 1n)]
          },
          {
            label: 'Minimum to Receive',
            value: [getToken(ZeroAddress, 1341586354762554134n, 1n)]
          }
        ])
      ]
    ])
  })
  test('treats nativeCurrencyAddress-only tokenAmount descriptors as native token', async () => {
    const uniswapRouter = '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45'
    const tokenIn = transactions.erc20[1]!.to
    const swapIface = new ethers.Interface([
      'function exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum) params)'
    ])

    accountOp.calls = [
      {
        to: uniswapRouter,
        value: 0n,
        data: swapIface.encodeFunctionData('exactInput', [
          {
            path: ethers.concat([tokenIn, '0x000bb8', WETH_ADDRESS]),
            recipient: accountOp.accountAddr,
            amountIn: 1000000n,
            amountOutMinimum: 1341586354762554134n
          }
        ])
      }
    ]

    const descriptor = {
      display: {
        formats: {
          'exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params)':
            {
              intent: 'Swap',
              fields: [
                {
                  path: 'params.amountIn',
                  label: 'Amount to Send',
                  format: 'tokenAmount',
                  params: { tokenPath: 'params.path.[0:20]' }
                },
                {
                  path: 'params.amountOutMinimum',
                  label: 'Minimum to Receive',
                  format: 'tokenAmount',
                  params: { nativeCurrencyAddress: ZeroAddress }
                }
              ]
            }
        }
      }
    }

    const irCalls = humanizeAccountOp(accountOp, {
      erc7730Descriptors: {
        0: { descriptor }
      }
    })

    compareHumanizerVisualizations(irCalls, [
      [
        getErc7730Visualization('Swap', [
          {
            label: 'Amount to Send',
            value: [getToken(tokenIn, 1000000n, 1n)]
          },
          {
            label: 'Minimum to Receive',
            value: [getToken(ZeroAddress, 1341586354762554134n, 1n)]
          }
        ])
      ]
    ])
  })
  test('humanizes nested calldata in execute with permit descriptors', async () => {
    const router = '0x111111125421cA6dc452d289314280a0f8842A65'
    const aave = '0x76fb31fb4af56892a25e32cfc43de717950c9278'
    const uni = '0x6fd9d7AD17242c41f7131d257212c54A0e816691'

    accountOp.calls = [
      {
        to: router,
        value: 0n,
        data: '0x5816d7230000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000016000000000000000000000000000000000000000000000000000000000000000f476fb31fb4af56892a25e32cfc43de717950c9278000000000000000000000000d8293ad21678c6f09da139b4b62d38e514a03b78000000000000000000000000111111125421ca6dc452d289314280a0f8842a65ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff000000000000000000000000000000000000000000000000000000006a13cf37000000000000000000000000000000000000000000000000000000000000001c1d4b8b137bc2b190c4cdd763daf3a632def588253947eb17c1f4500633acec530f631e7f60adb923b939e9c581487490c717ac1334618ee2297710ad5fcbd77c000000000000000000000000000000000000000000000000000000000000000000000000000000000000020407ed23790000000000000000000000004c3ccc98c01103be72bcfd29e1d2454c98d1a6e300000000000000000000000076fb31fb4af56892a25e32cfc43de717950c92780000000000000000000000006fd9d7ad17242c41f7131d257212c54a0e8166910000000000000000000000004c3ccc98c01103be72bcfd29e1d2454c98d1a6e3000000000000000000000000d8293ad21678c6f09da139b4b62d38e514a03b78000000000000000000000000000000000000000000000000008b7a659c7c71c20000000000000000000000000000000000000000000000000d8913fd9b88e3c40000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000000b700000000000000000000000000000000000000000000000000009900006b02a00000000000000000000000000000000000000000000000000d77aa671b6577d948c95033806fd9d7ad17242c41f7131d257212c54a0e81669176fb31fb4af56892a25e32cfc43de717950c9278000bb800003c0000111111125421ca6dc452d289314280a0f8842a650020d6bdbf786fd9d7ad17242c41f7131d257212c54a0e816691111111125421ca6dc452d289314280a0f8842a6500000000000000000000000000000000000000000000000000000000000000000000000000ab0003904a82836d'
      }
    ]

    const descriptor = {
      display: {
        formats: {
          'permitAndCall(bytes permit, bytes action)': {
            intent: 'Execute with permit',
            fields: [
              {
                path: 'action',
                label: '',
                format: 'calldata',
                params: { calleePath: '@.to' }
              }
            ]
          },
          'swap(address executor, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags) desc, bytes data)':
            {
              intent: 'Swap',
              fields: [
                {
                  path: 'desc.amount',
                  label: 'Amount to Send',
                  format: 'tokenAmount',
                  params: { tokenPath: 'desc.srcToken' }
                },
                {
                  path: 'desc.minReturnAmount',
                  label: 'Minimum to Receive',
                  format: 'tokenAmount',
                  params: { tokenPath: 'desc.dstToken' }
                }
              ]
            }
        }
      }
    }

    const irCalls = humanizeAccountOp(
      { ...accountOp, chainId: 10n },
      {
        erc7730Descriptors: {
          0: { descriptor }
        }
      }
    )

    compareHumanizerVisualizations(irCalls, [
      [
        getErc7730Visualization('Execute with permit', [
          {
            label: '',
            value: [
              getErc7730Visualization('Swap', [
                {
                  label: 'Amount to Send',
                  value: [getToken(aave, 39259598598468034n, 10n)]
                },
                {
                  label: 'Minimum to Receive',
                  value: [getToken(uni, 975332774259516356n, 10n)]
                }
              ])
            ]
          }
        ])
      ]
    ])
  })
  test('uses the Morpho Bundler3 ERC-7730 descriptor for Base multicall calldata', async () => {
    const morphoBundler = '0x6BFd8137e702540E7A42B74178A4a49Ba43920C4'
    const generalAdapter = '0xb98c948cfa24072e58935bc004a8a7b376ae746a'
    const baseUsdc = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
    const baseCbBtc = '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf'
    const owner = '0xd8293ad21678c6f09da139b4b62d38e514a03b78'
    const registryPath = 'registry/morpho/calldata-MorphoBundlerV3.json'
    const iface = new ethers.Interface([
      'function multicall((address to, bytes data, uint256 value, bool skipRevert, bytes32 callbackHash)[] bundle)'
    ])
    const generalAdapterInterface = new ethers.Interface(GeneralAdapter1)
    const marketParams = [
      baseUsdc,
      baseCbBtc,
      '0x663becd10dae6c4a3dcd89f1d76c1174199639b9',
      '0x46415998764c29ab2a25cbea6254146d50d22687',
      86145408065551n
    ]
    const morphoAccountOp: AccountOp = {
      ...accountOp,
      accountAddr: owner,
      chainId: 8453n,
      calls: [
        {
          to: morphoBundler,
          value: 0n,
          data: iface.encodeFunctionData('multicall', [
            [
              {
                to: generalAdapter,
                data: generalAdapterInterface.encodeFunctionData('erc20TransferFrom', [
                  baseUsdc,
                  generalAdapter,
                  2n
                ]),
                value: 0n,
                skipRevert: false,
                callbackHash: ethers.ZeroHash
              },
              {
                to: generalAdapter,
                data: generalAdapterInterface.encodeFunctionData('morphoRepay', [
                  marketParams,
                  0n,
                  220292767985000000n,
                  10n ** 27n,
                  owner,
                  '0x'
                ]),
                value: 0n,
                skipRevert: false,
                callbackHash: ethers.ZeroHash
              },
              {
                to: generalAdapter,
                data: generalAdapterInterface.encodeFunctionData('morphoWithdrawCollateral', [
                  marketParams,
                  2n,
                  owner
                ]),
                value: 0n,
                skipRevert: false,
                callbackHash: ethers.ZeroHash
              },
              {
                to: generalAdapter,
                data: generalAdapterInterface.encodeFunctionData('erc20Transfer', [
                  baseUsdc,
                  owner,
                  ethers.MaxUint256
                ]),
                value: 0n,
                skipRevert: false,
                callbackHash: ethers.ZeroHash
              },
              {
                to: generalAdapter,
                data: generalAdapterInterface.encodeFunctionData('erc20Transfer', [
                  baseCbBtc,
                  owner,
                  ethers.MaxUint256
                ]),
                value: 0n,
                skipRevert: false,
                callbackHash: ethers.ZeroHash
              }
            ]
          ])
        }
      ]
    }
    const callRelayer = async (path: string, method?: string, body?: any) => {
      if (path === '/v2/erc7730/account-op') {
        expect(method).toBe('GET')

        return {
          success: true,
          data: {
            [`eip155:8453:${morphoBundler.toLowerCase()}`]: registryPath
          },
          errorState: []
        }
      }

      if (path === '/v2/erc7730/fetch-descriptor') {
        expect(method).toBe('POST')
        expect(body).toEqual({ descriptorPath: `/${registryPath}` })

        return {
          success: true,
          display: {
            formats: {
              'multicall((address to, bytes data, uint256 value, bool skipRevert, bytes32 callbackHash)[] bundle)':
                {
                  intent: 'Bundler3 Multicall',
                  fields: [
                    {
                      path: '#.bundle.[].data',
                      label: 'Action',
                      format: 'calldata',
                      params: {
                        calleePath: '#.bundle.[].to',
                        amountPath: '#.bundle.[].value'
                      },
                      visible: 'always'
                    }
                  ]
                }
            }
          }
        }
      }

      throw new Error(`Unexpected ERC-7730 relayer call: ${path}`)
    }

    const descriptors = await fetchErc7730DescriptorsForAccountOp(morphoAccountOp, callRelayer)
    const irCalls = humanizeAccountOp(morphoAccountOp, { erc7730Descriptors: descriptors })

    expect(descriptors[0]?.path).toBe(registryPath)
    expect(hasErc7730Humanization(irCalls)).toBe(true)
    const visualization = irCalls[0]!.fullVisualization?.[0]
    expect(visualization).toMatchObject({
      type: 'erc7730',
      title: 'Bundler3 Multicall'
    })
    if (visualization?.type !== 'erc7730') throw new Error('Expected ERC-7730 visualization')

    expect(visualization.rows).toHaveLength(5)
    expect(visualization.rows.every((row) => row.label === 'Action')).toBe(true)
    expect(
      visualization.rows.map((row) => row.value.find((value) => value.type === 'action')?.content)
    ).toEqual(['Transfer', 'Repay', 'Withdraw', 'Transfer', 'Transfer'])
    expect(
      visualization.rows.map((row) => row.value.find((value) => value.type === 'token'))
    ).toEqual([
      expect.objectContaining({ address: baseUsdc, value: 2n }),
      expect.objectContaining({ address: baseUsdc, value: 220292767985000000n }),
      expect.objectContaining({ address: baseCbBtc, value: 2n }),
      expect.objectContaining({ address: baseUsdc, value: ethers.MaxUint256 }),
      expect.objectContaining({ address: baseCbBtc, value: ethers.MaxUint256 })
    ])
    expect(
      visualization.rows.flatMap((row) => row.value).some((value) => value.type === 'text')
    ).toBe(false)
    expect(
      visualization.rows
        .flatMap((row) => row.value)
        .some((value) =>
          ['0xd96ca0b9', '0x4d5fcf68', '0x1af3bbc6', '0x3790767d'].includes(value.content || '')
        )
    ).toBe(false)
  })

  test('uses standard ERC-7730 approval descriptors in a Permit2 + Universal Router batch', async () => {
    const baseCbBtc = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'
    const permit2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
    const universalRouter = '0xFdf682F51FE81Aa4898F0AE2163d8A55c127fbC7'
    const batchAccountOp: AccountOp = {
      ...accountOp,
      chainId: 8453n,
      calls: [
        {
          to: baseCbBtc,
          value: 0n,
          data: '0x095ea7b3000000000000000000000000000000000022d473030f116ddee9f6b43ac78ba3ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
        },
        {
          to: permit2,
          value: 0n,
          data: '0x87517c45000000000000000000000000cbb7c0000ab88b473b1f5afd9ef808440eed33bf000000000000000000000000fdf682f51fe81aa4898f0ae2163d8a55c127fbc7000000000000000000000000ffffffffffffffffffffffffffffffffffffffff000000000000000000000000000000000000000000000000000000006a2c1c44'
        },
        {
          to: universalRouter,
          value: 0n,
          data: '0x3593564c000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000006a04964d00000000000000000000000000000000000000000000000000000000000000011000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000003070b0e000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000026000000000000000000000000000000000000000000000000000000000000002e000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000cbb7c0000ab88b473b1f5afd9ef808440eed33bf00000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000001a000000000000000000000000000000000000000000000000000000000000009bb00000000000000000000000000000000000000000000000000000000001d84ef00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda0291300000000000000000000000000000000000000000000000000000000000001f4000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000cbb7c0000ab88b473b1f5afd9ef808440eed33bf000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000060000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913000000000000000000000000d8293ad21678c6f09da139b4b62d38e514a03b780000000000000000000000000000000000000000000000000000000000000000756e697800000000000c'
        }
      ]
    }
    const descriptors = await fetchErc7730DescriptorsForAccountOp(batchAccountOp)
    const irCalls = humanizeAccountOp(batchAccountOp, { erc7730Descriptors: descriptors })

    expect(Object.keys(descriptors)).toEqual(['0', '1'])
    expect(irCalls[0]!.fullVisualization?.[0]).toMatchObject({
      type: 'erc7730',
      title: 'Approve',
      rows: [{ label: 'Spender' }, { label: 'Amount' }]
    })
    expect(irCalls[1]!.fullVisualization?.[0]).toMatchObject({
      type: 'erc7730',
      title: 'Approve',
      rows: [{ label: 'Spender' }, { label: 'Amount' }, { label: 'Approval expires' }]
    })
    expect(irCalls[2]!.fullVisualization?.[0]).toMatchObject({
      type: 'action',
      content: 'Swap'
    })
  })

  test('uses the standard ERC-7730 transfer descriptor for ERC-20 transfers', async () => {
    const usdt = '0xdac17f958d2ee523a2206206994597c13d831ec7'
    const recipient = '0x46705dfff24256421a05d056c29e81bdc09723b8'
    const transferAccountOp: AccountOp = {
      ...accountOp,
      chainId: 1n,
      calls: [
        {
          to: usdt,
          value: 0n,
          data: '0xa9059cbb00000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000000000000000000000000000000000003b9aca00'
        }
      ]
    }
    const descriptors = await fetchErc7730DescriptorsForAccountOp(transferAccountOp)
    const irCalls = humanizeAccountOp(transferAccountOp, { erc7730Descriptors: descriptors })

    expect(Object.keys(descriptors)).toEqual(['0'])
    compareVisualizations(irCalls[0]!.fullVisualization || [], [
      getErc7730Visualization('Send', [
        {
          label: 'Amount',
          value: [getToken(usdt, 1000000000n, 1n)]
        },
        {
          label: 'To',
          value: [getAddressVisualization(recipient)]
        }
      ])
    ])
  })

  test('keeps the standard ERC-20 transfer descriptor for WETH when a registry descriptor exists', async () => {
    const recipient = '0x46705dfff24256421a05d056c29e81bdc09723b8'
    const wethRegistryPath = 'registry/weth/calldata-weth.json'
    const transferAccountOp: AccountOp = {
      ...accountOp,
      chainId: 1n,
      calls: [
        {
          to: WETH_ADDRESS,
          value: 0n,
          data: '0xa9059cbb00000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000000000000000000000000000000000003b9aca00'
        }
      ]
    }
    const callRelayer = async (path: string, method?: string, body?: any) => {
      if (path === '/v2/erc7730/account-op') {
        return {
          success: true,
          data: {
            [`eip155:1:${WETH_ADDRESS}`]: wethRegistryPath
          },
          errorState: []
        }
      }

      if (path === '/v2/erc7730/fetch-descriptor') {
        expect(method).toBe('POST')
        expect(body).toEqual({ descriptorPath: `/${wethRegistryPath}` })

        return {
          success: true,
          display: {
            formats: {
              'deposit()': {
                intent: 'Wrap',
                fields: [
                  {
                    path: '@.value',
                    label: 'Amount',
                    format: 'amount'
                  }
                ]
              }
            }
          }
        }
      }

      throw new Error(`Unexpected ERC-7730 relayer call: ${path}`)
    }

    const descriptors = await fetchErc7730DescriptorsForAccountOp(transferAccountOp, callRelayer)
    const irCalls = humanizeAccountOp(transferAccountOp, { erc7730Descriptors: descriptors })

    expect(Object.keys(descriptors)).toEqual(['0'])
    compareVisualizations(irCalls[0]!.fullVisualization || [], [
      getErc7730Visualization('Send', [
        {
          label: 'Amount',
          value: [getToken(WETH_ADDRESS, 1000000000n, 1n)]
        },
        {
          label: 'To',
          value: [getAddressVisualization(recipient)]
        }
      ])
    ])
  })

  test('fetches the calldata descriptor index through the relayer', async () => {
    const call = transactions.erc20[1]!
    const registryPath = 'registry/test/calldata-relayer-approval.json'
    const relayerAccountOp: AccountOp = {
      ...accountOp,
      chainId: 1n,
      calls: [call]
    }
    let relayerPath = ''
    const descriptorPaths: string[] = []
    const callRelayer = async (path: string, method?: string, body?: any) => {
      if (path === '/v2/erc7730/account-op') {
        expect(method).toBe('GET')

        relayerPath = path
        return {
          success: true,
          data: {
            [`eip155:1:${call.to.toLowerCase()}`]: registryPath
          },
          errorState: []
        }
      }

      if (path === '/v2/erc7730/fetch-descriptor') {
        expect(method).toBe('POST')
        expect(body).toEqual({ descriptorPath: `/${registryPath}` })
        descriptorPaths.push(body.descriptorPath)

        return {
          success: true,
          display: {
            formats: {
              'approve(address _spender, uint256 _value)': {
                intent: 'Authorize via relayer',
                fields: [
                  {
                    path: '#._spender',
                    label: 'Spender',
                    format: 'addressName',
                    visible: 'always'
                  },
                  {
                    path: '#._value',
                    label: 'Amount allowance',
                    format: 'tokenAmount',
                    params: { tokenPath: '@.to' },
                    visible: 'always'
                  }
                ]
              }
            }
          }
        }
      }

      throw new Error(`Unexpected ERC-7730 relayer call: ${path}`)
    }

    const descriptors = await fetchErc7730DescriptorsForAccountOp(relayerAccountOp, callRelayer)
    const irCalls = humanizeAccountOp(relayerAccountOp, { erc7730Descriptors: descriptors })

    expect(relayerPath).toBe('/v2/erc7730/account-op')
    expect(descriptorPaths).toEqual([`/${registryPath}`])
    expect(descriptors[0]?.path).toBe(registryPath)
    compareVisualizations(irCalls[0]!.fullVisualization || [], [
      getErc7730Visualization('Authorize via relayer', [
        {
          label: 'Spender',
          value: [getAddressVisualization('0x46705dfff24256421a05d056c29e81bdc09723b8')]
        },
        {
          label: 'Amount allowance',
          value: [getToken('0xdac17f958d2ee523a2206206994597c13d831ec7', 1000000000n, 1n)]
        }
      ])
    ])
  })

  test('falls back to the built-in calldata descriptor when the relayer index fails', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const call = transactions.erc20[1]!
    const fallbackAccountOp: AccountOp = {
      ...accountOp,
      chainId: 1n,
      calls: [call]
    }
    const callRelayer = async () => {
      throw new Error('relayer down')
    }

    try {
      const descriptors = await fetchErc7730DescriptorsForAccountOp(fallbackAccountOp, callRelayer)
      expect(Object.keys(descriptors)).toEqual(['0'])
      expect(descriptors[0]?.path).toBe('built-in/erc20-approve')
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  test('resolves Safe execTransaction through the Safe singleton and humanizes inner calls only', async () => {
    const safeProxy = '0x714fd3db837e72bd49b8eda02b8f4d53dfdde5ce'
    const safeSingleton = '0x29fcb43b46531bca003ddc8fcb67ffe91900c762'
    const multiSend = '0x9641d764fc13c8b624c04430c7356c1c7c8102e2'
    const tokenAddress = '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf'
    const spender = '0xc92e8bdf79f0507f65a392b0ab4667716bfe0110'
    const settlement = '0x9008d19f58aabd9ed0d60971565aa8510560ab41'
    const multiSendData =
      '0x8d80ff0a0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000019200cbb7c0000ab88b473b1f5afd9ef808440eed33bf00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000044095ea7b3000000000000000000000000c92e8bdf79f0507f65a392b0ab4667716bfe011000000000000000000000000000000000000000000000000000000000000005ea009008d19f58aabd9ed0d60971565aa8510560ab41000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a4ec6cb13f000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000038cc9abd7869bc44faf6552057bc09b84f0d691eb0b0e484600012cca91d529763714fd3db837e72bd49b8eda02b8f4d53dfdde5ce6a11965300000000000000000000000000000000000000000000'
    const execTransactionData = new ethers.Interface(execTransactionAbi).encodeFunctionData(
      'execTransaction',
      [multiSend, 0, multiSendData, 1, 0, 0, 0, ZeroAddress, ZeroAddress, '0x']
    )
    const safeExecAccountOp: AccountOp = {
      ...accountOp,
      chainId: 8453n,
      calls: [
        {
          to: safeProxy,
          value: 0n,
          data: execTransactionData
        }
      ]
    }
    const provider = {
      getStorage: jest.fn(async (address: string) => {
        expect(address.toLowerCase()).toBe(safeProxy)

        return ethers.zeroPadValue(safeSingleton, 32)
      })
    }
    const descriptorPath = 'registry/safe/calldata-SafeL2-1.4.1.json'
    const callRelayer = async (path: string, method?: string, body?: any) => {
      if (path === '/v2/erc7730/account-op') {
        expect(method).toBe('GET')

        return {
          success: true,
          data: {
            [`eip155:8453:${safeSingleton}`]: descriptorPath
          },
          errorState: []
        }
      }

      if (path === '/v2/erc7730/fetch-descriptor') {
        expect(method).toBe('POST')
        expect(body).toEqual({ descriptorPath: `/${descriptorPath}` })

        return {
          success: true,
          display: {
            formats: {}
          }
        }
      }

      throw new Error(`Unexpected ERC-7730 relayer call: ${path}`)
    }

    const descriptors = await fetchErc7730DescriptorsForAccountOp(safeExecAccountOp, {
      callRelayer,
      provider: provider as any
    })
    const irCalls = humanizeAccountOp(safeExecAccountOp, { erc7730Descriptors: descriptors })

    expect(provider.getStorage).toHaveBeenCalledTimes(1)
    expect(descriptors[0]?.safeTxTransactionsOnly).toBe(true)
    expect(descriptors[0]?.safeTxCalls).toHaveLength(2)
    compareVisualizations(irCalls[0]!.fullVisualization || [], [
      getErc7730Visualization('Execute a Safe{Wallet} Transaction', [
        {
          label: '',
          value: [
            getErc7730Visualization('Approve', [
              {
                label: 'Spender',
                value: [getAddressVisualization(spender)]
              },
              {
                label: 'Amount',
                value: [getToken(tokenAddress, 1514n, 8453n)]
              }
            ]),
            getErc7730Visualization('setPreSignature', [
              {
                label: 'Contract',
                value: [getAddressVisualization(settlement)]
              }
            ])
          ]
        }
      ])
    ])
  })

  test('fetches the EIP-712 descriptor index through the relayer', async () => {
    const registryPath = 'registry/test/eip712-relayer-permit.json'
    const permitMessage = {
      fromRequestId: 1,
      accountAddr: accountOp.accountAddr,
      content: {
        kind: 'typedMessage',
        domain: {
          name: 'Wrapped Ether',
          version: '1',
          chainId: 1,
          verifyingContract: WETH_ADDRESS
        },
        types: {
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' }
          ]
        },
        primaryType: 'Permit',
        message: {
          owner: accountOp.accountAddr,
          spender: address2,
          value: 133700n,
          nonce: 1n,
          deadline: ethers.MaxUint256
        }
      },
      signature: null,
      chainId: 1n
    }
    let relayerPath = ''
    const descriptorPaths: string[] = []
    const callRelayer = async (path: string, method?: string, body?: any) => {
      if (path === '/v2/erc7730/eip-712') {
        expect(method).toBe('GET')

        relayerPath = path
        return {
          success: true,
          data: {
            [`eip155:1:${WETH_ADDRESS}`]: {
              Permit: [{ path: registryPath }]
            }
          },
          errorState: []
        }
      }

      if (path === '/v2/erc7730/fetch-descriptor') {
        expect(method).toBe('POST')
        expect(body).toEqual({ descriptorPath: `/${registryPath}` })
        descriptorPaths.push(body.descriptorPath)

        return {
          success: true,
          display: {
            formats: {
              'Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)':
                {
                  intent: 'Authorize spending of tokens',
                  fields: [
                    {
                      path: 'spender',
                      label: 'Spender',
                      format: 'raw',
                      visible: 'always'
                    },
                    {
                      path: 'value',
                      label: 'Max spending amount',
                      format: 'tokenAmount',
                      params: { tokenPath: '@.to' },
                      visible: 'always'
                    }
                  ]
                }
            }
          }
        }
      }

      throw new Error(`Unexpected ERC-7730 relayer call: ${path}`)
    }

    const descriptor = await fetchErc7730DescriptorForMessage(permitMessage as any, callRelayer)

    expect(relayerPath).toBe('/v2/erc7730/eip-712')
    expect(descriptorPaths).toEqual([`/${registryPath}`])
    expect(descriptor?.path).toBe(registryPath)
  })

  test('prioritizes descriptor EIP-712 humanization over local modules', async () => {
    const permitMessage = {
      fromRequestId: 1,
      accountAddr: accountOp.accountAddr,
      content: {
        kind: 'typedMessage',
        domain: {
          name: 'USD Coin',
          version: '2',
          chainId: 1,
          verifyingContract: WETH_ADDRESS
        },
        types: {
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' }
          ]
        },
        primaryType: 'Permit',
        message: {
          owner: accountOp.accountAddr,
          spender: address2,
          value: 133700n,
          nonce: 1n,
          deadline: ethers.MaxUint256
        }
      },
      signature: null,
      chainId: 1n
    }

    const irMessage = humanizeMessage(permitMessage as any, {
      erc7730Descriptor: {
        descriptor: {
          display: {
            formats: {
              'Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)':
                {
                  intent: 'Authorize spending of tokens',
                  fields: [
                    {
                      path: 'spender',
                      label: 'Spender',
                      format: 'raw',
                      visible: 'always'
                    },
                    {
                      path: 'value',
                      label: 'Max spending amount',
                      format: 'tokenAmount',
                      params: { tokenPath: '@.to' },
                      visible: 'always'
                    },
                    {
                      path: 'deadline',
                      label: 'Valid until',
                      format: 'date',
                      params: { encoding: 'timestamp' }
                    }
                  ]
                }
            }
          }
        }
      }
    })

    compareVisualizations(irMessage.fullVisualization || [], [
      getErc7730Visualization('Authorize spending of tokens', [
        {
          label: 'Spender',
          value: [getAddressVisualization(address2)]
        },
        {
          label: 'Max spending amount',
          value: [getToken(WETH_ADDRESS, 133700n, 1n)]
        },
        {
          label: 'Valid until',
          value: [getText('No expiration')]
        }
      ])
    ])
  })

  test('humanizes 1inch Order EIP-712 and hides zero address To row', async () => {
    const aggregationRouter = '0x111111125421ca6dc452d289314280a0f8842a65'
    const makerAsset = '0x350a791bfc2c21f9ed5d10980dad2e2638ffa7f6'
    const takerAsset = '0x76fb31fb4af56892a25e32cfc43de717950c9278'
    const oneInchOrderMessage = {
      fromRequestId: 1,
      accountAddr: accountOp.accountAddr,
      content: {
        kind: 'typedMessage',
        types: {
          Order: [
            { name: 'salt', type: 'uint256' },
            { name: 'maker', type: 'address' },
            { name: 'receiver', type: 'address' },
            { name: 'makerAsset', type: 'address' },
            { name: 'takerAsset', type: 'address' },
            { name: 'makingAmount', type: 'uint256' },
            { name: 'takingAmount', type: 'uint256' },
            { name: 'makerTraits', type: 'uint256' }
          ],
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'version', type: 'string' },
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' }
          ]
        },
        domain: {
          name: '1inch Aggregation Router',
          version: '6',
          chainId: '0xa',
          verifyingContract: aggregationRouter
        },
        message: {
          salt: '77345521712855512255420844903274714029333070352494440782855394858654424276150',
          maker: '0xd8293ad21678c6f09da139b4b62d38e514a03b78',
          receiver: ZeroAddress,
          makerAsset,
          takerAsset,
          makingAmount: '366891214241290415',
          takingAmount: '39061263450812873',
          makerTraits:
            '62419173104490761595518734106350460423656760415424099978067514748855868456960'
        },
        primaryType: 'Order'
      },
      signature: null,
      chainId: 10n
    }

    const irMessage = humanizeMessage(oneInchOrderMessage as any, {
      erc7730Descriptor: {
        descriptor: {
          display: {
            formats: {
              'Order(uint256 salt,address maker,address receiver,address makerAsset,address takerAsset,uint256 makingAmount,uint256 takingAmount,uint256 makerTraits)':
                {
                  intent: '1inch Order',
                  fields: [
                    { path: 'maker', label: 'From', format: 'raw' },
                    {
                      path: 'makingAmount',
                      label: 'Send',
                      format: 'tokenAmount',
                      params: { tokenPath: 'makerAsset' }
                    },
                    {
                      path: 'takingAmount',
                      label: 'Receive minimum',
                      format: 'tokenAmount',
                      params: { tokenPath: 'takerAsset' }
                    },
                    { path: 'receiver', label: 'To', format: 'raw' },
                    { label: 'Salt', path: 'salt', visible: 'never' },
                    { label: 'Maker Traits', path: 'makerTraits', visible: 'never' }
                  ]
                }
            }
          }
        }
      }
    })

    expect(irMessage.canHideDropdownArrow).toBe(true)
    compareVisualizations(irMessage.fullVisualization || [], [
      getErc7730Visualization('1inch Order', [
        {
          label: 'From',
          value: [getAddressVisualization('0xd8293ad21678c6f09da139b4b62d38e514a03b78')]
        },
        {
          label: 'Send',
          value: [getToken(makerAsset, 366891214241290415n, 10n)]
        },
        {
          label: 'Receive minimum',
          value: [getToken(takerAsset, 39061263450812873n, 10n)]
        }
      ])
    ])
  })

  test('humanizes the nested transaction row in a SafeTx EIP-712 message', async () => {
    const tokenAddress = '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf'
    const recipient = '0xa04d21b7ae298d8e4a61a507de2b7ceafd90ba01'
    const safeTxMessage = {
      fromRequestId: 1,
      accountAddr: accountOp.accountAddr,
      content: {
        kind: 'typedMessage',
        types: {
          EIP712Domain: [
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' }
          ],
          SafeTx: [
            { type: 'address', name: 'to' },
            { type: 'uint256', name: 'value' },
            { type: 'bytes', name: 'data' },
            { type: 'uint8', name: 'operation' },
            { type: 'uint256', name: 'safeTxGas' },
            { type: 'uint256', name: 'baseGas' },
            { type: 'uint256', name: 'gasPrice' },
            { type: 'address', name: 'gasToken' },
            { type: 'address', name: 'refundReceiver' },
            { type: 'uint256', name: 'nonce' }
          ]
        },
        domain: {
          verifyingContract: '0x714fd3db837e72bd49b8eda02b8f4d53dfdde5ce',
          chainId: 8453
        },
        message: {
          to: tokenAddress,
          value: '0',
          data: `0xa9059cbb000000000000000000000000${recipient.slice(
            2
          )}0000000000000000000000000000000000000000000000000000000000000064`,
          operation: 0,
          baseGas: '0',
          gasPrice: '0',
          gasToken: ZeroAddress,
          refundReceiver: ZeroAddress,
          nonce: 81,
          safeTxGas: '0'
        },
        primaryType: 'SafeTx'
      },
      signature: null,
      chainId: 8453n
    }

    const irMessage = humanizeMessage(safeTxMessage as any, {
      erc7730Descriptor: {
        descriptor: {
          display: {
            formats: {
              'SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)':
                {
                  intent: 'Safe',
                  fields: [
                    { path: 'operation', label: 'Operation type' },
                    {
                      path: 'data',
                      label: 'Transaction',
                      format: 'calldata',
                      params: { calleePath: '#.to' }
                    },
                    { path: 'safeTxGas', label: 'Gas amount' },
                    { path: 'gasPrice', label: 'Gas price' },
                    { path: 'gasToken', label: 'Gas token', format: 'addressName' },
                    { path: 'refundReceiver', label: 'Gas receiver', format: 'addressName' }
                  ]
                }
            }
          }
        },
        safeTxCallDescriptor: {
          descriptor: {
            display: {
              formats: {
                'transfer(address _to, uint256 _value)': {
                  intent: 'Send',
                  fields: [
                    {
                      path: '_value',
                      label: 'Amount',
                      format: 'tokenAmount',
                      params: { tokenPath: '@.to' },
                      visible: 'always'
                    },
                    {
                      path: '_to',
                      label: 'To',
                      format: 'addressName',
                      visible: 'always'
                    }
                  ]
                }
              }
            }
          }
        }
      }
    })

    compareVisualizations(irMessage.fullVisualization || [], [
      getErc7730Visualization('Safe', [
        {
          label: 'Operation type',
          value: [getText('0')]
        },
        {
          label: 'Transaction',
          value: [
            getErc7730Visualization('Send', [
              {
                label: 'Amount',
                value: [getToken(tokenAddress, 100n, 8453n)]
              },
              {
                label: 'To',
                value: [getAddressVisualization(recipient)]
              }
            ])
          ]
        },
        {
          label: 'Gas amount',
          value: [getText('0')]
        },
        {
          label: 'Gas price',
          value: [getText('0')]
        },
        {
          label: 'Gas token',
          value: [getAddressVisualization(ZeroAddress)]
        },
        {
          label: 'Gas receiver',
          value: [getAddressVisualization(ZeroAddress)]
        }
      ])
    ])
  })

  test('humanizes a SafeTx owner change with the Safe singleton descriptor fallback', async () => {
    const safeProxy = '0x714fd3db837e72bd49b8eda02b8f4d53dfdde5ce'
    const safeSingleton = '0x29fcb43b46531bca003ddc8fcb67ffe91900c762'
    const newOwner = '0xa04d21b7ae298d8e4a61a507de2b7ceafd90ba01'
    const eip712DescriptorPath = 'registry/safe/eip712-SafeL2-1.4.1.json'
    const calldataDescriptorPath = 'registry/safe/calldata-SafeL2-1.4.1.json'
    const safeTxMessage = {
      fromRequestId: 1,
      accountAddr: accountOp.accountAddr,
      content: {
        kind: 'typedMessage',
        types: {
          EIP712Domain: [
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' }
          ],
          SafeTx: [
            { type: 'address', name: 'to' },
            { type: 'uint256', name: 'value' },
            { type: 'bytes', name: 'data' },
            { type: 'uint8', name: 'operation' },
            { type: 'uint256', name: 'safeTxGas' },
            { type: 'uint256', name: 'baseGas' },
            { type: 'uint256', name: 'gasPrice' },
            { type: 'address', name: 'gasToken' },
            { type: 'address', name: 'refundReceiver' },
            { type: 'uint256', name: 'nonce' }
          ]
        },
        domain: {
          verifyingContract: safeProxy,
          chainId: 8453
        },
        message: {
          to: safeProxy,
          value: '0',
          data: `0x0d582f13000000000000000000000000${newOwner.slice(
            2
          )}0000000000000000000000000000000000000000000000000000000000000003`,
          operation: 0,
          baseGas: '0',
          gasPrice: '0',
          gasToken: ZeroAddress,
          refundReceiver: ZeroAddress,
          nonce: 85,
          safeTxGas: '0'
        },
        primaryType: 'SafeTx'
      },
      signature: null,
      chainId: 8453n
    }
    const fetchedDescriptorPaths: string[] = []
    const callRelayer = jest.fn(async (path: string, method?: string, body?: any) => {
      if (path === '/v2/erc7730/eip-712') {
        expect(method).toBe('GET')

        return {
          success: true,
          data: {
            [`eip155:8453:${safeSingleton}`]: {
              SafeTx: [
                {
                  path: eip712DescriptorPath
                }
              ]
            }
          },
          errorState: []
        }
      }

      if (path === '/v2/erc7730/account-op') {
        expect(method).toBe('GET')

        return {
          success: true,
          data: {
            [`eip155:8453:${safeSingleton}`]: calldataDescriptorPath
          },
          errorState: []
        }
      }

      if (path === '/v2/erc7730/fetch-descriptor') {
        expect(method).toBe('POST')
        fetchedDescriptorPaths.push(body.descriptorPath)

        if (body.descriptorPath === `/${eip712DescriptorPath}`) {
          return {
            success: true,
            display: {
              formats: {
                'SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)':
                  {
                    intent: 'Safe',
                    fields: [
                      { path: 'operation', label: 'Operation type' },
                      {
                        path: 'data',
                        label: 'Transaction',
                        format: 'calldata',
                        params: { calleePath: '#.to' }
                      },
                      { path: 'safeTxGas', label: 'Gas amount' },
                      { path: 'gasPrice', label: 'Gas price' },
                      { path: 'gasToken', label: 'Gas token', format: 'addressName' },
                      { path: 'refundReceiver', label: 'Gas receiver', format: 'addressName' }
                    ]
                  }
              }
            }
          }
        }

        if (body.descriptorPath === `/${calldataDescriptorPath}`) {
          return {
            success: true,
            display: {
              formats: {}
            }
          }
        }
      }

      throw new Error(`Unexpected ERC-7730 relayer call: ${path}`)
    })
    const provider = {
      getStorage: jest.fn(async (address: string, slot: bigint) => {
        expect(address).toBe(safeProxy)
        expect(slot).toBe(0n)

        return `0x000000000000000000000000${safeSingleton.slice(2)}`
      })
    }

    const descriptor = await fetchErc7730DescriptorForMessage(
      safeTxMessage as any,
      callRelayer,
      provider as any
    )
    const irMessage = humanizeMessage(safeTxMessage as any, {
      erc7730Descriptor: descriptor || undefined
    })

    expect(descriptor?.path).toBe(eip712DescriptorPath)
    expect(descriptor?.safeTxCallDescriptor?.path).toBe(calldataDescriptorPath)
    expect(fetchedDescriptorPaths).toEqual([
      `/${eip712DescriptorPath}`,
      `/${calldataDescriptorPath}`
    ])
    expect(provider.getStorage).toHaveBeenCalledTimes(1)
    compareVisualizations(irMessage.fullVisualization || [], [
      getErc7730Visualization('Safe', [
        {
          label: 'Operation type',
          value: [getText('0')]
        },
        {
          label: 'Transaction',
          value: [
            getErc7730Visualization('Add owner', [
              {
                label: 'Add owner',
                value: [
                  getAddressVisualization(newOwner),
                  getAction('and set threshold to'),
                  getLabel('3')
                ]
              }
            ])
          ]
        },
        {
          label: 'Gas amount',
          value: [getText('0')]
        },
        {
          label: 'Gas price',
          value: [getText('0')]
        },
        {
          label: 'Gas token',
          value: [getAddressVisualization(ZeroAddress)]
        },
        {
          label: 'Gas receiver',
          value: [getAddressVisualization(ZeroAddress)]
        }
      ])
    ])
    expect(irMessage.warnings).toEqual([
      getWarning('Owner & threshold configuration changes detected', 'SAFE{WALLET}_CONFIG_CHANGE')
    ])
  })

  test('humanizes SafeTx multisend transactions as nested transaction rows', async () => {
    const tokenAddress = '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf'
    const recipientOne = '0xa04d21b7ae298d8e4a61a507de2b7ceafd90ba01'
    const recipientTwo = '0xd8293ad21678c6f09da139b4b62d38e514a03b78'
    const transferDataOne = `0xa9059cbb000000000000000000000000${recipientOne.slice(
      2
    )}0000000000000000000000000000000000000000000000000000000000000064`
    const transferDataTwo = `0xa9059cbb000000000000000000000000${recipientTwo.slice(
      2
    )}00000000000000000000000000000000000000000000000000000000000000c8`
    const transactionsData = ethers.concat([
      ethers.solidityPacked(
        ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
        [0, tokenAddress, 0n, BigInt(ethers.getBytes(transferDataOne).length), transferDataOne]
      ),
      ethers.solidityPacked(
        ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
        [0, tokenAddress, 0n, BigInt(ethers.getBytes(transferDataTwo).length), transferDataTwo]
      )
    ])
    const multiSendData = new ethers.Interface([
      'function multiSend(bytes transactions)'
    ]).encodeFunctionData('multiSend', [transactionsData])
    const safeTxMessage = {
      fromRequestId: 1,
      accountAddr: accountOp.accountAddr,
      content: {
        kind: 'typedMessage',
        types: {
          EIP712Domain: [
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' }
          ],
          SafeTx: [
            { type: 'address', name: 'to' },
            { type: 'uint256', name: 'value' },
            { type: 'bytes', name: 'data' },
            { type: 'uint8', name: 'operation' },
            { type: 'uint256', name: 'safeTxGas' },
            { type: 'uint256', name: 'baseGas' },
            { type: 'uint256', name: 'gasPrice' },
            { type: 'address', name: 'gasToken' },
            { type: 'address', name: 'refundReceiver' },
            { type: 'uint256', name: 'nonce' }
          ]
        },
        domain: {
          verifyingContract: '0x714fd3db837e72bd49b8eda02b8f4d53dfdde5ce',
          chainId: 8453
        },
        message: {
          to: '0x8d80ff0a632a8a7ba2e219e2c4b79f8f3cd2d81b',
          value: '0',
          data: multiSendData,
          operation: 1,
          baseGas: '0',
          gasPrice: '0',
          gasToken: ZeroAddress,
          refundReceiver: ZeroAddress,
          nonce: 81,
          safeTxGas: '0'
        },
        primaryType: 'SafeTx'
      },
      signature: null,
      chainId: 8453n
    }

    const irMessage = humanizeMessage(safeTxMessage as any, {
      erc7730Descriptor: {
        descriptor: {
          display: {
            formats: {
              'SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)':
                {
                  intent: 'Safe',
                  fields: [
                    { path: 'operation', label: 'Operation type' },
                    {
                      path: 'data',
                      label: 'Transaction',
                      format: 'calldata',
                      params: { calleePath: '#.to' }
                    },
                    { path: 'safeTxGas', label: 'Gas amount' },
                    { path: 'gasPrice', label: 'Gas price' },
                    { path: 'gasToken', label: 'Gas token', format: 'addressName' },
                    { path: 'refundReceiver', label: 'Gas receiver', format: 'addressName' }
                  ]
                }
            }
          }
        }
      }
    })

    compareVisualizations(irMessage.fullVisualization || [], [
      getErc7730Visualization('Safe', [
        {
          label: 'Operation type',
          value: [getText('1')]
        },
        {
          label: 'Transactions',
          value: [
            getErc7730Visualization('Send', [
              {
                label: 'Send',
                value: [getToken(tokenAddress, 100n)]
              },
              {
                label: 'To',
                value: [getAddressVisualization(recipientOne)]
              }
            ]),
            getErc7730Visualization('Send', [
              {
                label: 'Send',
                value: [getToken(tokenAddress, 200n)]
              },
              {
                label: 'To',
                value: [getAddressVisualization(recipientTwo)]
              }
            ])
          ]
        },
        {
          label: 'Gas amount',
          value: [getText('0')]
        },
        {
          label: 'Gas price',
          value: [getText('0')]
        },
        {
          label: 'Gas token',
          value: [getAddressVisualization(ZeroAddress)]
        },
        {
          label: 'Gas receiver',
          value: [getAddressVisualization(ZeroAddress)]
        }
      ])
    ])
  })

  test('humanizes SafeTx multisend with truncated ABI padding as separate transaction rows', async () => {
    const tokenAddress = '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf'
    const spender = '0xc92e8bdf79f0507f65a392b0ab4667716bfe0110'
    const settlement = '0x9008d19f58aabd9ed0d60971565aa8510560ab41'
    const safeTxMessage = {
      fromRequestId: 1,
      accountAddr: accountOp.accountAddr,
      content: {
        kind: 'typedMessage',
        types: {
          EIP712Domain: [
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' }
          ],
          SafeTx: [
            { type: 'address', name: 'to' },
            { type: 'uint256', name: 'value' },
            { type: 'bytes', name: 'data' },
            { type: 'uint8', name: 'operation' },
            { type: 'uint256', name: 'safeTxGas' },
            { type: 'uint256', name: 'baseGas' },
            { type: 'uint256', name: 'gasPrice' },
            { type: 'address', name: 'gasToken' },
            { type: 'address', name: 'refundReceiver' },
            { type: 'uint256', name: 'nonce' }
          ]
        },
        domain: {
          verifyingContract: '0x714fd3db837e72bd49b8eda02b8f4d53dfdde5ce',
          chainId: 8453
        },
        message: {
          to: '0x9641d764fc13c8b624c04430c7356c1c7c8102e2',
          value: '0',
          data: '0x8d80ff0a0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000019200cbb7c0000ab88b473b1f5afd9ef808440eed33bf00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000044095ea7b3000000000000000000000000c92e8bdf79f0507f65a392b0ab4667716bfe011000000000000000000000000000000000000000000000000000000000000005ea009008d19f58aabd9ed0d60971565aa8510560ab41000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a4ec6cb13f000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000038cc9abd7869bc44faf6552057bc09b84f0d691eb0b0e484600012cca91d529763714fd3db837e72bd49b8eda02b8f4d53dfdde5ce6a11965300000000000000000000000000000000000000000000',
          operation: 1,
          baseGas: '0',
          gasPrice: '0',
          gasToken: ZeroAddress,
          refundReceiver: ZeroAddress,
          nonce: 81,
          safeTxGas: '0'
        },
        primaryType: 'SafeTx'
      },
      signature: null,
      chainId: 8453n
    }

    const irMessage = humanizeMessage(safeTxMessage as any, {
      erc7730Descriptor: {
        descriptor: {
          display: {
            formats: {
              'SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)':
                {
                  intent: 'Safe',
                  fields: [
                    { path: 'operation', label: 'Operation type' },
                    {
                      path: 'data',
                      label: 'Transaction',
                      format: 'calldata',
                      params: { calleePath: '#.to' }
                    },
                    { path: 'safeTxGas', label: 'Gas amount' },
                    { path: 'gasPrice', label: 'Gas price' },
                    { path: 'gasToken', label: 'Gas token', format: 'addressName' },
                    { path: 'refundReceiver', label: 'Gas receiver', format: 'addressName' }
                  ]
                }
            }
          }
        }
      }
    })

    compareVisualizations(irMessage.fullVisualization || [], [
      getErc7730Visualization('Safe', [
        {
          label: 'Operation type',
          value: [getText('1')]
        },
        {
          label: 'Transactions',
          value: [
            getErc7730Visualization('Grant approval', [
              {
                label: 'For',
                value: [getToken(tokenAddress, 1514n)]
              },
              {
                label: 'To',
                value: [getAddressVisualization(spender)]
              }
            ]),
            getErc7730Visualization('setPreSignature', [
              {
                label: 'Contract',
                value: [getAddressVisualization(settlement)]
              }
            ])
          ]
        },
        {
          label: 'Gas amount',
          value: [getText('0')]
        },
        {
          label: 'Gas price',
          value: [getText('0')]
        },
        {
          label: 'Gas token',
          value: [getAddressVisualization(ZeroAddress)]
        },
        {
          label: 'Gas receiver',
          value: [getAddressVisualization(ZeroAddress)]
        }
      ])
    ])
  })

  test('humanizes SafeTx multisend module actions after the ERC-7730 Safe summary', async () => {
    const safeProxy = '0x714fd3db837e72bd49b8eda02b8f4d53dfdde5ce'
    const allowanceModule = '0xcfbfac74c26f8647cbdb8c5caf80bb5b32e43134'
    const delegate = '0x8c8979A7d79C4CdDA170C008b797d466F00dD167'
    const safeTxMessage = {
      fromRequestId: 1,
      accountAddr: accountOp.accountAddr,
      content: {
        kind: 'typedMessage',
        types: {
          EIP712Domain: [
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' }
          ],
          SafeTx: [
            { type: 'address', name: 'to' },
            { type: 'uint256', name: 'value' },
            { type: 'bytes', name: 'data' },
            { type: 'uint8', name: 'operation' },
            { type: 'uint256', name: 'safeTxGas' },
            { type: 'uint256', name: 'baseGas' },
            { type: 'uint256', name: 'gasPrice' },
            { type: 'address', name: 'gasToken' },
            { type: 'address', name: 'refundReceiver' },
            { type: 'uint256', name: 'nonce' }
          ]
        },
        domain: {
          verifyingContract: safeProxy,
          chainId: 8453
        },
        message: {
          to: '0x9641d764fc13c8b624c04430c7356c1c7c8102e2',
          value: '0',
          data: '0x8d80ff0a000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000001eb00714fd3db837e72bd49b8eda02b8f4d53dfdde5ce00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000024610b5925000000000000000000000000cfbfac74c26f8647cbdb8c5caf80bb5b32e4313400cfbfac74c26f8647cbdb8c5caf80bb5b32e4313400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000024e71bdf410000000000000000000000008c8979a7d79c4cdda170c008b797d466f00dd16700cfbfac74c26f8647cbdb8c5caf80bb5b32e43134000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a4beaeb3880000000000000000000000008c8979a7d79c4cdda170c008b797d466f00dd16700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000de0b6b3a764000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
          operation: 1,
          baseGas: '0',
          gasPrice: '0',
          gasToken: ZeroAddress,
          refundReceiver: ZeroAddress,
          nonce: 85,
          safeTxGas: '0'
        },
        primaryType: 'SafeTx'
      },
      signature: null,
      chainId: 8453n
    }

    const irMessage = humanizeMessage(safeTxMessage as any, {
      erc7730Descriptor: {
        descriptor: {
          display: {
            formats: {
              'SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)':
                {
                  intent: 'Enable module:',
                  fields: [
                    {
                      path: 'to',
                      label: 'Enable module:',
                      format: 'addressName',
                      visible: 'always'
                    },
                    { path: 'operation', label: 'Operation type' },
                    { path: 'safeTxGas', label: 'Gas amount' },
                    { path: 'gasPrice', label: 'Gas price' },
                    { path: 'gasToken', label: 'Gas token', format: 'addressName' },
                    { path: 'refundReceiver', label: 'Gas receiver', format: 'addressName' }
                  ]
                }
            }
          }
        }
      }
    })

    compareVisualizations(irMessage.fullVisualization || [], [
      getErc7730Visualization('Enable module:', [
        {
          label: 'Enable module:',
          value: [getAddressVisualization('0x9641d764fc13c8b624c04430c7356c1c7c8102e2')]
        },
        {
          label: 'Operation type',
          value: [getText('1')]
        },
        {
          label: 'Gas amount',
          value: [getText('0')]
        },
        {
          label: 'Gas price',
          value: [getText('0')]
        },
        {
          label: 'Gas token',
          value: [getAddressVisualization(ZeroAddress)]
        },
        {
          label: 'Gas receiver',
          value: [getAddressVisualization(ZeroAddress)]
        },
        {
          label: 'Transactions',
          value: [
            getErc7730Visualization('Enable module:', [
              {
                label: 'Enable module:',
                value: [getAddressVisualization(allowanceModule)]
              }
            ]),
            getErc7730Visualization('Add delegate', [
              {
                label: 'Add delegate',
                value: [getAddressVisualization(delegate)]
              }
            ]),
            getErc7730Visualization('Allow', [
              {
                label: 'Allow',
                value: [getAddressVisualization(delegate)]
              },
              {
                label: 'To spend',
                value: [getToken(ZeroAddress, 1000000000000000000n), getText('No reset', true)]
              }
            ])
          ]
        }
      ])
    ])
    expect(irMessage.warnings).toEqual([
      getWarning(
        'Modules can execute transactions if conditions are met',
        'SAFE{WALLET}_CONFIG_CHANGE'
      )
    ])
  })

  test('keeps the SafeTx ERC-7730 summary when multisend decoding fails', async () => {
    const safeTxMessage = {
      fromRequestId: 1,
      accountAddr: accountOp.accountAddr,
      content: {
        kind: 'typedMessage',
        types: {
          EIP712Domain: [
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' }
          ],
          SafeTx: [
            { type: 'address', name: 'to' },
            { type: 'uint256', name: 'value' },
            { type: 'bytes', name: 'data' },
            { type: 'uint8', name: 'operation' },
            { type: 'uint256', name: 'safeTxGas' },
            { type: 'uint256', name: 'baseGas' },
            { type: 'uint256', name: 'gasPrice' },
            { type: 'address', name: 'gasToken' },
            { type: 'address', name: 'refundReceiver' },
            { type: 'uint256', name: 'nonce' }
          ]
        },
        domain: {
          verifyingContract: '0x714fd3db837e72bd49b8eda02b8f4d53dfdde5ce',
          chainId: 8453
        },
        message: {
          to: '0x9641d764fc13c8b624c04430c7356c1c7c8102e2',
          value: '0',
          data: '0x1234',
          operation: 1,
          baseGas: '0',
          gasPrice: '0',
          gasToken: ZeroAddress,
          refundReceiver: ZeroAddress,
          nonce: 85,
          safeTxGas: '0'
        },
        primaryType: 'SafeTx'
      },
      signature: null,
      chainId: 8453n
    }

    const irMessage = humanizeMessage(safeTxMessage as any, {
      erc7730Descriptor: {
        descriptor: {
          display: {
            formats: {
              'SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)':
                {
                  intent: 'Safe',
                  fields: [
                    { path: 'operation', label: 'Operation type' },
                    { path: 'safeTxGas', label: 'Gas amount' },
                    { path: 'gasPrice', label: 'Gas price' },
                    { path: 'gasToken', label: 'Gas token', format: 'addressName' },
                    { path: 'refundReceiver', label: 'Gas receiver', format: 'addressName' }
                  ]
                }
            }
          }
        }
      }
    })

    compareVisualizations(irMessage.fullVisualization || [], [
      getErc7730Visualization('Safe', [
        {
          label: 'Operation type',
          value: [getText('1')]
        },
        {
          label: 'Gas amount',
          value: [getText('0')]
        },
        {
          label: 'Gas price',
          value: [getText('0')]
        },
        {
          label: 'Gas token',
          value: [getAddressVisualization(ZeroAddress)]
        },
        {
          label: 'Gas receiver',
          value: [getAddressVisualization(ZeroAddress)]
        }
      ])
    ])
  })
})

// Non-strict / dirty-bytes ABI encoding: the 12 leading zero bytes that pad a 20-byte
// address to a 32-byte ABI slot (or the 31 zero bytes that pad a bool) are replaced with
// non-zero random values. Some on-chain calldata produced by buggy or non-standard
// encoders contains such garbage padding, and the humanizer must either decode it
// correctly or degrade gracefully instead of throwing.
describe('non-strict encoding / dirty bytes', () => {
  // 12 random non-zero bytes used to corrupt the address-slot padding
  const dirtyPadding = 'deadbeefcafe12345678abcd'

  const usdtAddress = '0xdac17f958d2ee523a2206206994597c13d831ec7'
  const nftAddress = '0x59468516a8259058bad1ca5f8f4bff190d30e066'
  const spender = '46705dfff24256421a05d056c29e81bdc09723b8'
  // deliberately not accountOp.accountAddr so transferFrom takes the "Move" path
  const sender = 'c89b38119c58536d818f3bf19a9e3870828c1994'

  // Standard ABI value slot for 10^9 (0x3b9aca00)
  const valueSlot = '000000000000000000000000000000000000000000000000000000003b9aca00'

  beforeEach(() => {
    accountOp.calls = []
  })

  test('approve with dirty address padding decodes correctly', () => {
    // approve(address _spender, uint256 _value)
    // Dirty: the 12 leading zero bytes of the spender slot are replaced with random bytes
    const data = `0x095ea7b3${dirtyPadding}${spender}${valueSlot}`

    accountOp.calls = [{ to: usdtAddress, value: 0n, data }]

    const irCalls = humanizeAccountOp(accountOp)
    compareHumanizerVisualizations(irCalls, [
      [
        getAction('Grant approval'),
        getLabel('for'),
        getToken(usdtAddress, 1000000000n),
        getLabel('to'),
        getAddressVisualization(`0x${spender}`)
      ]
    ])
  })
  test('transfer with dirty address padding decodes correctly', () => {
    // transfer(address _to, uint256 _value)
    // Dirty: the 12 leading zero bytes of the recipient slot are replaced with random bytes
    const data = `0xa9059cbb${dirtyPadding}${spender}${valueSlot}`

    accountOp.calls = [{ to: usdtAddress, value: 0n, data }]

    const irCalls = humanizeAccountOp(accountOp)
    compareHumanizerVisualizations(irCalls, [
      [
        getAction('Send'),
        getToken(usdtAddress, 1000000000n),
        getLabel('to'),
        getAddressVisualization(`0x${spender}`)
      ]
    ])
  })
  test('transferFrom with dirty address padding on the from-slot decodes correctly', () => {
    // transferFrom(address _from, address _to, uint256 _value)
    // Dirty: the 12 leading zero bytes of the _from slot are replaced with random bytes;
    // _to slot uses standard zero padding
    const cleanAddressSlot = (addr: string) => `000000000000000000000000${addr}`
    const data =
      `0x23b872dd` +
      `${dirtyPadding}${sender}` + // dirty _from slot
      cleanAddressSlot(spender) + // clean _to slot
      valueSlot

    accountOp.calls = [{ to: usdtAddress, value: 0n, data }]

    const irCalls = humanizeAccountOp(accountOp)
    // _from !== accountOp.accountAddr and _to !== accountOp.accountAddr → Move
    compareHumanizerVisualizations(irCalls, [
      [
        getAction('Move'),
        getToken(usdtAddress, 1000000000n),
        getLabel('from'),
        getAddressVisualization(`0x${sender}`),
        getLabel('to'),
        getAddressVisualization(`0x${spender}`)
      ]
    ])
  })
  test('setApprovalForAll with dirty bool padding falls back gracefully', () => {
    // setApprovalForAll(address operator, bool approved)
    // Dirty: the bool slot uses 0xff instead of the valid 0x01, which viem rejects
    // as an invalid boolean. The module should throw and the humanizer should degrade
    // to the generic fallback visualization rather than crashing.
    const data =
      `0xa22cb465` +
      `000000000000000000000000${spender}` + // operator slot (clean)
      `00000000000000000000000000000000000000000000000000000000000000ff` // dirty bool (0xff)

    accountOp.calls = [{ to: nftAddress, value: 0n, data }]

    const irCalls = humanizeAccountOp(accountOp)
    compareHumanizerVisualizations(irCalls, [
      [getAction('Interacting'), getLabel('with'), getAddressVisualization(nftAddress)]
    ])
  })
})
