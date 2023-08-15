/* eslint-disable prettier/prettier */
const ethers = require('ethers')

const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY
// const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY
const fsPromises = require('fs').promises

const fs = require('fs')

const path = require('path')

const infoSourcePath = path.join(__dirname, '..', 'contracts', 'dappAddressList.json')
const dappSelectorsAndNamesPath = path.join(__dirname, '..', 'src', 'consts', 'dappSelectorsAndNames.json')


// used for turingng revoke.cash files to json
// const getAllDataFromFolder = async (dirPath) => {
//   let allAddresses = {}
//   const networkFolders = fs.readdirSync(dirPath)
// 	await Promise.all(networkFolders.map(async (folder)=>{
// 		const files = fs.readdirSync(path.join(dirPath, folder))
// 		await Promise.all(files.map(async (f)=>{
// 			const data = await fsPromises.readFile(path.join(dirPath, folder, f), 'utf8')
// 			allAddresses = { ...allAddresses, [folder]: { ...allAddresses[folder], [f]:JSON.parse(data) } }
// 	}))
// 	}))
//   return allAddresses
// }

const getFnName = (f)=>{
	const args = f.inputs.map(i=>i.type).join(',')
	return `${f.name}(${args})`
}

const getContractInterfaces = async (addresses) => {
	const provider = new ethers.EtherscanProvider( ETHERSCAN_API_KEY )
	return (await Promise.all(addresses.map((a)=>provider.getContract(a)))).filter(i=>i).map(rc=>rc.interface)
}

const main  = async () => {
	// taking addresses from json only for mainnet
	const initialJson = JSON.parse(await fsPromises.readFile(infoSourcePath, 'utf8'))
	const addressListJson = initialJson?.['1']
	const addressList = Object.keys(addressListJson).map(a=>a.slice(0, 42))
	// takes interfaces
	const interfaces = await getContractInterfaces(addressList)
	const entries = []
	const entries2 = []
	interfaces.forEach((i)=>{
		i.fragments.forEach((f)=>{
			if (f.type === 'function') entries.push([`funcSelectors:${f.selector}`, getFnName(f)])
			if (f.type === 'error') entries.push([`errorSelectors:${f.selector}`, getFnName(f)])
		})
	})
	Object.keys(initialJson).forEach(n=>Object.keys(initialJson[n]).forEach((a)=>entries2.push([a.slice(0, 42), initialJson[n][a].appName])))
	const fetchedSelectors = Object.fromEntries(entries)
	const namesData = Object.fromEntries(entries2)
	const storedData = JSON.parse(await fsPromises.readFile(dappSelectorsAndNamesPath, 'utf8'))
	const toSave = { ...storedData, ...fetchedSelectors, ...namesData }
	await fsPromises.writeFile(dappSelectorsAndNamesPath, JSON.stringify(toSave, null, 4), 'utf8')
	// @TODO finish script
}

main()