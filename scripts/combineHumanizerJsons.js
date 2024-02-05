const ethers = require('ethers')
const fsPromises = require('fs').promises
const path = require('path')
// eslint-disable-next-line import/no-extraneous-dependencies
const fetch = require('node-fetch')
require('dotenv').config()

const AMBIRE_CONSTANTS_URL = process.env.AMBIRE_CONSTANTS_URL || 'http://localhost:5000'
// const AMBIRE_CONSTANTS_URL = 'http://localhost:5000'

const humanizerV2ResultPath = path.join(__dirname, '..', 'src', 'consts', 'humanizerInfo.json')
const humanizerLagacyResultPath = path.join(
  __dirname,
  '..',
  'src',
  'consts',
  'ambireConstants.json'
)

// @TODO: rename dappSelectors.json file name
const sigHashesSourcePath = path.join(
  __dirname,
  '..',
  'src',
  'consts',
  'humanizer',
  'dappSelectors.json'
)
const dappNamesSourcePath = path.join(
  __dirname,
  '..',
  'src',
  'consts',
  'humanizer',
  'dappAddressList.json'
)

function parseToV2HumanizerMeta(humanizerMeta) {
  const { humanizerInfo } = humanizerMeta
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

const readExtraStoredData = async () => {
  const funcAndErrSigHashes = await fsPromises
    .readFile(sigHashesSourcePath, 'utf-8')
    .then(JSON.parse)
  const dappNames = await fsPromises.readFile(dappNamesSourcePath, 'utf-8').then(JSON.parse)

  const res = { ...funcAndErrSigHashes }

  Object.entries(dappNames[1]).forEach(([address, values]) => {
    res[`names:${address}`] = values.appName
  })
  return res
}

const fetchAmbireConstants = async () => {
  const fethcedAmbireConstants = await fetch(`${AMBIRE_CONSTANTS_URL}/result.json`)
    .then((res) => res.json())
    .catch(console.log)
  const storedAmbireConstants = await fsPromises
    .readFile(humanizerLagacyResultPath, 'utf-8')
    .then(JSON.parse)
    .catch(console.log)
  if (fethcedAmbireConstants) {
    await fsPromises
      .writeFile(humanizerLagacyResultPath, JSON.stringify(fethcedAmbireConstants), 'utf8')
      .then(() => console.log('stored fetched ambire-constants'))
      .catch((e) => console.log(`failed to store fetched ambire-constants, ${e}`))
  }
  return fethcedAmbireConstants || storedAmbireConstants
}
const main = async () => {
  const initialV2HumanizerMeta = await fsPromises
    .readFile(humanizerV2ResultPath, 'utf-8')
    .then(JSON.parse)

  const fetchedConstants = await fetchAmbireConstants()

  const parsedAmbireConstants = parseToV2HumanizerMeta(fetchedConstants)

  const extraStoredData = await readExtraStoredData()

  const finalV2HumanizerMeta = { ...extraStoredData, ...parsedAmbireConstants }
  // await fsPromises.writeFile(resultPath, JSON.stringify(finalJson, null, 4), 'utf8')
  await fsPromises.writeFile(humanizerV2ResultPath, JSON.stringify(finalV2HumanizerMeta), 'utf8')

  // console.log(JSON.stringify(finalJson, null, 4))
  console.log(
    `Old file had ${Object.keys(initialV2HumanizerMeta).length} keys, the new object has ${
      Object.keys(finalV2HumanizerMeta).length
    } keys. Res written to ${humanizerV2ResultPath}`
  )
}

main()
