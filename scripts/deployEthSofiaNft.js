require('dotenv').config()
// eslint-disable-next-line import/no-extraneous-dependencies
const { ethers } = require('hardhat')

async function main() {
  const nft = await ethers.deployContract('EthSofiaNft')

  await nft.waitForDeployment().catch(console.log)

  console.log(`NFT Contract Deployed at ${nft.target}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
