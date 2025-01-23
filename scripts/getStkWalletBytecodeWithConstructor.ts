require('dotenv').config()
// eslint-disable-next-line import/no-extraneous-dependencies
const { ethers } = require('hardhat')

async function main() {
  const WALLET_ADDRESS = '0x88800092ff476844f74dc2fc427974bbee2794ae'
  const XWALLET_ADDRESS = '0x47cd7e91c3cbaaf266369fe8518345fc4fc12935'

  // Get the contract factory
  const Example = await ethers.getContractFactory('stkWALLET')

  // Deploy the contract, which will invoke the constructor
  const example = await Example.deploy(WALLET_ADDRESS, XWALLET_ADDRESS) // Here we pass a number to the constructor

  // Wait for the contract to be deployed
  const deployedExample = await example.waitForDeployment()

  // Fetch the deployment transaction
  const deploymentTx = await ethers.provider.getTransaction(
    deployedExample.deploymentTransaction().hash
  )

  // Compute the bytecode including the constructor parameters
  const bytecodeWithConstructor = deploymentTx.data

  console.log('Bytecode with constructor:', bytecodeWithConstructor)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
