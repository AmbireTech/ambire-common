const fsPromises = require('fs').promises
const path = require('path')
// eslint-disable-next-line import/no-extraneous-dependencies
const fetch = require('node-fetch')
require('dotenv').config()

const AMBIRE_CONSTANTS_URL = process.env.AMBIRE_CONSTANTS_URL || 'http://localhost:5000'

const humanizerV2ResultPath = path.join(
  __dirname,
  '..',
  'src',
  'consts',
  'humanizer',
  'humanizerInfo.json'
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

const enrichAndParseLegacyConstantsToV2 = async (legacyConstants) => {
  // read files
  const additionalSighashes = await fsPromises
    .readFile(sigHashesSourcePath, 'utf-8')
    .then(JSON.parse)

  const dappAddressList = await fsPromises.readFile(dappNamesSourcePath, 'utf-8').then(JSON.parse)

  // extract from ambire-constatns
  const {
    humanizerInfo: { humanizerV2: result }
  } = legacyConstants

  // add present sighashes and signatures from file
  result.abis.NO_ABI = {}
  const knownSignatures = Object.values(result.abis).reduce((a, b) => ({ ...a, ...b }), {})
  Object.entries(additionalSighashes).forEach(([selector, data]) => {
    if (!knownSignatures[selector]) result.abis.NO_ABI[selector] = data
  })
  // add dapps from address list
  const dappAddressesToAdd = Object.fromEntries(
    Object.values(dappAddressList)
      .map((dappObj) => {
        return Object.entries(dappObj)
      })
      .flat()
      .map(([address, { appName, label }]) => [
        address.toLowerCase(),
        {
          address: address.toLowerCase(),
          name: appName,
          isSC: {}
        }
      ])
  )
  result.knownAddresses = { ...dappAddressesToAdd, ...result.knownAddresses }

  return result
}

const fetchAmbireConstants = async () => {
  const fethcedAmbireConstants = await fetch(`${AMBIRE_CONSTANTS_URL}/result.json`)
    .then((res) => res.json())
    .catch(console.log)

  return fethcedAmbireConstants
}
const main = async () => {
  const initialV2HumanizerMeta = await fsPromises
    .readFile(humanizerV2ResultPath, 'utf-8')
    .then(JSON.parse)

  const fetchedConstants = await fetchAmbireConstants()

  const finalV2HumanizerMeta = await enrichAndParseLegacyConstantsToV2(fetchedConstants)

  // await fsPromises.writeFile(resultPath, JSON.stringify(finalJson, null, 4), 'utf8')
  await fsPromises.writeFile(
    humanizerV2ResultPath,
    JSON.stringify(finalV2HumanizerMeta, null, 4),
    'utf8'
  )

  const updates = {
    'difference-in-abi-count':
      Object.keys(finalV2HumanizerMeta.abis).length -
      Object.keys(initialV2HumanizerMeta.abis).length,
    'difference-in-unknown-sighashes':
      Object.keys(finalV2HumanizerMeta.abis.NO_ABI).length -
      Object.keys(initialV2HumanizerMeta.abis.NO_ABI).length,
    'difference-in-known-addresses':
      Object.keys(finalV2HumanizerMeta.knownAddresses).length -
      Object.keys(initialV2HumanizerMeta.knownAddresses).length
  }
  if (Object.values(updates).find((n) => n < 0)) console.log('SOMETHING WAS DELETED')
  console.log(updates)
}

main()
