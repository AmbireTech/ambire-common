import { Provider } from 'ethers'

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

// https://stackoverflow.com/questions/20811131/javascript-remove-outlier-from-an-array
function filterOutliers(data: bigint[]): bigint[] {
  if (!data.length) return []

  // numeric sort, a - b doesn't work for bigint
  data.sort((a, b) => (a == b ? 0 : a > b ? 1 : -1))
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
  const end = n != 3 || data.length < 4 ? at + Math.max(1, step) : data.length
  return data.slice(at, end)
}

function average(data: bigint[]): bigint {
  if (data.length === 0) return 0n
  return data.reduce((a, b) => a + b, 0n) / BigInt(data.length)
}
