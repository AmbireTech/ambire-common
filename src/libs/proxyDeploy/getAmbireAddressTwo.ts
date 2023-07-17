import { ethers } from "ethers";

export function getAmbireAccountAddress(factoryAddress: string, bytecode: string) {
  return ethers.getCreate2Address(
    factoryAddress,
    ethers.toBeHex(0, 32),
    ethers.keccak256(bytecode)
  )
}