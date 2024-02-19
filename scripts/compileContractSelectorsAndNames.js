/* eslint-disable no-console */
/* eslint-disable prettier/prettier */
require('dotenv').config()

const ethers = require('ethers')

const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY
// const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY
const fsPromises = require('fs').promises

const path = require('path')

const infoSourcePath = path.join(__dirname, '..', 'src', 'consts', 'dappAddressList.json')
const dappSelectorsPath = path.join(__dirname, '..', 'src', 'consts', 'dappSelectors.json')
const dappNamesPath = path.join(__dirname, '..', 'src', 'consts', 'dappNames.json')
const ambireConstantsPath = path.join(__dirname, '..', 'src', 'consts', 'ambireConstants.json')


// used for turingng revoke.cash files to json
// const getAllDataFromFolder = async (dirPath) => {
//   let allAddresses = {}
//   const networkFolders = fs.readdirSync(dirPath)
// 	await Promise.all(networkFolders.map(async (folder)=>{
// 		const files = fs.readdirSync(path.join(dirPath, folder))
// 		await Promise.all(files.map(async (f)=>{
// 			const data = await fsPromises.readFile(path.join(dirPath, folder, f), 'utf8')
// 			allAddresses = { ...allAddresses, [folder]: { ...allAddresses[folder], [f.slice(0, 42)]:JSON.parse(data) } }
// 	}))
// 	}))
//   return allAddresses
// }

const getFnName = (f)=>{
	// @TODO add inputs names, not only types
	const args = f.inputs.map(i=>i.type).join(',')
	return `${f.name}(${args})`
}

const getContractInterfaces = async (addresses) => {
	const provider = new ethers.EtherscanProvider( 'mainnet', ETHERSCAN_API_KEY )
	const res = (await Promise.all(addresses.map((a)=>provider.getContract(a)))).filter(i=>i).map(rc=>rc.interface)
	console.log(`Fetched abis from ${res.length}/${addresses.length} contracts`)
	if (!ETHERSCAN_API_KEY) console.log('!!! No etherscan key provided, add for more contract abis !!!')
	return res
}

const main  = async () => {
	if (!ETHERSCAN_API_KEY) throw Error('NO ETHERSCAN_API_KEY')
	// taking addresses from json only for mainnet
	const initialJson = JSON.parse(await fsPromises.readFile(infoSourcePath, 'utf8'))
	const ambireConstants = JSON.parse(await fsPromises.readFile(ambireConstantsPath, 'utf8'))
	const addressListJson = initialJson?.['1']
	const addressList = Object.keys(addressListJson)
	// takes interfaces
	const interfaces = await getContractInterfaces(addressList)
	const funcAndErrSelectorEntries = []
	const nameEntries = []

	// get selctors from ambireConstants abis
	Object.values(ambireConstants.humanizerInfo.abis).forEach((abi)=>{
		abi.forEach((f)=>{

			let name; let  selector
			if (f.type === 'function' || f.type === 'error') {
				name =  getFnName(f)
				selector = ethers.keccak256(ethers.toUtf8Bytes(getFnName(f))).slice(10)
			}
			if (f.type === 'function') funcAndErrSelectorEntries.push([`funcSelectors:${selector}`, name])
			if (f.type === 'error') funcAndErrSelectorEntries.push([`errorSelectors:${selector}`, name])
		})
	})

	// get seledctors from fetched abis
	interfaces.forEach((i)=>{
		i.fragments.forEach((f)=>{
			if (f.type === 'function') funcAndErrSelectorEntries.push([`funcSelectors:${f.selector}`, getFnName(f)])
			if (f.type === 'error') funcAndErrSelectorEntries.push([`errorSelectors:${f.selector}`, getFnName(f)])
		})
	})

	// get all contract names
	Object.keys(initialJson).forEach(n=>Object.keys(initialJson[n]).forEach((a)=>nameEntries.push([`names:${a}`, initialJson[n][a].appName])))
	const fetchedSelectors = Object.fromEntries(funcAndErrSelectorEntries)
	const namesData = Object.fromEntries(nameEntries)

	const storeNamesdData = JSON.parse(await fsPromises.readFile(dappNamesPath, 'utf8') || '{}') 
	const storedSelectorsData = JSON.parse(await fsPromises.readFile(dappSelectorsPath, 'utf8') || '{}')
	await fsPromises.writeFile(dappNamesPath, JSON.stringify({ ...storeNamesdData, ...namesData }, null, 4), 'utf8')
	await fsPromises.writeFile(dappSelectorsPath, JSON.stringify({ ...storedSelectorsData, ...fetchedSelectors }, null, 4), 'utf8')
}

main()