/* eslint-disable no-console */
/* eslint-disable prettier/prettier */

const ethers = require('ethers')
const fsPromises = require('fs').promises
const path = require('path')

function initHumanizerMeta(humanizerMeta) {
	const newHumanizerMeta = {}
  
	Object.keys(humanizerMeta?.tokens).forEach((k2) => {
	  newHumanizerMeta[`tokens:${ethers.getAddress(k2)}`] = humanizerMeta.tokens?.[k2]
	})
	Object.keys(humanizerMeta?.abis).forEach((k2) => {
	  newHumanizerMeta[`abis:${k2}`] = humanizerMeta.abis?.[k2]
	})
  
	Object.keys(humanizerMeta?.names).forEach((k2) => {
	  newHumanizerMeta[`names:${ethers.getAddress(k2)}`] = humanizerMeta.names?.[k2]
	})
  
	return {
	  ...newHumanizerMeta,
	  yearnVaults: humanizerMeta.yearnVaults,
	  tesseractVaults: humanizerMeta.yearnVaults
	}
  }
const dappSelectorsPath = path.join(__dirname, '..', 'src', 'consts', 'dappSelectors.json')
const dappNamesPath = path.join(__dirname, '..', 'src', 'consts', 'dappNames.json')
const ambireConstants = path.join(__dirname, '..', 'src', 'consts', 'ambireConstantsHumanizerInfo.json')
const resultPath = path.join(__dirname, '..', 'src', 'consts', 'humanizerInfo.json')


const main = async () => {
	const prepedJsons = await Promise.all([
		fsPromises.readFile(dappSelectorsPath, 'utf8').then(JSON.parse),
		fsPromises.readFile(dappNamesPath, 'utf8').then(JSON.parse),
		fsPromises.readFile(ambireConstants, 'utf8').then(JSON.parse).then(initHumanizerMeta)
	])
	const res = prepedJsons.reduce((a, b)=>({ ...a, ...b }), {})
	await fsPromises.writeFile(resultPath, JSON.stringify(res, null, 4), 'utf8')
	console.log(`Initial objects had ${prepedJsons.map(p=>Object.keys(p).length)} keys, the final object has${Object.keys(res).length} keys. Res written to ${resultPath}`)
}


main()