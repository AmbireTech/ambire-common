import { getAddress, ZeroAddress } from 'ethers'

import { TokenError, TokenResult } from '../portfolio/interfaces'
import { BalanceChange } from './submittedAccountOp'

export const getBalanceChangeTokenAddresses = (tokenAddrs: string[]) =>
  Array.from(new Set([ZeroAddress, ...tokenAddrs].map((tokenAddr) => getAddress(tokenAddr))))

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
  blockTag: number,
  accountAddr?: string
) => Promise<[TokenError, TokenResult][]>

export const getAccountOpBalanceChanges = async ({
  accountAddr,
  chainId,
  tokenAddrs,
  receiptBlockNumber,
  getTokenBalancesOnBlock
}: {
  accountAddr: string
  chainId: bigint
  tokenAddrs: string[]
  receiptBlockNumber: number
  getTokenBalancesOnBlock: GetTokenBalancesOnBlock
}) => {
  const previousBlockNumber = receiptBlockNumber > 0 ? receiptBlockNumber - 1 : 0
  const [currentBlockTokens, previousBlockTokens] = await Promise.all([
    getTokenBalancesOnBlock(accountAddr, chainId, tokenAddrs, receiptBlockNumber, accountAddr),
    getTokenBalancesOnBlock(accountAddr, chainId, tokenAddrs, previousBlockNumber, accountAddr)
  ])

  return compareTokenBalances(previousBlockTokens, currentBlockTokens)
}
