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

// multipliers from the old: https://github.com/AmbireTech/relayer/blob/wallet-v2/src/utils/gasOracle.js#L64-L76
// 2x, 2x*0.4, 2x*0.2 - all of them divided by 8 so 0.25, 0.1, 0.05 - those seem usable; with a slight tweak for the ape
const speeds = [
  { name: 'slow', baseFeeAddBps: 0n },
  { name: 'medium', baseFeeAddBps: 500n },
  { name: 'fast', baseFeeAddBps: 1000n },
  { name: 'ape', baseFeeAddBps: 1500n }
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

// https://stackoverflow.com/questions/20811131/javascript-remove-outlier-from-an-array
function filterOutliers(data: bigint[]): bigint[] {
  if (!data.length) return []

  // numeric sort, a - b doesn't work for bigint
  data.sort((a, b) => {
    if (a === b) return 0
    if (a > b) return 1
    return -1
  })

  const q1 = data[Math.floor(data.length / 4)]
  const endPosition = Math.ceil(data.length * (3 / 4))
  const q2 = data[endPosition < data.length ? endPosition : data.length - 1]

  // typescript extra protection
  // q1 and q2 should always exist based on the code above.
  // but the code changes and a bug is introduced, make sure we return
  // the whole data instead of throwing an error
  if (!q1 || !q2) {
    console.error('q1 or q2 not found in gasPrice.ts')
    return data
  }

  const iqr = q2 - q1
  const maxValue = q2 + (iqr * 15n) / 10n
  const minValue = q1 - (iqr * 15n) / 10n
  const filteredValues = data.filter((x) => x <= maxValue && x >= minValue)
  return filteredValues
}

function average(data: bigint[]): bigint {
  if (data.length === 0) return 0n
  return data.reduce((a, b) => a + b, 0n) / BigInt(data.length)
}

function increaseByBps(value: bigint, bps: bigint): bigint {
  return value + (value * bps) / 10000n
}

function increaseByPercent(value: bigint, percent?: bigint): bigint {
  if (!percent) return value
  return value + (value * percent) / 100n
}

function getAveragePriorityFeesFromHistory(rewards: bigint[][]): bigint[] {
  return FEE_HISTORY_REWARD_PERCENTILES.map((_percentile, percentileIndex) => {
    const fees = rewards
      .map((reward) => reward[percentileIndex])
      .filter((fee): fee is bigint => typeof fee === 'bigint' && fee > 0n)

    return average(filterOutliers(fees))
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

  const priorityFees = feeHistory ? getAveragePriorityFeesFromHistory(feeHistory.reward ?? []) : []
  const fee: Gas1559Recommendation[] = []

  speeds.forEach(({ name, baseFeeAddBps }, i) => {
    const baseFeePerGas = increaseByBps(expectedBaseFee, baseFeeAddBps)
    let maxPriorityFeePerGas = priorityFees[i] || estimatedFees.maxPriorityFeePerGas

    if (maxPriorityFeePerGas < estimatedFees.maxPriorityFeePerGas) {
      maxPriorityFeePerGas = estimatedFees.maxPriorityFeePerGas
    }

    // set a bare minimum of 100000n for maxPriorityFeePerGas
    maxPriorityFeePerGas = maxPriorityFeePerGas >= 100000n ? maxPriorityFeePerGas : 100000n

    // compare the maxPriorityFeePerGas with the previous speed
    // if it's not at least 12% bigger, then replace the calculated one
    // with at least 12% bigger maxPriorityFeePerGas.
    // This is most impactufull on L2s where txns get stuck for low maxPriorityFeePerGas
    //
    // if the speed is ape, make it 50% more
    const prevSpeed = fee.length ? fee[i - 1]?.maxPriorityFeePerGas : null
    if (prevSpeed) {
      const divider = name === 'ape' ? 2n : 8n
      const min = prevSpeed + prevSpeed / divider
      if (maxPriorityFeePerGas < min) maxPriorityFeePerGas = min
    }

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
