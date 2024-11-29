require('dotenv').config()
// eslint-disable-next-line import/no-extraneous-dependencies
const { ethers } = require('hardhat')

async function main() {
  const implementation = await ethers.deployContract('LegendsNFTImplementation')
  await implementation.waitForDeployment()
  console.log(`Implementation deployed at ${implementation.target}`)
  const proxyStaging = await ethers.deployContract('LegendsNFT', [
    implementation.target,
    'Ambire Legends - Staging',
    'AMS'
  ])
  console.log(`Staging proxy deployed at ${proxyStaging.target}`)
  const proxyProd = await ethers.deployContract('LegendsNFT', [
    implementation.target,
    'Ambire Legends',
    'AML'
  ])
  console.log(`Production proxy deployed at ${proxyProd.target}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
