require('dotenv').config()
// eslint-disable-next-line import/no-extraneous-dependencies
const { ethers } = require('hardhat')

async function main() {
  const implementation = await ethers.deployContract('LegendsNFTImplementation')
  await implementation.waitForDeployment()
  console.log(`Implementation deployed at ${implementation.target}`)
  const proxyProd = await ethers.deployContract('LegendsNFT', [
    implementation.target,
    'Ambire Legends',
    'AML'
  ])
  console.log(`Production proxy deployed at ${proxyProd.target}`)
  console.log('Do not forget to set the implementation from the block explorer')
  console.log('Do not forget mark the proxy as such from EXPLRER_URL/proxyContractChecker')
  console.log('Do not forget verify both contracts')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
