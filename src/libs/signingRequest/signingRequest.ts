import { hexlify, TypedDataEncoder } from 'ethers'

import { AccountOnchainState } from '../../interfaces/account'
import { Hex } from '../../interfaces/hex'
import { HardwareWalletSigningRequest } from '../../interfaces/signAccountOp'
import { TypedMessageUserRequest } from '../../interfaces/userRequest'
import { AccountOp, accountOpSignableHash } from '../accountOp/accountOp'
import { Network } from '../../interfaces/network'
import { getTypedData } from '../signMessage/signMessage'

/**
 * The goal of this function is to traverse the passed value
 * and successfully parse it so a readable json
 */
function getSerializableSigningRequestData(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'

  seen.add(value)

  if (Array.isArray(value)) {
    const result = value.map((item) => getSerializableSigningRequestData(item, seen))
    seen.delete(value)
    return result
  }

  const result = Object.entries(value).reduce<Record<string, unknown>>((acc, [key, val]) => {
    if (typeof val === 'function' || typeof val === 'undefined') return acc

    acc[key] = getSerializableSigningRequestData(val, seen)
    return acc
  }, {})
  seen.delete(value)
  return result
}

function getEIP712SigningRequestData(data: unknown): unknown {
  const typedData = data as TypedMessageUserRequest['meta']['params']
  let domainHash: Hex
  let messageHash: Hex

  try {
    const typesWithoutDomain = Object.fromEntries(
      Object.entries(typedData.types).filter(([typeName]) => typeName !== 'EIP712Domain')
    )

    domainHash = TypedDataEncoder.hashDomain(typedData.domain) as Hex
    messageHash = TypedDataEncoder.hashStruct(
      typedData.primaryType,
      typesWithoutDomain,
      typedData.message
    ) as Hex
  } catch {
    return data
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { data, domainHash, messageHash }
  }

  return {
    ...data,
    domainHash,
    messageHash
  }
}

export function getSigningRequestDisplayData(request: HardwareWalletSigningRequest): unknown {
  const data = request.type === 'eip-712' ? getEIP712SigningRequestData(request.data) : request.data

  return getSerializableSigningRequestData(data)
}

export function getEIP712SigningRequest(data: unknown): HardwareWalletSigningRequest {
  return {
    type: 'eip-712',
    data
  }
}

export function getRawTransactionSigningRequest(data: unknown): HardwareWalletSigningRequest {
  return {
    type: 'raw-transaction',
    data
  }
}

export function getExecuteSigningRequest({
  accountOp,
  accountState,
  network
}: {
  accountOp: AccountOp
  accountState: AccountOnchainState
  network: Network
}): HardwareWalletSigningRequest {
  const accountOpHash = hexlify(accountOpSignableHash(accountOp, network.chainId))

  if (!accountState.isV2) {
    return {
      type: 'message',
      data: {
        message: accountOpHash
      }
    }
  }

  return getEIP712SigningRequest(
    getTypedData(network.chainId, accountState.accountAddr, accountOpHash)
  )
}

export function get7702AuthorizationSigningRequest({
  chainId,
  contract,
  nonce
}: {
  chainId: bigint
  contract: Hex
  nonce: bigint
}): HardwareWalletSigningRequest {
  return {
    type: 'eip-7702-authorization',
    data: {
      chainId,
      contract,
      nonce
    }
  }
}
