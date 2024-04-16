import { getCreate2Address, keccak256, toBeHex } from 'ethers'

export function getAmbireAccountAddress(factoryAddress: string, bytecode: string) {
  return getCreate2Address(factoryAddress, toBeHex(0, 32), keccak256(bytecode))
}
