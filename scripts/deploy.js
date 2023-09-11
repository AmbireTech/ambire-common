const { ethers, JsonRpcProvider } = require("ethers")
const AmbireAccount = require("../contracts/compiled/AmbireAccount.json");
const AmbireAccountFactory = require("../contracts/compiled/AmbireAccountFactory.json");
require('dotenv').config();

const optimismUrl = 'https://rpc.ankr.com/optimism'
const optimismChainId = 10
const provider = new JsonRpcProvider(optimismUrl)

// This is a deploy script that deploys a proxy AmbireAccount, not the original one.
// this one doesn't have any priviledges, nor can be configured.
// You can get a mined one in deploy.ts (PROXY_AMBIRE_ACCOUNT)
async function generateAmbireProxyDeploy (gasPrice) {
	const txn = {}
	const pk = process.env.DEPLOY_PRIVATE_KEY
	const fundWallet = new ethers.Wallet(pk, provider)
	const factory = new ethers.ContractFactory(AmbireAccount.abi, AmbireAccount.bin, fundWallet)

	txn.data = await factory.getDeployTransaction()
	txn.from = fundWallet.address
	txn.value = '0x00'
	txn.type = null
	txn.gasLimit = 10000000n
	txn.data = txn.data.data
	txn.gasPrice = gasPrice
	txn.nonce = await provider.getTransactionCount(fundWallet.address)
	txn.chainId = optimismChainId
	return await fundWallet.signTransaction(txn)
}

async function generateDeployAndExecute (gasPrice) {
	const txn = {}
	const pk = process.env.DEPLOY_PRIVATE_KEY
	const fundWallet = new ethers.Wallet(pk, provider)
	const factory = new ethers.ContractFactory(AmbireAccount.abi, AmbireAccount.bin, fundWallet)

	txn.data = await factory.getDeployTransaction()
	txn.from = fundWallet.address
	txn.value = '0x00'
	txn.type = null
	txn.gasLimit = 10000000n
	txn.data = txn.data.data
	txn.gasPrice = gasPrice
	txn.nonce = await provider.getTransactionCount(fundWallet.address)
	txn.chainId = optimismChainId
	return await fundWallet.signTransaction(txn)
}

async function generateFactory (gasPrice) {
	const txn = {}
	const pk = process.env.DEPLOY_PRIVATE_KEY
	const fundWallet = new ethers.Wallet(pk, provider)
	const factory = new ethers.ContractFactory(AmbireAccountFactory.abi, AmbireAccountFactory.bin, fundWallet)

	txn.data = await factory.getDeployTransaction(ethers.computeAddress(pk))
	txn.from = fundWallet.address
	txn.value = '0x00'
	txn.type = null
	txn.gasLimit = 10000000n
	txn.data = txn.data.data
	txn.gasPrice = gasPrice
	txn.nonce = await provider.getTransactionCount(fundWallet.address)
	txn.chainId = optimismChainId
	return await fundWallet.signTransaction(txn)
}

async function generateManager (gasPrice) {
	const txn = {}
	const pk = process.env.DEPLOY_PRIVATE_KEY
	const fundWallet = new ethers.Wallet(pk, provider)
	const factory = new ethers.ContractFactory(erc4337Manager.abi, erc4337Manager.bytecode, fundWallet)

	txn.data = await factory.getDeployTransaction()
	txn.from = fundWallet.address
	txn.value = '0x00'
	txn.type = null
	txn.gasLimit = 10000000n
	txn.data = txn.data.data
	txn.gasPrice = gasPrice
	txn.nonce = await provider.getTransactionCount(fundWallet.address)
	txn.chainId = optimismChainId
	return await fundWallet.signTransaction(txn)
}

async function setFallbackHandler(gasPrice) {
	const pk = process.env.SIGNER_PRIV_KEY
	const fundWallet = new ethers.Wallet(pk, provider)
	const AMBIRE_ACCOUNT_ADDR = '0xD1cE5E6AE56693D2D3D52b2EBDf969C1D7901971'
	const ERC_4337_MANAGER = '0xba9b9B22aBf1b088c22967f01947236d723432c9'
	const ambireAccount = new ethers.Contract(AMBIRE_ACCOUNT_ADDR, AmbireAccount.abi, fundWallet)

	const setAddrPrivilegeABI = ['function setAddrPrivilege(address addr, bytes32 priv)']
	const iface = new ethers.Interface(setAddrPrivilegeABI)
	const calldata = iface.encodeFunctionData('setAddrPrivilege', [
		ethers.toBeHex(0x6969, 20),
		ethers.toBeHex(ERC_4337_MANAGER, 32)
	])
	const setPrivTxn = [AMBIRE_ACCOUNT_ADDR, 0, calldata]
	const data = await ambireAccount.interface.encodeFunctionData('executeBySender', [[setPrivTxn]])
	const txn = await fundWallet.sendTransaction({
		to: AMBIRE_ACCOUNT_ADDR,
		value: 0,
		data: data,
		gasPrice: gasPrice,
		gasLimit: 100000n
	})
	return txn
}

async function deploy() {

  const feeData = await provider.getFeeData()
  const sig = await generateFactory(feeData.gasPrice)
  console.log(sig)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
deploy().catch((error) => {
  console.error(error)
  process.exitCode = 1
});
