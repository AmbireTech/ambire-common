import { Interface, JsonRpcProvider, toBeHex } from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireFactory from '../../../contracts/compiled/AmbireFactory.json'
import { AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { GasSpeeds } from '../../services/bundlers/types'
import { getViemClientForProvider } from '../../services/provider'
import { BaseAccount } from '../account/BaseAccount'
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'
import { getActivatorCall } from '../userOperation/userOperation'

import type { PublicClient } from 'viem'

// a 1 gwei min for gas price, non1559 networks
export const MIN_GAS_PRICE = 1000000000n

// Base fee buffers and priority fee ranges for each speed.
// Priority fee ranges are relative to slow and prevent high percentiles from
// producing disproportionately expensive recommendations.
const speeds = [
  { name: 'slow', baseFeeAddBps: 0n, priorityFeeMinAddBps: 0n, priorityFeeMaxAddBps: 0n },
  {
    name: 'medium',
    baseFeeAddBps: 100n,
    priorityFeeMinAddBps: 1250n,
    priorityFeeMaxAddBps: 2500n
  },
  {
    name: 'fast',
    baseFeeAddBps: 200n,
    priorityFeeMinAddBps: 2500n,
    priorityFeeMaxAddBps: 5000n
  },
  {
    name: 'ape',
    baseFeeAddBps: 300n,
    priorityFeeMinAddBps: 5000n,
    priorityFeeMaxAddBps: 10000n
  }
]

const FEE_HISTORY_BLOCK_COUNT = 5
const FEE_HISTORY_REWARD_PERCENTILES = [25, 50, 75, 95]

export interface GasPriceRecommendation {
  name: string
  gasPrice: bigint
}
export interface Gas1559Recommendation {
  name: string
  baseFeePerGas: bigint
  maxPriorityFeePerGas: bigint
}
export type GasRecommendation = GasPriceRecommendation | Gas1559Recommendation

function median(data: bigint[]): bigint {
  if (data.length === 0) return 0n

  const sorted = [...data].sort((a, b) => {
    if (a === b) return 0
    return a > b ? 1 : -1
  })
  const middle = Math.floor(sorted.length / 2)

  if (sorted.length % 2) return sorted[middle]!
  return (sorted[middle - 1]! + sorted[middle]!) / 2n
}

function increaseByBps(value: bigint, bps: bigint): bigint {
  return value + (value * bps) / 10000n
}

function clamp(value: bigint, min: bigint, max: bigint): bigint {
  if (value < min) return min
  if (value > max) return max
  return value
}

function increaseByPercent(value: bigint, percent?: bigint): bigint {
  if (!percent) return value
  return value + (value * percent) / 100n
}

function getMedianPriorityFeesFromHistory(rewards: bigint[][]): bigint[] {
  return FEE_HISTORY_REWARD_PERCENTILES.map((_percentile, percentileIndex) => {
    const fees = rewards
      .map((reward) => reward[percentileIndex])
      .filter((fee): fee is bigint => typeof fee === 'bigint' && fee > 0n)

    return median(fees)
  })
}

function getLastBaseFeeFromHistory(baseFeePerGas: bigint[]): bigint | null {
  return baseFeePerGas[baseFeePerGas.length - 1] ?? null
}

async function fetchViemFeeHistory(client: PublicClient) {
  return client.getFeeHistory({
    blockCount: FEE_HISTORY_BLOCK_COUNT,
    rewardPercentiles: FEE_HISTORY_REWARD_PERCENTILES
  })
}

async function get1559ViemFees(client: PublicClient) {
  return client.estimateFeesPerGas({ chain: null, type: 'eip1559' })
}

async function getLegacyViemFees(client: PublicClient) {
  return client.estimateFeesPerGas({ chain: null, type: 'legacy' })
}

async function get1559GasPriceRecommendations(
  client: PublicClient
): Promise<Gas1559Recommendation[]> {
  const [estimatedFees, feeHistory] = await Promise.all([
    get1559ViemFees(client),
    fetchViemFeeHistory(client).catch((e) => {
      console.error('eth_feeHistory failed; falling back to viem fee estimation', e)
      return null
    })
  ])

  const estimatedBaseFee = estimatedFees.maxFeePerGas - estimatedFees.maxPriorityFeePerGas
  const expectedBaseFee = feeHistory
    ? (getLastBaseFeeFromHistory(feeHistory.baseFeePerGas) ?? estimatedBaseFee)
    : estimatedBaseFee

  const priorityFees = feeHistory ? getMedianPriorityFeesFromHistory(feeHistory.reward ?? []) : []
  const estimatedPriorityFee =
    estimatedFees.maxPriorityFeePerGas >= 100000n ? estimatedFees.maxPriorityFeePerGas : 100000n
  const slowPriorityFee =
    priorityFees[0] && priorityFees[0] > estimatedPriorityFee
      ? priorityFees[0]
      : estimatedPriorityFee
  const fee: Gas1559Recommendation[] = []

  speeds.forEach(({ name, baseFeeAddBps, priorityFeeMinAddBps, priorityFeeMaxAddBps }, i) => {
    const baseFeePerGas = increaseByBps(expectedBaseFee, baseFeeAddBps)
    const minPriorityFee = increaseByBps(slowPriorityFee, priorityFeeMinAddBps)
    const maxPriorityFee = increaseByBps(slowPriorityFee, priorityFeeMaxAddBps)
    const maxPriorityFeePerGas = clamp(
      priorityFees[i] || minPriorityFee,
      minPriorityFee,
      maxPriorityFee
    )

    fee.push({
      name,
      baseFeePerGas,
      maxPriorityFeePerGas
    })
  })

  return fee
}

async function getLegacyGasPriceRecommendations(
  client: PublicClient,
  network: Network
): Promise<GasPriceRecommendation[]> {
  const { gasPrice } = await getLegacyViemFees(client)
  const minGasPrice = increaseByPercent(
    gasPrice > MIN_GAS_PRICE ? gasPrice : MIN_GAS_PRICE,
    network.feeOptions.feeIncrease
  )

  return speeds.map(({ name, baseFeeAddBps }) => ({
    name,
    gasPrice: increaseByBps(minGasPrice, baseFeeAddBps)
  }))
}

export async function getGasPriceRecommendations(
  provider: JsonRpcProvider,
  network: Network,
  _blockTag?: string | number,
  getIsActive?: () => boolean
): Promise<{ gasPrice: GasRecommendation[] }> {
  if (getIsActive && !getIsActive()) {
    throw new Error('operation aborted')
  }

  const client = getViemClientForProvider(provider)

  if (network.feeOptions.is1559) {
    return { gasPrice: await get1559GasPriceRecommendations(client) }
  }

  return { gasPrice: await getLegacyGasPriceRecommendations(client, network) }
}

export function getProbableCallData(
  accountOp: AccountOp,
  accountState: AccountOnchainState,
  shouldIncludeActivatorCall: boolean
): string {
  let estimationCallData

  // include the activator call for estimation if any
  const localOp = { ...accountOp }
  if (shouldIncludeActivatorCall) localOp.activatorCall = getActivatorCall(localOp.accountAddr)

  // always call executeMultiple as the worts case scenario
  // we disregard the initCode
  if (accountState.isDeployed) {
    const ambireAccount = new Interface(AmbireAccount.abi)
    estimationCallData = ambireAccount.encodeFunctionData('executeMultiple', [
      [
        [
          getSignableCalls(localOp),
          '0x0dc2d37f7b285a2243b2e1e6ba7195c578c72b395c0f76556f8961b0bca97ddc44e2d7a249598f56081a375837d2b82414c3c94940db3c1e64110108021161ca1c01'
        ]
      ]
    ])
  } else {
    // deployAndExecuteMultiple is the worst case
    const ambireFactory = new Interface(AmbireFactory.abi)
    estimationCallData = ambireFactory.encodeFunctionData('deployAndExecuteMultiple', [
      '0x7f00000000000000000000000000000000000000000000000000000000000000017fad3228b676f7d3cd4284a5443f17f1962b36e491b30a40b2405849e597ba5fb5553d602d80604d3d3981f3363d3d373d3d3d363d7353a31973ebcc225e219bb0d7c0c9324773f5b3e95af43d82803e903d91602b57fd5bf3',
      '0x0000000000000000000000000000000000000000000000000000000000000000',
      [
        [
          getSignableCalls(localOp),
          '0x0dc2d37f7b285a2243b2e1e6ba7195c578c72b395c0f76556f8961b0bca97ddc44e2d7a249598f56081a375837d2b82414c3c94940db3c1e64110108021161ca1c01'
        ]
      ]
    ])
  }

  return estimationCallData
}

export function getBroadcastGas(baseAcc: BaseAccount, op: AccountOp): bigint {
  const calldata = baseAcc.getBroadcastCalldata(op)
  if (calldata === '0x') return 0n

  const FIXED_OVERHEAD = 21000n
  const bytes = Buffer.from(baseAcc.getBroadcastCalldata(op).substring(2))
  const nonZeroBytes = BigInt(bytes.filter((b) => b).length)
  const zeroBytes = BigInt(BigInt(bytes.length) - nonZeroBytes)
  const txDataGas = zeroBytes * 4n + nonZeroBytes * 16n
  return txDataGas + FIXED_OVERHEAD
}

/**
 * As the name suggests, take our libs gas price format and transform it to match
 * the one returned from the bundler
 *
 * @param gasRecommendations - our lib's format
 * @returns GasSpeeds - the bundler format
 */
export function gasPriceToBundlerFormat(gasRecommendations: GasRecommendation[]): GasSpeeds {
  const formatted: any = {}

  for (let i = 0; i < gasRecommendations.length; i++) {
    const entry = gasRecommendations[i]!
    if ('baseFeePerGas' in entry) {
      const eip1559 = entry as Gas1559Recommendation
      formatted[eip1559.name] = {
        maxFeePerGas: toBeHex(eip1559.baseFeePerGas + eip1559.maxPriorityFeePerGas),
        maxPriorityFeePerGas: toBeHex(eip1559.maxPriorityFeePerGas)
      }
    } else {
      const oldFormat = entry as GasPriceRecommendation
      formatted[oldFormat.name] = {
        maxFeePerGas: toBeHex(oldFormat.gasPrice),
        maxPriorityFeePerGas: 0
      }
    }
  }

  return formatted as GasSpeeds
}
