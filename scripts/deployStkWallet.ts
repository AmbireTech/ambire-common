require('dotenv').config()
// eslint-disable-next-line import/no-extraneous-dependencies
const { ethers } = require('hardhat')

async function main() {
  const WALLET_ADDRESS = '0x88800092ff476844f74dc2fc427974bbee2794ae'
  const XWALLET_ADDRESS = '0x47cd7e91c3cbaaf266369fe8518345fc4fc12935'

  const stkWALLET = await ethers.deployContract('stkWALLET', [WALLET_ADDRESS, XWALLET_ADDRESS])
  console.log(`stkWALLET deployed at ${stkWALLET.target}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
