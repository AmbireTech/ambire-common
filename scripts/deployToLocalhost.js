const { ethers } = require('ethers')
const deploySalt = 0
const deployGasLimit = 1000000
const AmbireAccount = require('../artifacts/contracts/AmbireAccount.sol/AmbireAccount.json')
const AmbireAccountFactory = require('../artifacts/contracts/AmbireAccountFactory.sol/AmbireAccountFactory.json')
const { getProxyDeployBytecode, getStorageSlotsFromArtifact } = require('../src/libs/proxyDeploy/deploy')
const { expect } = require('chai')

// get the expect address after the contract is deployed by the deployer
function getAmbireAccountAddress(factoryAddress, bytecode) {
  return ethers.getCreate2Address(
    factoryAddress,
    ethers.toBeHex(deploySalt, 32),
    ethers.keccak256(bytecode)
  )
}

function getTimelockData(recoveryInfo) {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder()
  const hash = ethers.keccak256(abiCoder.encode(['tuple(address[], uint)'], [recoveryInfo]))
  const timelockAddress = `0x${hash.slice(hash.length - 40, hash.length)}`
  return { hash, timelockAddress }
}

async function deploy() {
  const provider = new ethers.JsonRpcProvider('http://localhost:8545/')
  const wallet = new ethers.Wallet(
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // hardhat PK
    provider
  )
  const factoryCF = new ethers.ContractFactory(AmbireAccountFactory.abi, AmbireAccountFactory.bytecode, wallet)
  const factory = await factoryCF.deploy(wallet.address)
  await factory.waitForDeployment()
  const contractCF = new ethers.ContractFactory(AmbireAccount.abi, AmbireAccount.bytecode, wallet)
  const contract = await contractCF.deploy([])
  await contract.waitForDeployment()
  const addr = await contract.getAddress()
  const timelock = 60 * 60 * 24 * 3
  // PLACE THE RECOVERY KEY HERE
  const recoveryInfo = [['0x1893b961d2999388693E001a5Dc0BB825551b907'], timelock]
  const {hash, timelockAddress} = getTimelockData(recoveryInfo)
  const priLevels = [
    { addr: wallet.address, hash: true },
    { addr: timelockAddress, hash: hash },
  ]
  expect(addr).not.to.be.null

  // get the bytecode and deploy it
  const bytecode = getProxyDeployBytecode(addr, priLevels, {
    ...getStorageSlotsFromArtifact(null)
  })
  await factory.deploy(bytecode, deploySalt, { deployGasLimit })

  const ambireAddr = getAmbireAccountAddress(await factory.getAddress(), bytecode)
  console.log(`Ambire account deployed at ${ambireAddr}`)
}

deploy()