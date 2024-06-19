import { Block, Interface, Provider } from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireFactory from '../../../contracts/compiled/AmbireFactory.json'
import { AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'
import { getActivatorCall, shouldIncludeActivatorCall } from '../userOperation/userOperation'

// https://eips.ethereum.org/EIPS/eip-1559
const DEFAULT_BASE_FEE_MAX_CHANGE_DENOMINATOR = 8n
const DEFAULT_ELASTICITY_MULTIPLIER = 2n

// multipliers from the old: https://github.com/AmbireTech/relayer/blob/wallet-v2/src/utils/gasOracle.js#L64-L76
// 2x, 2x*0.4, 2x*0.2 - all of them divided by 8 so 0.25, 0.1, 0.05 - those seem usable; with a slight tweak for the ape
const speeds = [
  { name: 'slow', baseFeeAddBps: 0n },
  { name: 'medium', baseFeeAddBps: 500n },
  { name: 'fast', baseFeeAddBps: 1000n },
  { name: 'ape', baseFeeAddBps: 1500n }
]

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
  const iqr = q2 - q1
  const maxValue = q2 + (iqr * 15n) / 10n
  const minValue = q1 - (iqr * 15n) / 10n
  const filteredValues = data.filter((x) => x <= maxValue && x >= minValue)
  return filteredValues
}

function nthGroup(data: bigint[], n: number, outOf: number): bigint[] {
  const step = Math.floor(data.length / outOf)
  const at = n * step

  // if n is 3 (ape speed) and we have at least 4 txns in the previous block,
  // we want to include the remaining high cost transactions in the group.
  // Example: 15 txns make 3 groups of 3 for slow, medium and fast, totalling 9
  // the remaining 6 get included in the ape calculation
  const end = n !== 3 || data.length < 4 ? at + Math.max(1, step) : data.length
  return data.slice(at, end)
}

function average(data: bigint[]): bigint {
  if (data.length === 0) return 0n
  return data.reduce((a, b) => a + b, 0n) / BigInt(data.length)
}

// if there's an RPC issue, try refetching the block at least
// 5 times before declaring a failure
async function refetchBlock(
  provider: Provider,
  blockTag: string | number = -1,
  counter = 0
): Promise<Block> {
  // the reason we throw an error here is that getGasPriceRecommendations is
  // used in main.ts #updateGasPrice where we emit an error with a predefined
  // msg, which in turn displays a notification popup with the error.
  // If we change the design and decide to display this as an error
  // somewhere else, we should probably not throw, but return the
  // error instead
  if (counter >= 5) throw new Error('unable to retrieve block')

  let lastBlock = null
  try {
    lastBlock = await provider.getBlock(blockTag, true)
  } catch (e) {
    lastBlock = null
  }

  if (!lastBlock) {
    // delay the refetch with a bit of time to give the RPC a chance
    // to get back up
    const delayPromise = (ms: number) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms)
      })
    await delayPromise(250)

    const localCounter = counter + 1
    lastBlock = await refetchBlock(provider, blockTag, localCounter)
  }

  return lastBlock
}

export async function getGasPriceRecommendations(
  provider: Provider,
  network: Network,
  blockTag: string | number = -1
): Promise<GasRecommendation[]> {
  const lastBlock = await refetchBlock(provider, blockTag)
  // https://github.com/ethers-io/ethers.js/issues/3683#issuecomment-1436554995
  const txns = lastBlock.prefetchedTransactions

  if (network.feeOptions.is1559 && lastBlock.baseFeePerGas != null) {
    // https://eips.ethereum.org/EIPS/eip-1559
    const elasticityMultiplier =
      network.feeOptions.elasticityMultiplier ?? DEFAULT_ELASTICITY_MULTIPLIER
    const baseFeeMaxChangeDenominator =
      network.feeOptions.baseFeeMaxChangeDenominator ?? DEFAULT_BASE_FEE_MAX_CHANGE_DENOMINATOR

    const gasTarget = lastBlock.gasLimit / elasticityMultiplier
    const baseFeePerGas = lastBlock.baseFeePerGas
    const getBaseFeeDelta = (delta: bigint) =>
      (baseFeePerGas * delta) / gasTarget / baseFeeMaxChangeDenominator
    let expectedBaseFee = baseFeePerGas
    if (lastBlock.gasUsed > gasTarget) {
      const baseFeeDelta = getBaseFeeDelta(lastBlock.gasUsed - gasTarget)
      expectedBaseFee += baseFeeDelta === 0n ? 1n : baseFeeDelta
    } else if (lastBlock.gasUsed < gasTarget) {
      const baseFeeDelta = getBaseFeeDelta(gasTarget - lastBlock.gasUsed)
      expectedBaseFee -= baseFeeDelta
    }

    // if the estimated fee is below the chain minimum, set it to the min
    if (network.feeOptions.minBaseFee && expectedBaseFee < network.feeOptions.minBaseFee) {
      expectedBaseFee = network.feeOptions.minBaseFee
    }

    const tips = filterOutliers(txns.map((x) => x.maxPriorityFeePerGas!).filter((x) => x > 0))
    return speeds.map(({ name, baseFeeAddBps }, i) => {
      const baseFee = expectedBaseFee + (expectedBaseFee * baseFeeAddBps) / 10000n

      // maxPriorityFeePerGas is important for networks with longer block time
      // like Ethereum (12s) but not at all for L2s with instant block creation.
      // For L2s we hardcode the maxPriorityFee to 100n
      const maxPriorityFeePerGas =
        network.feeOptions.maxPriorityFee ?? average(nthGroup(tips, i, speeds.length))

      return {
        name,
        baseFeePerGas: baseFee,
        maxPriorityFeePerGas
      }
    })
  }
  const prices = filterOutliers(txns.map((x) => x.gasPrice!).filter((x) => x > 0))
  return speeds.map(({ name }, i) => ({
    name,
    gasPrice: average(nthGroup(prices, i, speeds.length))
  }))
}

export function getProbableCallData(
  accountOp: AccountOp,
  accountState: AccountOnchainState,
  network: Network
): string {
  let estimationCallData

  // include the activator call for estimation if any
  const localOp = { ...accountOp }
  if (shouldIncludeActivatorCall(network, accountState, false)) {
    localOp.activatorCall = getActivatorCall(localOp.accountAddr)
  }

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

export function getCallDataAdditionalByNetwork(
  accountOp: AccountOp,
  network: Network,
  accountState: AccountOnchainState
): bigint {
  // no additional call data is required for arbitrum as the bytes are already
  // added in the calculation for the L1 fee
  if (network.id === 'arbitrum') return 0n

  const estimationCallData = getProbableCallData(accountOp, accountState, network)
  const FIXED_OVERHEAD = 21000n
  const bytes = Buffer.from(estimationCallData.substring(2))
  const nonZeroBytes = BigInt(bytes.filter((b) => b).length)
  const zeroBytes = BigInt(BigInt(bytes.length) - nonZeroBytes)
  const txDataGas = zeroBytes * 4n + nonZeroBytes * 16n
  return txDataGas + FIXED_OVERHEAD
}
