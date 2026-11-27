import { Interface, MaxUint256, toQuantity, ZeroAddress } from 'ethers'

import SellChecker from '../../../contracts/compiled/SellChecker.json'
import { getRpcTokenPriceConfig, SpotPriceConfig } from '../../consts/rpcTokenPrices'
import { RPCProvider } from '../../interfaces/provider'
import isSameAddr from '../../utils/isSameAddr'
import { AccountOp } from '../accountOp/accountOp'
import { TokenResult } from '../portfolio/interfaces'
import { isCuratedToken } from '../tokenPrices/rpcTokenPrices'
import { getEthSimulateV1Params } from '../tracer/ethSimulatev1'

/**
 * Where the sell checker's code is put in the simulation. Nothing is deployed there, so the
 * address can't belong to anyone.
 */
export const SELL_CHECKER_ADDRESS = '0x000000000000000000000000000000000005E11C'
/**
 * How many blocks after the transaction the sale is simulated in. Selling in the same block is
 * blocked by the anti-bot cooldowns of many normal tokens, which a later block lets through.
 */
export const SELL_CHECK_BLOCKS_LATER = 5
/** How many seconds after the latest block the sale is simulated at, for time-based cooldowns */
export const SELL_CHECK_SECONDS_LATER = 120
/** A token that keeps at least this share of a sale (in basis points) has a high selling fee */
export const HIGH_SELL_FEE_BPS = 1000
/** A token that keeps at least this share of a sale (in basis points) can't really be sold */
export const CANNOT_SELL_FEE_BPS = 9000
/** The most incoming tokens checked for one transaction, to keep the simulation small */
export const MAX_TOKENS_TO_CHECK_SALES = 5

/** The values of `SellChecker.SaleStatus` */
enum SaleStatus {
  Unknown = 0,
  Sold = 1,
  Failed = 2
}

const sellCheckerInterface = new Interface(SellChecker.abi)
const erc20Interface = new Interface(['function approve(address spender, uint256 amount)'])

/** A token the transaction adds to the account, to check whether it can be sold */
export type TokenToCheckSale = {
  address: string
  /** How much of it the transaction adds */
  amount: bigint
}

/**
 * An incoming token that a simulated sale, right after the transaction, found risky:
 * - `cannot-sell`: no sale went through, or the token kept nearly all of it (CANNOT_SELL_FEE_BPS)
 * - `high-sell-fee`: the sale went through, but the token kept HIGH_SELL_FEE_BPS or more of it
 */
export type IncomingTokenSaleRisk = {
  address: string
  kind: 'cannot-sell' | 'high-sell-fee'
  /** The share of the sale the token kept, rounded to a whole percent */
  sellFeePercent: number
}

type SaleCheck = { status: bigint; sellFeeBps: bigint }

/** A block of an `eth_simulateV1` request */
type SimulationBlock = {
  blockOverrides?: { number: string; time: string }
  stateOverrides?: Record<string, { balance?: string; code?: string }>
  calls: { from: string; to?: string; value: string; data: string }[]
}

/**
 * The params of the `eth_simulateV1` request that checks the sales: the blocks to simulate, and
 * the number of the block they're simulated on top of
 */
export type SellCheckRequest = [{ blockStateCalls: SimulationBlock[]; validation: false }, string]

type SimulatedCall = { status: string; returnData: string; error?: { message?: string } }

/** A block of an `eth_simulateV1` response */
export type SimulatedBlock = { calls: SimulatedCall[] }

/**
 * The tokens the transaction adds to the account that are worth checking: on a network whose
 * main DEXes we know (see `SpotPriceConfig.poolFactories`), and not the native token, its wrapped
 * version, a stablecoin we price as $1, one of our curated tokens or a DeFi position's. At most
 * MAX_TOKENS_TO_CHECK_SALES of them.
 */
export const getIncomingTokensToCheckSales = (
  tokens: TokenResult[],
  chainId: bigint
): TokenToCheckSale[] => {
  const spotPrices = getRpcTokenPriceConfig(chainId)?.spotPrices
  if (!spotPrices) return []

  const isKnownToken = (address: string) =>
    isSameAddr(address, ZeroAddress) ||
    isSameAddr(address, spotPrices.wrappedNative) ||
    spotPrices.stablecoins.some((stablecoin) => isSameAddr(stablecoin, address)) ||
    isCuratedToken(address, chainId)

  return tokens
    .filter(
      (token) =>
        token.chainId === chainId &&
        !!token.simulationAmount &&
        token.simulationAmount > 0n &&
        !token.flags.onGasTank &&
        !token.flags.rewardsType &&
        // A position's token (e.g. Aave's aTokens) comes from depositing, not from buying
        !token.flags.defiTokenType &&
        !isKnownToken(token.address)
    )
    .slice(0, MAX_TOKENS_TO_CHECK_SALES)
    .map((token) => ({ address: token.address, amount: token.simulationAmount! }))
}

/**
 * The `eth_simulateV1` request that runs the transaction on top of `latestBlock`, then,
 * SELL_CHECK_BLOCKS_LATER blocks later, approves the sell checker for each token and has it sell
 * what the transaction added. Null when the transaction has no calls to simulate.
 */
export const getSellCheckRequest = ({
  accountOp,
  tokens,
  spotPrices,
  latestBlock
}: {
  accountOp: AccountOp
  tokens: TokenToCheckSale[]
  spotPrices: SpotPriceConfig
  latestBlock: { number: number; timestamp: number }
}): SellCheckRequest | null => {
  const transactionSimulation = getEthSimulateV1Params(accountOp)
  if (!transactionSimulation) return null

  const [{ blockStateCalls }] = transactionSimulation.params
  const transactionBlocks: SimulationBlock[] = blockStateCalls.map((block, index) =>
    index === 0
      ? {
          ...block,
          stateOverrides: {
            ...block.stateOverrides,
            [SELL_CHECKER_ADDRESS]: { code: SellChecker.binRuntime }
          }
        }
      : block
  )
  const poolSearch = {
    wrappedNative: spotPrices.wrappedNative,
    stablecoins: spotPrices.stablecoins,
    factories: spotPrices.poolFactories.map(({ factory, kind, params }) => ({
      factory,
      kind,
      params: params.map(BigInt)
    }))
  }
  const approvals = tokens.map(({ address }) => ({
    from: accountOp.accountAddr,
    to: address,
    value: '0x0',
    data: erc20Interface.encodeFunctionData('approve', [SELL_CHECKER_ADDRESS, MaxUint256])
  }))
  const sellCheck = {
    from: accountOp.accountAddr,
    to: SELL_CHECKER_ADDRESS,
    value: '0x0',
    data: sellCheckerInterface.encodeFunctionData('checkSales', [
      accountOp.accountAddr,
      tokens.map(({ address }) => address),
      tokens.map(({ amount }) => amount),
      poolSearch
    ])
  }

  return [
    {
      blockStateCalls: [
        ...transactionBlocks,
        {
          blockOverrides: {
            number: toQuantity(latestBlock.number + 1 + SELL_CHECK_BLOCKS_LATER),
            time: toQuantity(latestBlock.timestamp + SELL_CHECK_SECONDS_LATER)
          },
          calls: [...approvals, sellCheck]
        }
      ],
      validation: false
    },
    // On top of the block the sale's block number comes from, rather than the latest one: on a
    // network with fast blocks, the latest block can move past the sale's before the request
    // arrives, and the RPC rejects blocks that aren't in order
    toQuantity(latestBlock.number)
  ]
}

const toSaleRisk = (address: string, check: SaleCheck): IncomingTokenSaleRisk | null => {
  if (Number(check.status) === SaleStatus.Failed)
    return { address, kind: 'cannot-sell', sellFeePercent: 100 }
  if (Number(check.status) !== SaleStatus.Sold) return null

  const sellFeeBps = Number(check.sellFeeBps)
  const sellFeePercent = Math.round(sellFeeBps / 100)
  if (sellFeeBps >= CANNOT_SELL_FEE_BPS) return { address, kind: 'cannot-sell', sellFeePercent }
  if (sellFeeBps >= HIGH_SELL_FEE_BPS) return { address, kind: 'high-sell-fee', sellFeePercent }

  return null
}

/**
 * The risky tokens, from the response to the request of `getSellCheckRequest`. Throws when the
 * sell check itself failed, which tells nothing about the tokens.
 */
export const parseSellCheckResponse = (
  response: SimulatedBlock[],
  tokens: TokenToCheckSale[]
): IncomingTokenSaleRisk[] => {
  const sellCheck = response.at(-1)?.calls.at(-1)
  if (!sellCheck) throw new Error('The sell check returned no result')
  if (sellCheck.status !== '0x1')
    throw new Error(`The sell check failed: ${sellCheck.error?.message || 'no reason given'}`)

  const [checks] = sellCheckerInterface.decodeFunctionResult('checkSales', sellCheck.returnData)

  return tokens
    .map(({ address }, index) => toSaleRisk(address, checks[index]))
    .filter((risk): risk is IncomingTokenSaleRisk => !!risk)
}

/**
 * Simulates selling each token the transaction adds to the account, a few blocks after it, into
 * the token's deepest pools on the network's main DEXes. Uses `eth_simulateV1`, so it throws on
 * an RPC that doesn't support it. A token with no pool on those DEXes is never reported, as the
 * check can't tell anything about it.
 */
export const checkIncomingTokenSales = async ({
  provider,
  accountOp,
  tokens
}: {
  provider: RPCProvider
  accountOp: AccountOp
  tokens: TokenToCheckSale[]
}): Promise<IncomingTokenSaleRisk[]> => {
  const spotPrices = getRpcTokenPriceConfig(accountOp.chainId)?.spotPrices
  if (!spotPrices || !tokens.length) return []

  const latestBlock = await provider.getBlock('latest')
  if (!latestBlock) throw new Error('The latest block is unavailable')

  const request = getSellCheckRequest({ accountOp, tokens, spotPrices, latestBlock })
  if (!request) return []

  const response: SimulatedBlock[] = await provider.send('eth_simulateV1', request)

  return parseSellCheckResponse(response, tokens)
}
