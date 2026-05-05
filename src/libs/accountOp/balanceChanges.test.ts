import { Interface, ZeroAddress } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { TokenError, TokenResult } from '../portfolio/interfaces'
import { getAccountOpBalanceChanges } from './balanceChanges'

const buildToken = (overrides: Partial<TokenResult>): TokenResult => ({
  symbol: 'TOKEN',
  name: 'Token',
  decimals: 18,
  address: ZeroAddress,
  chainId: 1n,
  amount: 0n,
  priceIn: [],
  marketDataIn: [],
  flags: {
    onGasTank: false,
    rewardsType: null,
    canTopUpGasTank: false,
    isFeeToken: false
  },
  ...overrides
})

const ok = (token: TokenResult): [TokenError, TokenResult] => ['0x', token]

const transferInterface = new Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)'
])

const buildTransferLog = ({
  address,
  from,
  to,
  value
}: {
  address: string
  from: string
  to: string
  value: bigint
}) => {
  const event = transferInterface.getEvent('Transfer')!
  const { data, topics } = transferInterface.encodeEventLog(event, [from, to, value])

  return {
    address,
    data,
    topics
  }
}

describe('balanceChanges', () => {
  test('computes expected balance changes on ethereum', async () => {
    const accountAddr = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
    const tokenAddrs = [ZeroAddress, '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48']
    const getTokenBalancesOnBlock = jest
      .fn()
      .mockImplementation(async (_accountId, _chainId, _tokenAddrs, blockTag) => {
        if (blockTag === 101) {
          return [
            ok(
              buildToken({
                symbol: 'ETH',
                name: 'Ethereum',
                address: ZeroAddress,
                chainId: 1n,
                amount: 9n
              })
            ),
            ok(
              buildToken({
                symbol: 'USDC',
                name: 'USD Coin',
                decimals: 6,
                address: '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
                chainId: 1n,
                amount: 2500000n
              })
            )
          ]
        }

        return [
          ok(
            buildToken({
              symbol: 'ETH',
              name: 'Ethereum',
              address: ZeroAddress,
              chainId: 1n,
              amount: 10n
            })
          ),
          ok(
            buildToken({
              symbol: 'USDC',
              name: 'USD Coin',
              decimals: 6,
              address: '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
              chainId: 1n,
              amount: 1000000n
            })
          )
        ]
      })

    const balanceChanges = await getAccountOpBalanceChanges({
      accountAddr,
      chainId: 1n,
      tokenAddrs,
      receiptBlockNumber: 101,
      getTokenBalancesOnBlock
    })

    expect(getTokenBalancesOnBlock).toHaveBeenNthCalledWith(
      1,
      accountAddr,
      1n,
      tokenAddrs,
      101,
      accountAddr
    )
    expect(getTokenBalancesOnBlock).toHaveBeenNthCalledWith(
      2,
      accountAddr,
      1n,
      tokenAddrs,
      100,
      accountAddr
    )
    expect(balanceChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          address: ZeroAddress,
          symbol: 'ETH',
          amountBefore: 10n,
          amountAfter: 9n,
          balanceChange: -1n
        }),
        expect.objectContaining({
          address: '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          symbol: 'USDC',
          amountBefore: 1000000n,
          amountAfter: 2500000n,
          balanceChange: 1500000n
        })
      ])
    )
    expect(balanceChanges).toHaveLength(2)
  })

  test('throws when a requested token balance snapshot is missing', async () => {
    const accountAddr = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
    const tokenAddrs = [ZeroAddress]
    const getTokenBalancesOnBlock = jest
      .fn()
      .mockImplementation(async (_accountId, _chainId, _tokenAddrs, blockTag) => {
        if (blockTag === 101) {
          return [
            ok(
              buildToken({
                symbol: 'ETH',
                name: 'Ethereum',
                address: ZeroAddress,
                chainId: 1n,
                amount: 9n
              })
            )
          ]
        }

        return []
      })

    await expect(
      getAccountOpBalanceChanges({
        accountAddr,
        chainId: 1n,
        tokenAddrs,
        receiptBlockNumber: 101,
        getTokenBalancesOnBlock
      })
    ).rejects.toThrow(`Missing token balance snapshot for ${ZeroAddress} at block 100`)
  })

  test('computes expected balance changes on avalanche', async () => {
    const accountAddr = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
    const tokenAddrs = [ZeroAddress, '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E']
    const getTokenBalancesOnBlock = jest
      .fn()
      .mockImplementation(async (_accountId, _chainId, _tokenAddrs, blockTag) => {
        if (blockTag === 55) {
          return [
            ok(
              buildToken({
                symbol: 'AVAX',
                name: 'Avalanche',
                address: ZeroAddress,
                chainId: 43114n,
                amount: 499n
              })
            ),
            ok(
              buildToken({
                symbol: 'USDC',
                name: 'USD Coin',
                decimals: 6,
                address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
                chainId: 43114n,
                amount: 0n
              })
            )
          ]
        }

        return [
          ok(
            buildToken({
              symbol: 'AVAX',
              name: 'Avalanche',
              address: ZeroAddress,
              chainId: 43114n,
              amount: 500n
            })
          ),
          ok(
            buildToken({
              symbol: 'USDC',
              name: 'USD Coin',
              decimals: 6,
              address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
              chainId: 43114n,
              amount: 1200000n
            })
          )
        ]
      })

    const balanceChanges = await getAccountOpBalanceChanges({
      accountAddr,
      chainId: 43114n,
      tokenAddrs,
      receiptBlockNumber: 55,
      getTokenBalancesOnBlock
    })

    expect(balanceChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          address: ZeroAddress,
          symbol: 'AVAX',
          amountBefore: 500n,
          amountAfter: 499n,
          balanceChange: -1n
        }),
        expect.objectContaining({
          address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
          symbol: 'USDC',
          amountBefore: 1200000n,
          amountAfter: 0n,
          balanceChange: -1200000n
        })
      ])
    )
    expect(balanceChanges).toHaveLength(2)
  })

  test('computes expected balance changes on base', async () => {
    const accountAddr = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
    const tokenAddrs = [ZeroAddress, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913']
    const getTokenBalancesOnBlock = jest
      .fn()
      .mockImplementation(async (_accountId, _chainId, _tokenAddrs, blockTag) => {
        if (blockTag === 999) {
          return [
            ok(
              buildToken({
                symbol: 'ETH',
                name: 'Ethereum',
                address: ZeroAddress,
                chainId: 8453n,
                amount: 3n
              })
            ),
            ok(
              buildToken({
                symbol: 'USDC',
                name: 'USD Coin',
                decimals: 6,
                address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
                chainId: 8453n,
                amount: 7000000n
              })
            )
          ]
        }

        return [
          ok(
            buildToken({
              symbol: 'ETH',
              name: 'Ethereum',
              address: ZeroAddress,
              chainId: 8453n,
              amount: 5n
            })
          ),
          ok(
            buildToken({
              symbol: 'USDC',
              name: 'USD Coin',
              decimals: 6,
              address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
              chainId: 8453n,
              amount: 1000000n
            })
          )
        ]
      })

    const balanceChanges = await getAccountOpBalanceChanges({
      accountAddr,
      chainId: 8453n,
      tokenAddrs,
      receiptBlockNumber: 999,
      getTokenBalancesOnBlock
    })

    expect(balanceChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          address: ZeroAddress,
          symbol: 'ETH',
          amountBefore: 5n,
          amountAfter: 3n,
          balanceChange: -2n
        }),
        expect.objectContaining({
          address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          symbol: 'USDC',
          amountBefore: 1000000n,
          amountAfter: 7000000n,
          balanceChange: 6000000n
        })
      ])
    )
    expect(balanceChanges).toHaveLength(2)
  })

  test('computes HyperEVM balance changes from transfer logs and native traces without historical calls', async () => {
    const accountAddr = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
    const recipient = '0x1111111111111111111111111111111111111111'
    const sender = '0x2222222222222222222222222222222222222222'
    const usdcAddr = '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb'
    const tokenAddrs = [ZeroAddress, usdcAddr]
    const logs = [
      buildTransferLog({
        address: usdcAddr,
        from: accountAddr,
        to: recipient,
        value: 1000000n
      }),
      buildTransferLog({
        address: usdcAddr,
        from: sender,
        to: accountAddr,
        value: 2500000n
      })
    ]
    const getTokenBalancesOnBlock = jest
      .fn()
      .mockImplementation(async (_accountId, _chainId, _tokenAddrs, blockTag) => {
        if (blockTag !== 'latest') throw new Error('historical block tags are not supported')

        return _tokenAddrs.map((tokenAddr: string) =>
          tokenAddr === ZeroAddress
            ? ok(
                buildToken({
                  symbol: 'HYPE',
                  name: 'HYPE',
                  address: ZeroAddress,
                  chainId: 999n,
                  amount: 10000n
                })
              )
            : ok(
                buildToken({
                  symbol: 'USDC',
                  name: 'USD Coin',
                  decimals: 6,
                  address: usdcAddr,
                  chainId: 999n,
                  amount: 5000000n
                })
              )
        )
      })
    const debugTraceTransaction = jest.fn().mockResolvedValue({
      type: 'CALL',
      from: accountAddr,
      to: recipient,
      value: '0x3e8'
    })

    const balanceChanges = await getAccountOpBalanceChanges({
      accountAddr,
      chainId: 999n,
      tokenAddrs,
      receiptBlockNumber: 12345,
      getTokenBalancesOnBlock,
      receipts: [
        {
          hash: '0xa14458d6540e8bfaa3ab75c5dc9ca006c4e89eb74b562a24e1db21858a96304a',
          from: accountAddr,
          gasUsed: 21n,
          gasPrice: 100n,
          logs
        }
      ],
      debugTraceTransaction
    })

    expect(debugTraceTransaction).toHaveBeenCalledWith(
      '0xa14458d6540e8bfaa3ab75c5dc9ca006c4e89eb74b562a24e1db21858a96304a'
    )
    expect(getTokenBalancesOnBlock).toHaveBeenCalledTimes(1)
    expect(getTokenBalancesOnBlock).toHaveBeenCalledWith(
      accountAddr,
      999n,
      [ZeroAddress, usdcAddr],
      'latest',
      accountAddr
    )
    expect(balanceChanges).toEqual([
      expect.objectContaining({
        address: ZeroAddress,
        symbol: 'HYPE',
        amountBefore: 13100n,
        amountAfter: 10000n,
        balanceChange: -3100n
      }),
      expect.objectContaining({
        address: usdcAddr,
        symbol: 'USDC',
        amountBefore: 3500000n,
        amountAfter: 5000000n,
        balanceChange: 1500000n
      })
    ])
  })

  test('computes HyperEVM native balance changes from nested incoming traces', async () => {
    const accountAddr = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
    const sender = '0x2222222222222222222222222222222222222222'
    const getTokenBalancesOnBlock = jest
      .fn()
      .mockImplementation(async (_accountId, _chainId, _tokenAddrs, blockTag) => {
        if (blockTag !== 'latest') throw new Error('historical block tags are not supported')

        return [
          ok(
            buildToken({
              symbol: 'HYPE',
              name: 'HYPE',
              address: ZeroAddress,
              chainId: 999n,
              amount: 7000n
            })
          )
        ]
      })
    const debugTraceTransaction = jest.fn().mockResolvedValue({
      type: 'CALL',
      from: sender,
      to: '0x3333333333333333333333333333333333333333',
      value: '0x0',
      calls: [
        {
          type: 'CALL',
          from: sender,
          to: accountAddr,
          value: '0x7d0'
        }
      ]
    })
    const balanceChanges = await getAccountOpBalanceChanges({
      accountAddr,
      chainId: 999n,
      tokenAddrs: [ZeroAddress],
      receiptBlockNumber: 12345,
      getTokenBalancesOnBlock,
      receipts: [
        {
          hash: '0xa14458d6540e8bfaa3ab75c5dc9ca006c4e89eb74b562a24e1db21858a96304a',
          from: sender,
          gasUsed: 21n,
          gasPrice: 100n,
          logs: []
        }
      ],
      debugTraceTransaction
    })

    expect(balanceChanges).toEqual([
      expect.objectContaining({
        address: ZeroAddress,
        symbol: 'HYPE',
        amountBefore: 5000n,
        amountAfter: 7000n,
        balanceChange: 2000n
      })
    ])
  })
})
