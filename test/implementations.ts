import { ethers } from 'hardhat'
import {
  AmbireAccount,
  expect,
  buildInfo,
  deploySalt,
  deployGasLimit,
  assertion
} from './config'
import { getProxyDeployBytecode, getStorageSlotsFromArtifact } from '../src/libs/proxyDeploy/deploy'
import { PrivLevels } from '../src/libs/proxyDeploy/deploy'

// get the expect address after the contract is deployed by the deployer
function getAmbireAccountAddress(factoryAddress: string, bytecode: string) {
  return ethers.getCreate2Address(
    factoryAddress,
    ethers.toBeHex(deploySalt, 32),
    ethers.keccak256(bytecode)
  )
}

async function deployAmbireAccountHardhatNetwork(priLevels: PrivLevels[]) {
  assertion.expectExpects(1 + priLevels.length)
  const [signer] = await ethers.getSigners()

  const factory = await ethers.deployContract('AmbireAccountFactory', [signer.address])
  const contract: any = await ethers.deployContract('AmbireAccount')
  const addr = await contract.getAddress()
  expect(addr).not.to.be.null

  // get the bytecode and deploy it
  const bytecode = getProxyDeployBytecode(addr, priLevels, {
    ...getStorageSlotsFromArtifact(buildInfo)
  })
  await factory.deploy(bytecode, deploySalt, { deployGasLimit })

  const ambireAccountAddress = getAmbireAccountAddress(await factory.getAddress(), bytecode)
  const ambireAccount: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)

  const promises = priLevels.map(priv => ambireAccount.privileges(priv.addr))
  const result = await Promise.all(promises)
  result.map((res, index) => {
    const expected = priLevels[index].hash === true ? ethers.toBeHex(1, 32) : priLevels[index].hash
    expect(res).to.equal(expected)
  })
  return {ambireAccount, ambireAccountAddress, factoryAddress: await factory.getAddress(), bytecode, deploySalt}
}

export {
  getAmbireAccountAddress,
  deployAmbireAccountHardhatNetwork
}
