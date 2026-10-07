import type { Network } from '../../interfaces/network'
import { BROADCAST_OPTIONS } from '../broadcast/broadcast'

type FeeNetwork = Pick<Network, 'chainId'>

export function increaseFee(amount: bigint, isAccountSafe: boolean, network: FeeNetwork): bigint {
  if (isAccountSafe) {
    if (network.chainId === 1n) return amount + amount / 4n

    return amount + amount / 2n
  }

  return amount + amount / 10n
}

function getAmountAfterFeeTokenConvert(
  simulatedGasLimit: bigint,
  gasPrice: bigint,
  nativeRatio: bigint,
  feeTokenDecimals: number,
  addedNative: bigint
) {
  const amountInWei = simulatedGasLimit * gasPrice + addedNative

  // Convert native gas cost to fee-token units, preserving 18 decimals of ratio precision.
  const extraDecimals = BigInt(10 ** 18)
  const feeTokenExtraDecimals = BigInt(10 ** (18 - feeTokenDecimals))
  const pow = extraDecimals * feeTokenExtraDecimals
  const result = (amountInWei * nativeRatio) / pow

  if (result === 0n && amountInWei !== 0n) {
    return 1n
  }

  return result
}

export function calculateFeeAmount({
  broadcastOption,
  simulatedGasLimit,
  gasPrice,
  nativeRatio,
  feeTokenDecimals,
  addedNative,
  usesPaymaster,
  isAccountSafe,
  network
}: {
  broadcastOption: string
  simulatedGasLimit: bigint
  gasPrice: bigint
  nativeRatio: bigint
  feeTokenDecimals: number
  addedNative: bigint
  usesPaymaster?: boolean
  isAccountSafe: boolean
  network: FeeNetwork
}): bigint {
  if (
    broadcastOption === BROADCAST_OPTIONS.bySelf ||
    broadcastOption === BROADCAST_OPTIONS.bySelf7702 ||
    broadcastOption === BROADCAST_OPTIONS.byOtherEOA
  ) {
    return simulatedGasLimit * gasPrice + addedNative
  }

  let amount = getAmountAfterFeeTokenConvert(
    simulatedGasLimit,
    gasPrice,
    nativeRatio,
    feeTokenDecimals,
    addedNative
  )

  if (broadcastOption === BROADCAST_OPTIONS.byBundler && usesPaymaster) {
    amount = increaseFee(amount, isAccountSafe, network)
  }

  return amount
}
