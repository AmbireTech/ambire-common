import {
  AbiCoder,
  concat,
  Contract,
  getCreate2Address,
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
