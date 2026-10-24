import { Interface } from 'ethers'

import { TORNADO_CASH_POOLS, TornadoCashPool } from '../../consts/tornadoCash'

const POOL_INTERFACE = new Interface(['function deposit(bytes32 _commitment) payable'])

const ERC20_INTERFACE = new Interface(['function approve(address spender, uint256 amount)'])

/** A pool by its address, whatever the case. */
export const getTornadoCashPool = (address: string | undefined): TornadoCashPool | undefined =>
  address ? TORNADO_CASH_POOLS.find((pool) => pool.address === address.toLowerCase()) : undefined

/** Reads a call into one of the supported pools' `deposit`, or null for any other call. */
export const readTornadoCashDeposit = (call: {
  to?: string | null
  data: string
  value: bigint
}): { pool: TornadoCashPool; commitment: string } | null => {
  const pool = getTornadoCashPool(call.to ?? undefined)
  if (!pool) return null

  try {
    const decoded = POOL_INTERFACE.decodeFunctionData('deposit', call.data)
    return { pool, commitment: String(decoded[0]).toLowerCase() }
  } catch {
    return null
  }
}

/** Reads an ERC-20 `approve`, or null for any other call. */
export const readErc20Approve = (call: {
  to?: string | null
  data: string
}): { token: string; spender: string; amount: bigint } | null => {
  if (!call.to) return null

  try {
    const [spender, amount] = ERC20_INTERFACE.decodeFunctionData('approve', call.data)
    return { token: call.to.toLowerCase(), spender: String(spender).toLowerCase(), amount }
  } catch {
    return null
  }
}

export const encodeErc20Approve = (spender: string, amount: bigint) =>
  ERC20_INTERFACE.encodeFunctionData('approve', [spender, amount])
