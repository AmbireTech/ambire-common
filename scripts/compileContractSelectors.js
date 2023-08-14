/* eslint-disable prettier/prettier */

const fsPromises = require('fs').promises

const fs = require('fs')

const path = require('path')

const directoryPath = path.join(__dirname, '..', 'contracts', 'dappAddressList')
let allAddresses = {}
const getAllData = async (dirPath) => {
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


const main  = async () => {
	const data = await getAllData(directoryPath)
	const writeTo = path.join(__dirname, '..', 'contracts', 'dappAddressList.json')
	await fsPromises.writeFile(writeTo, JSON.stringify(data, null, 4), 'utf8')
}

main()