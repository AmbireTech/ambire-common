import { getAddress, ZeroAddress } from 'ethers'

import { TokenError, TokenResult } from '../portfolio/interfaces'
import { getHyperEvmBalanceChanges, HYPER_EVM_CHAIN_ID } from './hyperEvmBalanceChanges'
import { BalanceChange } from './submittedAccountOp'

import type { BalanceChangesReceipt, DebugTraceTransaction } from './hyperEvmBalanceChanges'
export type { BalanceChangesReceipt, BalanceChangeTransferLog } from './hyperEvmBalanceChanges'

const ABSTRACT_CHAIN_ID = 2741n
const ABSTRACT_NATIVE_TOKEN_ADDRESS = '0x000000000000000000000000000000000000800A'

/**
 * The ETH token on abstract is represented on an address
 * that isn't a standard ERC-20 but it emits such a transfer log,
 * causing our balance changes to break. We're fixing that here by
 * omiting it
 */
const filterAbstractNativeTokenAlias = (tokenAddrs: string[], chainId?: bigint) => {
  if (chainId !== ABSTRACT_CHAIN_ID) return tokenAddrs

  return tokenAddrs.filter(
    (tokenAddr) => tokenAddr.toLowerCase() !== ABSTRACT_NATIVE_TOKEN_ADDRESS.toLowerCase()
  )
}

export const getBalanceChangeTokenAddresses = (
  tokenAddrs: string[],
  chainId?: bigint
): string[] => {
  const tokenAddrsToNormalize = filterAbstractNativeTokenAlias(tokenAddrs, chainId)

  return Array.from(
    new Set(
      [ZeroAddress, ...tokenAddrsToNormalize].map((tokenAddr) => {
        try {
          return getAddress(tokenAddr)
        } catch (e) {
          return null
        }
      })
    )
  ).filter((addr) => addr !== null)
}

const isUsableTokenResult = (error: TokenError | null | undefined, token?: TokenResult | null) =>
  !!token && error === '0x' && !!token.symbol

const isNativeTokenAddress = (tokenAddr: string) =>
  tokenAddr.toLowerCase() === ZeroAddress.toLowerCase()

const buildTokenBalanceMap = (tokensWithErrors: [TokenError, TokenResult][]) =>
  tokensWithErrors.reduce((acc, [error, token]) => {
    if (!isUsableTokenResult(error, token)) return acc

    acc.set(token.address.toLowerCase(), token)

    return acc
  }, new Map<string, TokenResult>())

const assertTokenBalanceSnapshot = (
  tokensWithErrors: [TokenError, TokenResult][],
  tokenAddrs: string[],
  blockNumber: number
) => {
  const tokens = buildTokenBalanceMap(tokensWithErrors)
  const missingTokenAddrs = tokenAddrs.filter((tokenAddr) => !tokens.has(tokenAddr.toLowerCase()))

  if (missingTokenAddrs.length) {
    throw new Error(
      `Missing token balance snapshot for ${missingTokenAddrs.join(', ')} at block ${blockNumber}`
    )
  }
}

export const compareTokenBalances = (
  beforeTokensWithErrors: [TokenError, TokenResult][],
  afterTokensWithErrors: [TokenError, TokenResult][]
): BalanceChange[] => {
  const beforeTokens = buildTokenBalanceMap(beforeTokensWithErrors)
  const afterTokens = buildTokenBalanceMap(afterTokensWithErrors)
  const tokenAddresses = new Set([...beforeTokens.keys(), ...afterTokens.keys()])

  return Array.from(tokenAddresses).reduce((changes, tokenAddress) => {
    const beforeToken = beforeTokens.get(tokenAddress)
    const afterToken = afterTokens.get(tokenAddress)
    const referenceToken = afterToken || beforeToken

    if (!referenceToken) return changes

    const amountBefore = beforeToken?.amount || 0n
    const amountAfter = afterToken?.amount || 0n
    const balanceChange = amountAfter - amountBefore

    if (balanceChange === 0n) return changes

    changes.push({
      ...referenceToken,
      amount: amountAfter,
      amountBefore,
      amountAfter,
      balanceChange,
      priceIn: referenceToken.priceIn || [],
      marketDataIn: referenceToken.marketDataIn || []
    })

    return changes
  }, [] as BalanceChange[])
}

type GetTokenBalancesOnBlock = (
  accountId: string,
  chainId: bigint,
  tokenAddrs: string[],
  blockTag: number | 'latest',
  accountAddr?: string
) => Promise<[TokenError, TokenResult][]>

export const getAccountOpBalanceChanges = async ({
  accountAddr,
  chainId,
  tokenAddrs,
  receiptBlockNumber,
  getTokenBalancesOnBlock,
  prevBlockNumber,
  receipts,
  debugTraceTransaction
}: {
  accountAddr: string
  chainId: bigint
  tokenAddrs: string[]
  receiptBlockNumber: number
  getTokenBalancesOnBlock: GetTokenBalancesOnBlock
  // if the accountOp is not an atomic batch,
  // we will have to pass the first receipt's block number
  // we want to start the comparisson from
  prevBlockNumber?: number
  receipts?: BalanceChangesReceipt[]
  debugTraceTransaction?: DebugTraceTransaction
}) => {
  if (chainId === HYPER_EVM_CHAIN_ID) {
    // HyperEVM's public RPC only supports latest-state eth_call/getBalance, so
    // historical balance reads fail. Receipt logs still give exact ERC-20 deltas.
    return getHyperEvmBalanceChanges({
      accountAddr,
      chainId,
      getTokenBalancesOnBlock,
      receipts,
      debugTraceTransaction
    })
  }
  const balanceChangeTokenAddrs = filterAbstractNativeTokenAlias(tokenAddrs, chainId)
  const previousBlockNumber = prevBlockNumber
    ? prevBlockNumber
    : receiptBlockNumber > 0
      ? receiptBlockNumber - 1
      : 0
  const [currentBlockTokens, previousBlockTokens] = await Promise.all([
    getTokenBalancesOnBlock(
      accountAddr,
      chainId,
      balanceChangeTokenAddrs,
      receiptBlockNumber,
      accountAddr
    ),
    getTokenBalancesOnBlock(
      accountAddr,
      chainId,
      balanceChangeTokenAddrs,
      previousBlockNumber,
      accountAddr
    )
  ])

  // The receipt block snapshot must include every token, otherwise we could
  // falsely record a full-balance outflow. On the previous block, native is
  // still required, but missing ERC-20s are allowed as 0 -> current balance.
  assertTokenBalanceSnapshot(currentBlockTokens, balanceChangeTokenAddrs, receiptBlockNumber)
  assertTokenBalanceSnapshot(
    previousBlockTokens,
    balanceChangeTokenAddrs.filter(isNativeTokenAddress),
    previousBlockNumber
  )

  return compareTokenBalances(previousBlockTokens, currentBlockTokens)
}
