const { ethers, JsonRpcProvider } = require("ethers")
const AmbireAccount = require("../artifacts/contracts/AmbireAccount.sol/AmbireAccount.json");
require('dotenv').config();

const polygonUrl = 'https://rpc.ankr.com/polygon'
const polygonChainId = 137
const provider = new JsonRpcProvider(polygonUrl)

// This is a deploy script that deploys a proxy AmbireAccount, not the original one.
// this one doesn't have any priviledges, nor can be configured.
// Here's a mined one already: 
async function generateAmbireProxyDeploy (gasPrice) {
	const txn = {}
	const pk = process.env.DEPLOY_PRIVATE_KEY
	const fundWallet = new ethers.Wallet(pk, provider)
	const factory = new ethers.ContractFactory(AmbireAccount.abi, AmbireAccount.bytecode, fundWallet)

	txn.data = await factory.getDeployTransaction()
	txn.from = fundWallet.address
	txn.value = '0x00'
	txn.type = null
	txn.gasLimit = 10000000n
	txn.data = txn.data.data
	txn.gasPrice = gasPrice
	txn.nonce = await provider.getTransactionCount(fundWallet.address)
	txn.chainId = polygonChainId
	return await fundWallet.signTransaction(txn)
}

async function deploy() {

  const feeData = await provider.getFeeData()
  const sig = await generateAmbireProxyDeploy(feeData.gasPrice)
  console.log(sig)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
deploy().catch((error) => {
  console.error(error)
  process.exitCode = 1
});
