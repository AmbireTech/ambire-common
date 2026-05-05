import { getAddress, ZeroAddress } from 'ethers'

import { TokenError, TokenResult } from '../portfolio/interfaces'
import type { BalanceChangesReceipt, DebugTraceTransaction } from './hyperEvmBalanceChanges'
import { getHyperEvmBalanceChanges, HYPER_EVM_CHAIN_ID } from './hyperEvmBalanceChanges'
import { BalanceChange } from './submittedAccountOp'

export type { BalanceChangeTransferLog, BalanceChangesReceipt } from './hyperEvmBalanceChanges'

export const getBalanceChangeTokenAddresses = (tokenAddrs: string[]): string[] =>
  Array.from(
    new Set(
      [ZeroAddress, ...tokenAddrs].map((tokenAddr) => {
        try {
          return getAddress(tokenAddr)
        } catch (e) {
          return null
        }
      })
    )
  ).filter((addr) => addr !== null)

const isUsableTokenResult = (error: TokenError | null | undefined, token?: TokenResult | null) =>
  !!token && error === '0x' && !!token.symbol

const buildTokenBalanceMap = (tokensWithErrors: [TokenError, TokenResult][]) =>
  tokensWithErrors.reduce((acc, [error, token]) => {
    if (!isUsableTokenResult(error, token)) return acc

    acc.set(token.address.toLowerCase(), token)

    return acc
  }, new Map<string, TokenResult>())

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
  const previousBlockNumber = prevBlockNumber
    ? prevBlockNumber
    : receiptBlockNumber > 0
      ? receiptBlockNumber - 1
      : 0
  const [currentBlockTokens, previousBlockTokens] = await Promise.all([
    getTokenBalancesOnBlock(accountAddr, chainId, tokenAddrs, receiptBlockNumber, accountAddr),
    getTokenBalancesOnBlock(accountAddr, chainId, tokenAddrs, previousBlockNumber, accountAddr)
  ])

  return compareTokenBalances(previousBlockTokens, currentBlockTokens)
}
