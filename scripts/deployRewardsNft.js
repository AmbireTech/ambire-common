require('dotenv').config()
const { ZeroAddress } = require('ethers')
// eslint-disable-next-line import/no-extraneous-dependencies
const { ethers } = require('hardhat')

const FACTORY_ADDRESS = '0xce0042B868300000d44A59004Da54A005ffdcf9f' // deployed factory
const SALT = '0x0000000000000000000000000000000000000000000000000000000000000000'

async function deployContract(signer, bytecode) {
  const singletonFactory = new ethers.Contract(
    FACTORY_ADDRESS,
    ['function deploy(bytes _initCode, bytes32 _salt) returns (address createdContract)'],
    signer
  )
  const tx = await singletonFactory.deploy(bytecode, SALT, { gasLimit: 1_900_000 })
  const receipt = await tx.wait()
  console.log('Deploy tx hash:', receipt.hash)

  const initCodeHash = ethers.keccak256(bytecode)
  const parts = ['0xff', FACTORY_ADDRESS, SALT, initCodeHash].map((x) => x.replace(/^0x/, ''))

  const concatenated = `0x${parts.join('')}`
  const addressBytes = ethers.keccak256(concatenated)
  return ethers.getAddress(`0x${addressBytes.slice(-40)}`)
}

// will probably never be used again
async function deployImplementation() {
  const [signer] = await ethers.getSigners()

  const RewardsImplementation = await ethers.getContractFactory('AmbireRewardsNFTImplementation')
  const deployTx = await RewardsImplementation.getDeployTransaction(/* args here */)
  console.log('Deploying implementation')
  const implementationAddress = await deployContract(signer, deployTx.data)
  console.log('Implementation ', implementationAddress)
}

async function deployProxy() {
  const INITIAL_IMPLEMENTATION = '0xf7759895bfe7Ae439Ab6Da3441DA0d9b9b45002e'
  const [signer] = await ethers.getSigners()

  const RewardsProxy = await ethers.getContractFactory('AmbireRewardsNFT')
  const deployTx = await RewardsProxy.getDeployTransaction(
    INITIAL_IMPLEMENTATION,
    'Ambire Rewards',
    'AMR',
    signer.address
  )
  console.log('Deploying proxy')
  const proxyAddress = await deployContract(signer, deployTx.data)
  console.log('Proxy ', proxyAddress)
}

// async function deployAndUpdateImplementation() {
// const proxy = new ethers.Contract(rewardsProxyAddress,[''])
// }
// deployImplementation()
deployProxy()
