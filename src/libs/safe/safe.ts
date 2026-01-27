import {
  AbiCoder,
  concat,
  Contract,
  getCreate2Address,
  Interface,
  keccak256,
  toBeHex,
  zeroPadValue
} from 'ethers'

import { SafeCreationInfoResponse } from '@safe-global/api-kit'

import { Hex } from '../../interfaces/hex'
import { RPCProvider } from '../../interfaces/provider'

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
