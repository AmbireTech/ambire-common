/* eslint-disable prettier/prettier */
const ethers = require('ethers')

const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY
// const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY
const fsPromises = require('fs').promises

const fs = require('fs')

const path = require('path')

const directoryPath = path.join(__dirname, '..', 'contracts', 'dappAddressList')
let allAddresses = {}


const getAllDataFromFolder = async (dirPath) => {
  const networkFolders = fs.readdirSync(dirPath)
	await Promise.all(networkFolders.map(async (folder)=>{
		const files = fs.readdirSync(path.join(dirPath, folder))
		await Promise.all(files.map(async (f)=>{
			const data = await fsPromises.readFile(path.join(dirPath, folder, f), 'utf8')
			allAddresses = { ...allAddresses, [folder]: { ...allAddresses[folder], [f]:JSON.parse(data) } }
	}))
	}))
  return allAddresses
}

const getFnName = (f)=>{
	const args = f.inputs.map(i=>i.type).join(',')
	return `${f.name}(${args})`
}
const main  = async () => {
	const abiPath = path.join(__dirname, '..', 'contracts', 'dappAbiList.json')
	const selectorsPath = path.join(__dirname, '..', 'src', 'consts', 'dappSelectors.json')
	const abis = JSON.parse(await fsPromises.readFile(abiPath, 'utf-8'))
	const interfaces = Object.keys(abis).map((address) => {
		try {

			const iface = new ethers.Interface(abis[address])
			// console.log(iface)
			return iface
		} catch (e){
			return null
		}
		// return abis[address].filter(i=>i.type === 'function')
	}).filter((i)=>i)
	const entries = []
	interfaces.forEach((i)=>{
		i.fragments.forEach((f)=>{
			if (f.type === 'function') entries.push([`funcSelectors:${f.selector}`, getFnName(f)])
			if (f.type === 'error') entries.push([`errorSelectors:${f.selector}`, getFnName(f)])
		})
	})
	const res = Object.fromEntries(entries)
	await fsPromises.writeFile(selectorsPath, JSON.stringify(res, null, 4), 'utf8')
	// console.log(Object.keys(abis).length)
	// console.log(interfaces[0].fragments[0].selector)
	// console.log(interfaces[0].fragments[0])
	// console.log(interfaces[0].fragments[interfaces[0].fragments.length - 1])
	// @TODO convert abi's function to selectors
}

main()