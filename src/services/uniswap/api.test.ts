import { Interface } from 'ethers'

import { describe, expect, it, jest } from '@jest/globals'

import ERC20 from '../../../contracts/compiled/IERC20.json'
import { SwapAndBridgeRoute } from '../../interfaces/swapAndBridge'
import { ZERO_ADDRESS } from '../socket/constants'
import { CITREA_CHAIN_ID } from '../squid/constants'
import { UniswapAPI } from './api'

const erc20Interface = new Interface(ERC20.abi)

const makeResponse = (body: any, ok = true, status = ok ? 200 : 400) => ({
  ok,
  status,
  json: async () => body
})

const userAddress = '0x0000000000000000000000000000000000000001'
const tokenIn = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const tokenOut = '0xdAC17F958D2ee523a2206206994597C13D831ec7'

describe('UniswapAPI', () => {
  it('supports Uniswap chains and excludes Citrea', async () => {
    const uniswapApi = new UniswapAPI({ fetch: jest.fn() as any, apiKey: 'test-key' })

    expect(uniswapApi.areChainsSupported({ fromChainId: 1, toChainId: 8453 })).toBe(true)
    expect(uniswapApi.areChainsSupported({ fromChainId: CITREA_CHAIN_ID, toChainId: 1 })).toBe(
      false
    )

    const chains = await uniswapApi.getSupportedChains()
    expect(chains.some((chain) => chain.chainId === CITREA_CHAIN_ID)).toBe(false)
  })

  it('requests a direct-approval classic quote and normalizes the route', async () => {
    const fetch = jest.fn(async () =>
      makeResponse({
        requestId: 'request-id',
        routing: 'CLASSIC',
        quote: {
          chainId: 1,
          input: { amount: '1000000', token: tokenIn },
          output: { amount: '1000000', token: tokenOut, recipient: userAddress },
          swapper: userAddress,
          tradeType: 'EXACT_INPUT',
          quoteId: 'quote-id',
          gasFeeUSD: '0.1',
          slippage: 0.5,
          aggregatedOutputs: [
            {
              amount: '999000',
              token: tokenOut,
              recipient: userAddress,
              bps: 10000,
              minAmount: '994000'
            }
          ]
        },
        permitData: null
      })
    )
    const uniswapApi = new UniswapAPI({ fetch: fetch as any, apiKey: 'test-key' })

    const quote = await uniswapApi.quote({
      fromAsset: {
        address: tokenIn,
        amount: 1000000n,
        chainId: 1n,
        decimals: 6,
        flags: { canTopUpGasTank: false, isFeeToken: false, onGasTank: false, rewardsType: null },
        marketDataIn: [],
        name: 'USDC',
        priceIn: [{ baseCurrency: 'usd', price: 1 }],
        symbol: 'USDC'
      } as any,
      fromChainId: 1,
      fromTokenAddress: tokenIn,
      toAsset: {
        address: tokenOut,
        chainId: 1,
        decimals: 6,
        name: 'Tether USD',
        symbol: 'USDT'
      },
      toChainId: 1,
      toTokenAddress: tokenOut,
      fromAmount: 1000000n,
      userAddress,
      sort: 'output',
      isWrapOrUnwrap: false,
      accountNativeBalance: 1n,
      nativeSymbol: 'ETH'
    })

    const [, init] = (fetch as any).mock.calls[0]
    const body = JSON.parse((init as any).body)

    expect((init as any).headers['x-api-key']).toBe('test-key')
    expect((init as any).headers['x-permit2-disabled']).toBe('true')
    expect(body.protocols).toEqual(['V4', 'V3', 'V2'])
    expect(body.integratorFees).toEqual([{ bips: 50, recipient: expect.any(String) }])
    expect(quote.routes[0]!.providerId).toBe('uniswap')
    expect(quote.routes[0]!.routeId).toBe('quote-id')
    expect(quote.routes[0]!.inputValueInUsd).toBe(1)
    expect(quote.routes[0]!.outputValueInUsd).toBe(0.999)
    expect(quote.routes[0]!.outputValueAfterGasInUsd).toBe(0.899)
    expect(quote.routes[0]!.toAmount).toBe('999000')
    expect((quote.routes[0]!.toToken as any).priceUSD).toBe('1')
    expect(quote.routes[0]!.steps[0]!.minAmountOut).toBe('994000')
  })

  it('builds swap calldata and parses the approval spender', async () => {
    const spender = '0x1111111111111111111111111111111111111111'
    const fetch = (jest.fn() as any)
      .mockResolvedValueOnce(
        makeResponse({
          requestId: 'approval-request',
          approval: {
            to: tokenIn,
            from: userAddress,
            data: erc20Interface.encodeFunctionData('approve', [spender, 1000000n]),
            value: '0',
            chainId: 1
          },
          cancel: null
        })
      )
      .mockResolvedValueOnce(
        makeResponse({
          requestId: 'swap-request',
          swap: {
            to: '0x2222222222222222222222222222222222222222',
            from: userAddress,
            data: '0x1234',
            value: '0',
            chainId: 1
          }
        })
      )
    const uniswapApi = new UniswapAPI({ fetch: fetch as any, apiKey: 'test-key' })
    const route = {
      routeId: 'quote-id',
      fromChainId: 1,
      toChainId: 1,
      fromAmount: '1000000',
      userAddress,
      steps: [
        {
          fromAsset: { address: tokenIn },
          toAsset: { address: tokenOut }
        }
      ],
      rawRoute: {
        requestId: 'request-id',
        routing: 'CLASSIC',
        quote: {
          chainId: 1,
          input: { amount: '1000000', token: tokenIn },
          output: { amount: '999000', token: tokenOut, recipient: userAddress },
          swapper: userAddress,
          tradeType: 'EXACT_INPUT',
          quoteId: 'quote-id'
        },
        permitData: null
      }
    } as SwapAndBridgeRoute

    const tx = await uniswapApi.startRoute(route)

    expect(tx.approvalData).toEqual({
      allowanceTarget: spender,
      approvalTokenAddress: tokenIn,
      minimumApprovalAmount: '1000000',
      owner: userAddress
    })
    expect(tx.txTarget).toBe('0x2222222222222222222222222222222222222222')
    expect(tx.txData).toBe('0x1234')
  })

  it('does not request approval for native input tokens', async () => {
    const fetch = jest.fn(async () =>
      makeResponse({
        requestId: 'swap-request',
        swap: {
          to: '0x2222222222222222222222222222222222222222',
          from: userAddress,
          data: '0x1234',
          value: '1',
          chainId: 1
        }
      })
    )
    const uniswapApi = new UniswapAPI({ fetch: fetch as any, apiKey: 'test-key' })
    const route = {
      routeId: 'quote-id',
      fromChainId: 1,
      toChainId: 1,
      fromAmount: '1',
      userAddress,
      steps: [
        {
          fromAsset: { address: ZERO_ADDRESS },
          toAsset: { address: tokenOut }
        }
      ],
      rawRoute: {
        requestId: 'request-id',
        routing: 'CLASSIC',
        quote: {
          chainId: 1,
          input: { amount: '1', token: ZERO_ADDRESS },
          output: { amount: '999000', token: tokenOut, recipient: userAddress },
          swapper: userAddress,
          tradeType: 'EXACT_INPUT',
          quoteId: 'quote-id'
        },
        permitData: null
      }
    } as SwapAndBridgeRoute

    const tx = await uniswapApi.startRoute(route)

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(tx.approvalData).toBe(null)
  })
})
