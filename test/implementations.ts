import { ethers } from 'ethers'
import {
  wallet,
  addressOne,
  AmbireAccountFactory,
  AmbireAccount,
  expect,
  buildInfo,
  deploySalt,
  deployGasLimit,
  assertion
} from './config'
import { wait } from './polling'
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

async function deployAmbireAccount(priLevels: PrivLevels[]) {
  assertion.expectExpects(1 + priLevels.length)

  // deploy the factory
  const contractFactory = new ethers.ContractFactory(
    AmbireAccountFactory.abi,
    AmbireAccountFactory.bytecode,
    wallet
  )
  const factory: any = await contractFactory.deploy(addressOne)
  await wait(wallet, factory)

  // deploy the contract as is it
  const ambireAccountFactory = new ethers.ContractFactory(
    AmbireAccount.abi,
    AmbireAccount.bytecode,
    wallet
  )
  const contract: any = await ambireAccountFactory.deploy()
  await wait(wallet, contract)
  const addr = await contract.getAddress()
  expect(addr).not.to.be.null

  // get the bytecode and deploy it
  const bytecode = getProxyDeployBytecode(addr, priLevels, {
    ...getStorageSlotsFromArtifact(buildInfo)
  })
  const deployTxn = await factory.deploy(bytecode, deploySalt, { deployGasLimit })
  await wait(wallet, deployTxn)

  const ambireAccountAddress = getAmbireAccountAddress(await factory.getAddress(), bytecode)
  const ambireAccount: any = new ethers.BaseContract(
    ambireAccountAddress,
    AmbireAccount.abi,
    wallet
  )

  const promises = priLevels.map((priv) => ambireAccount.privileges(priv.addr))
  const result = await Promise.all(promises)
  result.map((res, index) => {
    const expected = priLevels[index].hash === true ? ethers.toBeHex(1, 32) : priLevels[index].hash
    expect(res).to.equal(expected)
  })
  return { ambireAccount, ambireAccountAddress }
}

export { getAmbireAccountAddress, deployAmbireAccount }
