import {
  AbiCoder,
  concat,
  Contract,
  getCreate2Address,
  Interface,
  keccak256,
  toBeHex,
  ZeroAddress,
  zeroPadValue
} from 'ethers'

import { SafeCreationInfoResponse } from '@safe-global/api-kit'

import { execTransactionAbi, multiSendAddr } from '../../consts/safe'
import { AccountOnchainState } from '../../interfaces/account'
import { Hex } from '../../interfaces/hex'
import { Key } from '../../interfaces/keystore'
import { RPCProvider } from '../../interfaces/provider'
import { SafeTx } from '../../interfaces/safe'
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'

export function isSupportedSafeVersion(version: string): boolean {
  const [major, minor] = version.split('.').map(Number)
  if ([major, minor].some(Number.isNaN)) return false

  if (major && major > 1) return true
  if (major === 1 && minor && minor >= 3) return true

  return false
}

export async function getCalculatedSafeAddress(
  creation: SafeCreationInfoResponse,
  provider: RPCProvider
): Promise<Hex | null> {
  const salt = keccak256(
    concat([keccak256(creation.setupData), zeroPadValue(toBeHex(creation.saltNonce || 0), 32)])
  )
  const factoryAbi = ['function proxyCreationCode() view returns (bytes)']
  const factory = new Contract(creation.factoryAddress, factoryAbi, provider)
  let proxyCreationCode
  try {
    proxyCreationCode = await (factory as any).proxyCreationCode()
  } catch (e) {
    console.error(
      `failed to call proxyCreationCode on safe factory with addr: ${creation.factoryAddress}`
    )
    return null
  }
  const abiCoder = new AbiCoder()
  const bytecode = concat([
    proxyCreationCode,
    abiCoder.encode(['address'], [creation.singleton])
  ]) as Hex
  return getCreate2Address(creation.factoryAddress, salt, keccak256(bytecode)) as Hex
}

/**
 * The setup() method is the same for v1.3, 1.4.1, 1.5. We decode it
 * to fetch the initial owners of the safe so that we could put them
 * in the account associatedKeys
 */
export function decodeSetupData(setupData: Hex): Hex[] {
  const setupMethodAbi = [
    'function setup(address[] calldata _owners,uint256 _threshold,address to,bytes calldata data,address fallbackHandler,address paymentToken,uint256 payment,address payable paymentReceiver)'
  ]
  const setupMethodInterface = new Interface(setupMethodAbi)
  let decoded = null
  try {
    decoded = setupMethodInterface.decodeFunctionData('setup', setupData)
  } catch (e) {
    console.error('failed to decode the safe setup data')
    return []
  }

  return Object.keys(decoded[0]).map((key) => decoded[0][key])
}

/**
 * Construct a safe txn for signing
 */
export function getSafeTxn(op: AccountOp, state: AccountOnchainState): SafeTx {
  const coder = new AbiCoder()
  const calls = getSignableCalls(op)

  let to
  let value
  let data
  let operation

  if (calls.length === 1) {
    const singleCall = calls[0]!
    to = singleCall[0]
    value = BigInt(singleCall[1])
    data = singleCall[2]
    operation = 0 // static call
  } else {
    const multiSendCalls = calls.map((call) => {
      return coder.encode(
        ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
        [0, call[0], call[1], call[2].length, call[2]]
      )
    })
    to = multiSendAddr
    value = 0n
    data = concat(multiSendCalls)
    operation = 1 // delegate call
  }

  return {
    to: to as Hex,
    value,
    data: data as Hex,
    operation,
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: ZeroAddress as Hex,
    refundReceiver: ZeroAddress as Hex,
    nonce: op.nonce || state.nonce || 0n
  }
}

export function getSafeBroadcastTxn(
  op: AccountOp,
  state: AccountOnchainState
): { to: Hex; value: bigint; data: Hex } {
  const exec = new Interface(execTransactionAbi)
  const safeTxn = getSafeTxn(op, state)
  return {
    to: op.accountAddr as Hex,
    value: 0n,
    data: exec.encodeFunctionData('execTransaction', [
      safeTxn.to,
      safeTxn.value,
      safeTxn.data,
      safeTxn.operation,
      safeTxn.safeTxGas,
      safeTxn.baseGas,
      safeTxn.gasPrice,
      safeTxn.gasToken,
      safeTxn.refundReceiver,
      op.signature
    ]) as Hex
  }
}

/**
 * In safe, the signatures need to be in order for the transaction
 * to pass and to be valid. So, we sort the owners initially and sign
 * with them one by one, in the correct order.
 * This would be better to do with signature alone but we would
 * need to do ecrecover on them to get the address
 */
export function sortOwners(keys: Key[], threshold: number): Key[] {
  const sortByAddress = (sortableKeys: Key[]) => {
    return sortableKeys.sort((a, b) => {
      const aBig = BigInt(a.addr.toLowerCase())
      const bBig = BigInt(b.addr.toLowerCase())
      return aBig < bBig ? -1 : aBig > bBig ? 1 : 0
    })
  }

  // get internal keys first, if any, and keep only those until threshold is met
  const internalFirst = keys
    .sort((a, b) => {
      const isAInternal = a.type === 'internal'
      const isBInternal = b.type === 'internal'
      return isAInternal && !isBInternal ? -1 : !isAInternal && isBInternal ? 1 : 0
    })
    .slice(0, threshold)
  return sortByAddress(internalFirst)
}
