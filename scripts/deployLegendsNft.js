require('dotenv').config()
const { ethers } = require('ethers')
const fs = require('fs')
const path = require('path')

async function main() {
  // Connect to the Ethereum network
  const provider = new ethers.JsonRpcProvider('https://invictus.ambire.com/base')

  // Wallet with private key
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider)

  const contractName = 'LegendsNFT'
  const contractPath = path.join(
    __dirname,
    `../artifacts/contracts/LegendsNft.sol/${contractName}.json`
  )
  console.log(contractPath)
  const contractData = JSON.parse(fs.readFileSync(contractPath, 'utf8'))

  const contractFactory = new ethers.ContractFactory(
    contractData.abi,
    contractData.bytecode,
    wallet
  )

  const contract = await contractFactory.deploy()

  console.log('Deploying...')

  // Wait for the deployment to be mined
  await contract.deployed()

  console.log(`${contract.address}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
