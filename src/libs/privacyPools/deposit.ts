import { Interface } from 'ethers'

import { toPrivacyPoolsAssetAddress } from '../../consts/privacyPools'
import { Hex } from '../../interfaces/hex'
import { ZERO_ADDRESS } from '../../services/socket/constants'

/** The entrypoint's native deposit, which carries the amount as the call's value. */
export const NATIVE_DEPOSIT_SIGNATURE = 'deposit(uint256)'
/** The entrypoint's ERC-20 deposit, which pulls the amount with `transferFrom`. */
export const ERC20_DEPOSIT_SIGNATURE = 'deposit(address,uint256,uint256)'

/** The entrypoint's two deposit functions - the only calls a deposit makes into it. */
export const ENTRYPOINT_DEPOSIT_INTERFACE = new Interface([
  'function deposit(uint256 _precommitment) payable returns (uint256)',
  'function deposit(address _asset, uint256 _value, uint256 _precommitment) returns (uint256)'
])

export type PrivacyPoolsDepositCall = {
  precommitment: bigint
  /** In the SDK's convention, where native is its own sentinel rather than the zero address. */
  assetAddress: string
  amount: bigint
}

/**
 * Reads an entrypoint deposit call: what it deposits, how much, and under which precommitment -
 * which is what ties the deposit to the account it goes to. Null for any other call, including one
 * whose data does not decode.
 */
export const readPrivacyPoolsDeposit = ({
  data,
  value
}: {
  data: string
  value: bigint
}): PrivacyPoolsDepositCall | null => {
  let parsed
  try {
    parsed = ENTRYPOINT_DEPOSIT_INTERFACE.parseTransaction({ data, value })
  } catch {
    return null
  }
  if (!parsed) return null

  if (parsed.signature === NATIVE_DEPOSIT_SIGNATURE)
    return {
      precommitment: BigInt(parsed.args[0]),
      assetAddress: toPrivacyPoolsAssetAddress(ZERO_ADDRESS),
      amount: value
    }

  if (parsed.signature === ERC20_DEPOSIT_SIGNATURE)
    return {
      precommitment: BigInt(parsed.args[2]),
      assetAddress: String(parsed.args[0]),
      amount: BigInt(parsed.args[1])
    }

  return null
}

/** Encodes a deposit of `amount` under `precommitment` - the inverse of `readPrivacyPoolsDeposit`. */
export const encodePrivacyPoolsDeposit = ({
  isNative,
  assetAddress,
  amount,
  precommitment
}: {
  isNative: boolean
  /** The wallet's address for the asset; unused for native. */
  assetAddress: string
  amount: bigint
  precommitment: bigint
}): { value: bigint; data: Hex } =>
  isNative
    ? {
        value: amount,
        data: ENTRYPOINT_DEPOSIT_INTERFACE.encodeFunctionData(NATIVE_DEPOSIT_SIGNATURE, [
          precommitment
        ]) as Hex
      }
    : {
        value: 0n,
        data: ENTRYPOINT_DEPOSIT_INTERFACE.encodeFunctionData(ERC20_DEPOSIT_SIGNATURE, [
          assetAddress,
          amount,
          precommitment
        ]) as Hex
      }
