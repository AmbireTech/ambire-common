import { BROADCAST_OPTIONS } from '../broadcast/broadcast'

export type FeeBroadcaster = 'paymaster' | 'relayer'

export function increaseFee(amount: bigint, broadcaster: FeeBroadcaster = 'relayer'): bigint {
  if (broadcaster === 'paymaster') return amount + amount / 10n

  return amount + amount / 20n
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
  usesPaymaster
}: {
  broadcastOption: string
  simulatedGasLimit: bigint
  gasPrice: bigint
  nativeRatio: bigint
  feeTokenDecimals: number
  addedNative: bigint
  usesPaymaster?: boolean
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
    amount = increaseFee(amount, 'paymaster')
  } else if (broadcastOption !== BROADCAST_OPTIONS.byBundler) {
    amount = increaseFee(amount)
  }

  return amount
}
