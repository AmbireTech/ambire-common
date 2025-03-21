import { Block, Interface, JsonRpcProvider, Provider } from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireFactory from '../../../contracts/compiled/AmbireFactory.json'
import { Account, AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { BaseAccount } from '../account/BaseAccount'
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'
import { getActivatorCall, shouldIncludeActivatorCall } from '../userOperation/userOperation'

// https://eips.ethereum.org/EIPS/eip-1559
const DEFAULT_BASE_FEE_MAX_CHANGE_DENOMINATOR = 8n
const DEFAULT_ELASTICITY_MULTIPLIER = 2n

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

function getNetworkMinBaseFee(network: Network, lastBlock: Block): bigint {
  // if we have a minBaseFee set in our config, use it
  if (network.feeOptions.minBaseFee) return network.feeOptions.minBaseFee

  // if we don't have a config, we return 0
  if (network.predefined && !network.feeOptions.minBaseFeeEqualToLastBlock) return 0n

  // if it's a custom network and it has EIP-1559, set the minimum
  // to the lastBlock's baseFeePerGas. Every chain is free to tweak
  // its EIP-1559 implementation as it deems fit. Therefore, we have no
  // guarantee the 12.5% block base fee reduction will actually happen.
  // if it doesn't and we reduce the baseFee with our calculations,
  // most often than not the transaction will just get stuck.
  //
  // Transaction fees are no longer an issue on L2s.
  // Having the user spend a fraction of the cent more is way better
  // than having his txns constantly getting stuck
  return lastBlock.baseFeePerGas ?? 0n
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
    const response = await Promise.race([
      provider.getBlock(blockTag, true),
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('last block failed to resolve, request too slow')), 6000)
      })
    ])
    lastBlock = response as Block
  } catch (e) {
    lastBlock = null
  }

  if (!lastBlock) {
    const localCounter = counter + 1
    lastBlock = await refetchBlock(provider, blockTag, localCounter)
  }

  return lastBlock
}

export async function getGasPriceRecommendations(
  provider: Provider,
  network: Network,
  blockTag: string | number = -1
): Promise<{ gasPrice: GasRecommendation[]; blockGasLimit: bigint }> {
  const [lastBlock, ethGasPrice] = await Promise.all([
    refetchBlock(provider, blockTag),
    (provider as JsonRpcProvider).send('eth_gasPrice', []).catch((e) => {
      console.log('eth_gasPrice failed because of the following reason:')
      console.log(e)
      return '0x'
    })
  ])
  // https://github.com/ethers-io/ethers.js/issues/3683#issuecomment-1436554995
  const txns = lastBlock.prefetchedTransactions

  if (
    network.feeOptions.is1559 &&
    lastBlock.baseFeePerGas != null &&
    lastBlock.baseFeePerGas !== 0n
  ) {
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
    }

    // <Bobby>: commenting out the decrease as it's really bad UX
    // if the user chooses slow on Ethereum and the next block doesn't
    // actually meet the base fee and starts going up from there, the user
    // will need to do an RBF or wait ~forever for the txn to complete
    // the below code is good in theory, bad in practise
    // else if (lastBlock.gasUsed < gasTarget) {
    //   const baseFeeDelta = getBaseFeeDelta(gasTarget - lastBlock.gasUsed)
    //   expectedBaseFee -= baseFeeDelta
    // }

    // if the estimated fee is below the chain minimum, set it to the min
    const minBaseFee = getNetworkMinBaseFee(network, lastBlock)
    if (expectedBaseFee < minBaseFee) expectedBaseFee = minBaseFee

    const tips = filterOutliers(txns.map((x) => x.maxPriorityFeePerGas!).filter((x) => x > 0))
    const fee: Gas1559Recommendation[] = []
    speeds.forEach(({ name, baseFeeAddBps }, i) => {
      const baseFee = expectedBaseFee + (expectedBaseFee * baseFeeAddBps) / 10000n
      let maxPriorityFeePerGas = average(nthGroup(tips, i, speeds.length))

      // set a bare minimum of 100000n for maxPriorityFeePerGas
      maxPriorityFeePerGas = maxPriorityFeePerGas >= 100000n ? maxPriorityFeePerGas : 100000n

      // compare the maxPriorityFeePerGas with the previous speed
      // if it's not at least 12% bigger, then replace the calculated one
      // with at least 12% bigger maxPriorityFeePerGas.
      // This is most impactufull on L2s where txns get stuck for low maxPriorityFeePerGas
      //
      // if the speed is ape, make it 50% more
      const prevSpeed = fee.length ? fee[i - 1].maxPriorityFeePerGas : null
      if (prevSpeed) {
        const divider = name === 'ape' ? 2n : 8n
        const min = prevSpeed + prevSpeed / divider
        if (maxPriorityFeePerGas < min) maxPriorityFeePerGas = min
      }

      fee.push({
        name,
        baseFeePerGas: baseFee,
        maxPriorityFeePerGas
      })
    })
    return { gasPrice: fee, blockGasLimit: lastBlock.gasLimit }
  }
  const prices = filterOutliers(txns.map((x) => x.gasPrice!).filter((x) => x > 0))

  // use th fetched price as a min if not 0 as it could be actually lower
  // than the hardcoded MIN.
  const minOrFetchedGasPrice = ethGasPrice !== '0x' ? BigInt(ethGasPrice) : MIN_GAS_PRICE

  const fee = speeds.map(({ name }, i) => {
    const avgGasPrice = average(nthGroup(prices, i, speeds.length))
    return {
      name,
      gasPrice: avgGasPrice >= minOrFetchedGasPrice ? avgGasPrice : minOrFetchedGasPrice
    }
  })
  return { gasPrice: fee, blockGasLimit: lastBlock.gasLimit }
}

export function getProbableCallData(
  account: Account,
  accountOp: AccountOp,
  accountState: AccountOnchainState,
  network: Network
): string {
  let estimationCallData

  // include the activator call for estimation if any
  const localOp = { ...accountOp }
  if (shouldIncludeActivatorCall(network, account, accountState, false)) {
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
