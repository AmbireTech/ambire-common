import { Interface, Provider } from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireAccountFactory from '../../../contracts/compiled/AmbireAccountFactory.json'
import { networks } from '../../consts/networks'
import { AccountOnchainState } from '../../interfaces/account'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'
import { getBytecode } from '../proxyDeploy/bytecode'
import { isErc4337Broadcast } from '../userOperation/userOperation'

interface NetworkFeeOptions {
  [networkId: string]: {
    minBaseFee: bigint
  }
}

const networkFeeOptions: NetworkFeeOptions = {
  avalanche: {
    minBaseFee: 25000000000n // 25 gwei
  }
}

// https://eips.ethereum.org/EIPS/eip-1559
const BASE_FEE_MAX_CHANGE_DENOMINATOR = 8n
const ELASTICITY_MULTIPLIER = 2n

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
  data.sort((a, b) => (a === b ? 0 : a > b ? 1 : -1))
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

export async function getGasPriceRecommendations(
  provider: Provider,
  blockTag: string | number = -1
): Promise<GasRecommendation[]> {
  const lastBlock = await provider.getBlock(blockTag, true)
  if (lastBlock == null) throw new Error('unable to retrieve block')
  // https://github.com/ethers-io/ethers.js/issues/3683#issuecomment-1436554995
  const txns = lastBlock.prefetchedTransactions
  if (lastBlock.baseFeePerGas != null) {
    // https://eips.ethereum.org/EIPS/eip-1559
    const gasTarget = lastBlock.gasLimit / ELASTICITY_MULTIPLIER
    const baseFeePerGas = lastBlock.baseFeePerGas
    const getBaseFeeDelta = (delta: bigint) =>
      (baseFeePerGas * delta) / gasTarget / BASE_FEE_MAX_CHANGE_DENOMINATOR
    let expectedBaseFee = baseFeePerGas
    if (lastBlock.gasUsed > gasTarget) {
      const baseFeeDelta = getBaseFeeDelta(lastBlock.gasUsed - gasTarget)
      expectedBaseFee += baseFeeDelta === 0n ? 1n : baseFeeDelta
    } else if (lastBlock.gasUsed < gasTarget) {
      const baseFeeDelta = getBaseFeeDelta(gasTarget - lastBlock.gasUsed)
      expectedBaseFee -= baseFeeDelta
    }

    // if the estimated fee is below the chain minimum, set it to the min
    const network = await provider.getNetwork()
    const commonNetwork = networks.find((net) => net.chainId === network.chainId)!
    if (
      networkFeeOptions[commonNetwork.id] &&
      networkFeeOptions[commonNetwork.id].minBaseFee &&
      expectedBaseFee < networkFeeOptions[commonNetwork.id].minBaseFee
    ) {
      expectedBaseFee = networkFeeOptions[commonNetwork.id].minBaseFee
    }

    const tips = filterOutliers(txns.map((x) => x.maxPriorityFeePerGas!).filter((x) => x > 0))
    return speeds.map(({ name, baseFeeAddBps }, i) => ({
      name,
      baseFeePerGas: expectedBaseFee + (expectedBaseFee * baseFeeAddBps) / 10000n,
      maxPriorityFeePerGas: average(nthGroup(tips, i, speeds.length))
    }))
  }
  const prices = filterOutliers(txns.map((x) => x.gasPrice!).filter((x) => x > 0))
  return speeds.map(({ name }, i) => ({
    name,
    gasPrice: average(nthGroup(prices, i, speeds.length))
  }))
}

export function getCallDataAdditional(
  accountOp: AccountOp,
  network: NetworkDescriptor,
  accountState: AccountOnchainState
): bigint {
  let estimationCallData

  // always call executeMultiple as the worts case scenario
  // we disregard the initCode
  if (accountState.isDeployed || isErc4337Broadcast(network, accountState)) {
    const ambireAccount = new Interface(AmbireAccount.abi)
    estimationCallData = ambireAccount.encodeFunctionData('executeMultiple', [
      [
        [
          getSignableCalls(accountOp),
          '0x0dc2d37f7b285a2243b2e1e6ba7195c578c72b395c0f76556f8961b0bca97ddc44e2d7a249598f56081a375837d2b82414c3c94940db3c1e64110108021161ca1c01'
        ]
      ]
    ])
  } else {
    // deployAndExecuteMultiple is the worst case
    const ambireAccountFactory = new Interface(AmbireAccountFactory.abi)
    estimationCallData = ambireAccountFactory.encodeFunctionData('deployAndExecuteMultiple', [
      getBytecode(network, [
        {
          addr: '0x0000000000000000000000000000000000000000',
          hash: '0x0000000000000000000000000000000000000000000000000000000000000001'
        }
      ]),
      '0x0000000000000000000000000000000000000000000000000000000000000000',
      [
        [
          getSignableCalls(accountOp),
          '0x0dc2d37f7b285a2243b2e1e6ba7195c578c72b395c0f76556f8961b0bca97ddc44e2d7a249598f56081a375837d2b82414c3c94940db3c1e64110108021161ca1c01'
        ]
      ]
    ])
  }

  const FIXED_OVERHEAD = 21000n
  const bytes = Buffer.from(estimationCallData.substring(2))
  const nonZeroBytes = BigInt(bytes.filter((b) => b).length)
  const zeroBytes = BigInt(BigInt(bytes.length) - nonZeroBytes)
  const txDataGas = zeroBytes * 4n + nonZeroBytes * 16n
  return txDataGas + FIXED_OVERHEAD
}
