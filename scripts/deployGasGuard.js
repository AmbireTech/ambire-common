/* eslint-disable no-console */
require('dotenv').config()
// eslint-disable-next-line import/no-extraneous-dependencies
const { ethers } = require('hardhat')

async function main() {
  const gasGuard = await ethers.deployContract('GasGuard')
  console.log(`gasGuard deployed at ${gasGuard.target}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
