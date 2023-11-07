const ethers = require('ethers')
const fsPromises = require('fs').promises
const path = require('path')
// eslint-disable-next-line import/no-extraneous-dependencies
const fetch = require('node-fetch')
require('dotenv').config()

const AMBIRE_CONSTANTS_URL = process.env.AMBIRE_CONSTANTS_URL || 'http://localhost:5000'

const resultPath = path.join(__dirname, '..', 'src', 'consts', 'humanizerInfo.json')
const storedAmbireConstantsPath = path.join(
  __dirname,
  '..',
  'src',
  'consts',
  'ambireConstants.json'
)

// @TODO: rename dappSelectors.json file name
const sigHashesPath = path.join(__dirname, '..', 'src', 'consts', 'dappSelectors.json')
const dappNamesPath = path.join(__dirname, '..', 'src', 'consts', 'dappAddressList.json')

function initHumanizerMeta(humanizerMeta) {
  const humanizerInfo = humanizerMeta.humanizerInfo
  const newHumanizerMeta = {}
  Object.keys(humanizerInfo?.tokens).forEach((k2) => {
    newHumanizerMeta[`tokens:${ethers.getAddress(k2)}`] = humanizerInfo.tokens?.[k2]
  })

  Object.keys(humanizerInfo?.abis).forEach((k2) => {
    newHumanizerMeta[`abis:${k2}`] = humanizerInfo.abis?.[k2]
  })

  Object.keys(humanizerInfo?.names).forEach((k2) => {
    newHumanizerMeta[`names:${ethers.getAddress(k2)}`] = humanizerInfo.names?.[k2]
  })

  return {
    ...newHumanizerMeta,
    yearnVaults: humanizerInfo.yearnVaults
  }
}

const addExtraStoredData = async () => {
  const funcAndErrSigHashes = await fsPromises.readFile(sigHashesPath, 'utf-8').then(JSON.parse)
  const dappNames = await fsPromises.readFile(dappNamesPath, 'utf-8').then(JSON.parse)

  const res = { ...funcAndErrSigHashes }

  Object.entries(dappNames[1]).forEach(([address, values]) => {
    res[`names:${address}`] = values.appName
  })
  return res
}

const getAmbireConstants = async () => {
  const fethcedAmbireConstants = await fetch(`${AMBIRE_CONSTANTS_URL}/result.json`)
    .then((res) => res.json())
    .catch(console.log)
  const storedAmbireConstants = await fsPromises
    .readFile(storedAmbireConstantsPath, 'utf-8')
    .then(JSON.parse)
    .catch(console.log)
  if (fethcedAmbireConstants) {
    await fsPromises
      .writeFile(storedAmbireConstantsPath, JSON.stringify(fethcedAmbireConstants, null, 4), 'utf8')
      .then(() => console.log('stored fetched ambire-constants'))
      .catch((e) => console.log(`failed to store fetched ambire-constants, ${e}`))
  }
  return fethcedAmbireConstants || storedAmbireConstants
}
const main = async () => {
  const oldHumanizerMeta = await fsPromises.readFile(resultPath, 'utf-8').then(JSON.parse)

  const ambireConstants = await getAmbireConstants()
  const parsedAmbireConstants = initHumanizerMeta(ambireConstants)
  const extraStoredData = await addExtraStoredData()
  const finalJson = { ...extraStoredData, ...parsedAmbireConstants }
  // await fsPromises.writeFile(resultPath, JSON.stringify(finalJson, null, 4), 'utf8')
  await fsPromises.writeFile(resultPath, JSON.stringify(finalJson, null, 4), 'utf8')

  // console.log(JSON.stringify(finalJson, null, 4))
  console.log(
    `Old file had ${Object.keys(oldHumanizerMeta).length} keys, the new object has ${
      Object.keys(finalJson).length
    } keys. Res written to ${resultPath}`
  )
}

main()
