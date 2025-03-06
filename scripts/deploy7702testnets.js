require('dotenv').config()
// eslint-disable-next-line import/no-extraneous-dependencies
const { ethers } = require('hardhat')

async function main() {
  const implementation = await ethers.deployContract('AmbireAccount7702')
  await implementation.waitForDeployment()
  console.log(`Implementation deployed at ${implementation.target}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
