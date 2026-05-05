import { getAddress, Interface, ZeroAddress } from 'ethers'

import { TokenError, TokenResult } from '../portfolio/interfaces'
import { BalanceChange } from './submittedAccountOp'

const HYPER_EVM_CHAIN_ID = 999n
const TRANSFER_ABI = ['event Transfer(address indexed from, address indexed to, uint256 value)']
const transferInterface = new Interface(TRANSFER_ABI)

export type BalanceChangeTransferLog = {
  address: string
  topics: readonly string[]
  data: string
}

export type BalanceChangesReceipt = {
  logs: readonly BalanceChangeTransferLog[]
  hash?: string
  from?: string
  gasUsed?: bigint
  gasPrice?: bigint
  fee?: bigint
}

export type DebugTraceCall = {
  type?: string
  from?: string
  to?: string
  value?: string
  calls?: DebugTraceCall[]
}

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

type DebugTraceTransaction = (txnHash: string) => Promise<DebugTraceCall | null>

const getHexValue = (value?: string) => {
  try {
    return value ? BigInt(value) : 0n
  } catch {
    return 0n
  }
}

const getTransferLogBalanceChangeByToken = (
  logs: readonly BalanceChangeTransferLog[],
  accountAddr: string
) => {
  const balanceChangeByToken = new Map<string, bigint>()
  const accAddr = getAddress(accountAddr)

  logs.forEach((log) => {
    try {
      const parsed = transferInterface.parseLog({ topics: [...log.topics], data: log.data })
      if (!parsed) return

      const from = getAddress(parsed.args.from)
      const to = getAddress(parsed.args.to)

      if (from !== accAddr && to !== accAddr) return

      const tokenAddr = getAddress(log.address)
      const prevBalanceChange = balanceChangeByToken.get(tokenAddr) || 0n
      let balanceChange = prevBalanceChange

      if (from === accAddr) balanceChange -= parsed.args.value
      if (to === accAddr) balanceChange += parsed.args.value

      balanceChangeByToken.set(tokenAddr, balanceChange)
    } catch {
      // Not a standard ERC-20 Transfer log or not a checksummed EVM address.
    }
  })

  return balanceChangeByToken
}

const getNativeBalanceChangeFromTrace = (trace: DebugTraceCall, accountAddr: string): bigint => {
  const traceType = trace.type?.toUpperCase()
  const valueMovesNativeBalance = ['CALL', 'CREATE', 'CREATE2', 'SELFDESTRUCT'].includes(
    traceType || ''
  )
  let balanceChange = 0n

  if (valueMovesNativeBalance) {
    const value = getHexValue(trace.value)

    try {
      if (trace.from && getAddress(trace.from) === accountAddr) balanceChange -= value
      if (trace.to && getAddress(trace.to) === accountAddr) balanceChange += value
    } catch {
      // Ignore malformed trace addresses.
    }
  }

  return (trace.calls || []).reduce(
    (acc, call) => acc + getNativeBalanceChangeFromTrace(call, accountAddr),
    balanceChange
  )
}

const getReceiptFee = (receipt: BalanceChangesReceipt) => {
  if (receipt.fee !== undefined) return receipt.fee
  if (receipt.gasUsed !== undefined && receipt.gasPrice !== undefined) {
    return receipt.gasUsed * receipt.gasPrice
  }

  return 0n
}

const getHyperEvmNativeBalanceChange = async ({
  accountAddr,
  receipts,
  debugTraceTransaction
}: {
  accountAddr: string
  receipts?: BalanceChangesReceipt[]
  debugTraceTransaction?: DebugTraceTransaction
}) => {
  if (!receipts?.length || !debugTraceTransaction) return 0n

  const checksummedAccountAddr = getAddress(accountAddr)
  const balanceChanges = await Promise.all(
    receipts.map(async (receipt) => {
      if (!receipt.hash) return 0n

      try {
        const trace = await debugTraceTransaction(receipt.hash)
        if (!trace) return 0n

        let balanceChange = getNativeBalanceChangeFromTrace(trace, checksummedAccountAddr)
        const transactionSender = receipt.from || trace.from

        if (transactionSender && getAddress(transactionSender) === checksummedAccountAddr) {
          balanceChange -= getReceiptFee(receipt)
        }

        return balanceChange
      } catch {
        return 0n
      }
    })
  )

  return balanceChanges.reduce((acc, balanceChange) => acc + balanceChange, 0n)
}

const getHyperEvmBalanceChanges = async ({
  accountAddr,
  chainId,
  getTokenBalancesOnBlock,
  receipts,
  debugTraceTransaction
}: {
  accountAddr: string
  chainId: bigint
  getTokenBalancesOnBlock: GetTokenBalancesOnBlock
  receipts?: BalanceChangesReceipt[]
  debugTraceTransaction?: DebugTraceTransaction
}): Promise<BalanceChange[]> => {
  if (!receipts?.length) return []

  const balanceChangeByToken = getTransferLogBalanceChangeByToken(
    receipts.flatMap((receipt) => receipt.logs),
    accountAddr
  )
  const nativeBalanceChange = await getHyperEvmNativeBalanceChange({
    accountAddr,
    receipts,
    debugTraceTransaction
  })
  const erc20TokenAddrs = getBalanceChangeTokenAddresses(
    Array.from(balanceChangeByToken.keys())
  ).filter((tokenAddr) => tokenAddr !== ZeroAddress)
  const tokenAddrs =
    nativeBalanceChange !== 0n ? [ZeroAddress, ...erc20TokenAddrs] : erc20TokenAddrs

  if (!tokenAddrs.length) return []

  const latestTokensWithErrors = await getTokenBalancesOnBlock(
    accountAddr,
    chainId,
    tokenAddrs,
    'latest',
    accountAddr
  )
  const latestTokens = buildTokenBalanceMap(latestTokensWithErrors)

  return tokenAddrs.reduce((changes, tokenAddr) => {
    const token = latestTokens.get(tokenAddr.toLowerCase())
    const balanceChange =
      tokenAddr === ZeroAddress ? nativeBalanceChange : balanceChangeByToken.get(tokenAddr) || 0n

    if (!token || balanceChange === 0n) return changes

    const amountAfter = token.amount
    const amountBefore = amountAfter - balanceChange

    changes.push({
      ...token,
      amount: amountAfter,
      amountBefore,
      amountAfter,
      balanceChange,
      priceIn: token.priceIn || [],
      marketDataIn: token.marketDataIn || []
    })

    return changes
  }, [] as BalanceChange[])
}

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
