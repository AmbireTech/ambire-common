import { ethers, ZeroAddress } from 'ethers'

import { describe, jest, test } from '@jest/globals'

import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { Account } from '../../interfaces/account'
import { Key } from '../../interfaces/keystore'
import { AccountOp } from '../accountOp/accountOp'
import { fetchErc7730DescriptorForMessage, fetchErc7730DescriptorsForAccountOp } from './erc7730'
import { humanizeAccountOp, humanizeMessage } from './index'
import { compareHumanizerVisualizations, compareVisualizations } from './testHelpers'
import {
  getAction,
  getAddressVisualization,
  getDeadline,
  getErc7730Visualization,
  getLabel,
  getText,
  getToken
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
            value: [
              getToken('0xdac17f958d2ee523a2206206994597c13d831ec7', 1000000000n, undefined, 1n)
            ]
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
            value: [getToken(WETH_ADDRESS, 1000000000000000000n, undefined, 1n)]
          },
          {
            label: 'Minimum to Receive',
            value: [getToken(tokenOut, 1000000n, undefined, 1n)]
          }
        ])
      ],
      [
        getErc7730Visualization('Swap', [
          {
            label: 'Amount to Send',
            value: [getToken(WETH_ADDRESS, 2000000000000000000n, undefined, 1n)]
          },
          {
            label: 'Minimum to Receive',
            value: [getToken(tokenOut, 2000000n, undefined, 1n)]
          }
        ])
      ]
    ])
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
          value: [getToken(usdt, 1000000000n, undefined, 1n)]
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
    const callRelayer = async (path: string) => {
      if (path === '/v2/erc7730/account-op/clear-signing') {
        return {
          success: true,
          data: {
            [`eip155:1:${WETH_ADDRESS}`]: wethRegistryPath
          },
          errorState: []
        }
      }

      if (path === `/${wethRegistryPath}`) {
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
          value: [getToken(WETH_ADDRESS, 1000000000n, undefined, 1n)]
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
    const callRelayer = async (path: string, method?: string) => {
      expect(method).toBe('GET')

      if (path === '/v2/erc7730/account-op/clear-signing') {
        relayerPath = path
        return {
          success: true,
          data: {
            [`eip155:1:${call.to.toLowerCase()}`]: registryPath
          },
          errorState: []
        }
      }

      if (path === `/${registryPath}`) {
        descriptorPaths.push(path)
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

    expect(relayerPath).toBe('/v2/erc7730/account-op/clear-signing')
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
          value: [
            getToken('0xdac17f958d2ee523a2206206994597c13d831ec7', 1000000000n, undefined, 1n)
          ]
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
    const callRelayer = async (path: string, method?: string) => {
      expect(method).toBe('GET')

      if (path === '/v2/erc7730/eip-712/clear-signing') {
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

      if (path === `/${registryPath}`) {
        descriptorPaths.push(path)
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

    expect(relayerPath).toBe('/v2/erc7730/eip-712/clear-signing')
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
          value: [getToken(WETH_ADDRESS, 133700n, undefined, 1n)]
        },
        {
          label: 'Valid until',
          value: [getText('No expiration')]
        }
      ])
    ])
  })
})
