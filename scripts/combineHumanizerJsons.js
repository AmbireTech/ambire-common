/* eslint-disable no-console */
/* eslint-disable prettier/prettier */

const ethers = require('ethers')
const fsPromises = require('fs').promises
const path = require('path')
// eslint-disable-next-line import/no-extraneous-dependencies
const fetch = require('node-fetch')
require('dotenv').config()

const AMBIRE_CONSTANTS_URL = process.env.AMBIRE_CONSTANTS_URL || 'http://localhost:5000'

const resultPath = path.join(__dirname, '..', 'src', 'consts', 'humanizerInfo.json')
const sigHashesFile = path.join(__dirname, '..', 'src', 'consts', 'dappSelectors.json')

async function initHumanizerMeta(humanizerMeta) {
	const funcAndErrSigHashes = await fsPromises.readFile(sigHashesFile, 'utf-8').then(JSON.parse)

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

	// Object.keys(humanizerMeta?.errorSelectors).forEach((k) => {
	// 	newHumanizerMeta[`errorSelectors:${k}`] = humanizerMeta.errorSelectors?.[k]
	// })

	// Object.keys(humanizerMeta?.funcSelectors).forEach((k) => {
	// 	newHumanizerMeta[`funcSelectors:${k}`] = humanizerMeta.funcSelectors?.[k]
	// })

	return {
	  ...newHumanizerMeta,
	  yearnVaults: humanizerMeta.yearnVaults,
	  ...funcAndErrSigHashes
	}
  }

const main = async () => {
	const oldFileConstants = await fsPromises.readFile(resultPath, 'utf-8').then(JSON.parse)
	console.log(Object.keys(oldFileConstants).length)
	let newAmbirConstants = await (fetch(`${AMBIRE_CONSTANTS_URL}/result.json`).then(r=>r.json()).then(r=>r.humanizerInfo).then(initHumanizerMeta)).catch(e=>{console.log(`Error: ${e.message}`)})
	if (!newAmbirConstants) {
		console.log('Error with reaching ambire-constants, old file wil be used')
		newAmbirConstants = oldFileConstants
	}

	newAmbirConstants
	await fsPromises.writeFile(resultPath, JSON.stringify(newAmbirConstants, null, 4), 'utf8')
	console.log(`Old file had ${Object.keys(oldFileConstants).length} keys, the new object has ${Object.keys(newAmbirConstants).length} keys. Res written to ${resultPath}`)
}


main()