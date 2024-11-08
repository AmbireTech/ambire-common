const fsPromises = require('fs').promises
const path = require('path')
const { isAddress } = require('ethers')
const humanizerInfo = require('../src/consts/humanizer/humanizerInfo.json')

const humanizerInfoPath = path.join(
  __dirname,
  '..',
  'src',
  'consts',
  'humanizer',
  'humanizerInfo.json'
)

// use don't use master, so the data source can only be changed intentionally before running the script
const LATEST_MASTER_COMMIT = 'c5b611324607d87a5fc3315094087962acd45e09'
// fixed for specific release
const githubSourceBaseUrl = `https://raw.githubusercontent.com/MetaMask/contract-metadata/${LATEST_MASTER_COMMIT}`

// Updates Ambire's Humanizer (info) JSON with the Ethereum contract addresses metadata (decimals, symbol, name, logo) pulled from the @metamask/gstacontract-metadata repo.
fetch(`${githubSourceBaseUrl}/contract-map.json`)
  .then((r) => {
    if (!r.ok) throw new Error(`Failed to fetch. Status: ${r.statusText}`)
    return r.json()
  })
  .then((mmContractMap) => {
    if (typeof mmContractMap !== 'object') throw new Error('Wrong data type')
    Object.entries(mmContractMap).forEach(([address, info]) => {
      if (
        !isAddress(address) ||
        (info.decimals && typeof info.decimals !== 'number') ||
        (info.symbol && typeof info.symbol !== 'string') ||
        (info.name && typeof info.name !== 'string') ||
        (info.logo && typeof info.logo !== 'string')
      )
        throw new Error('obj keys is not addresses')
      const alreadyPresentData = humanizerInfo.knownAddresses[address.toLowerCase()]
      humanizerInfo.knownAddresses[address.toLowerCase()] = {
        ...alreadyPresentData,
        address: address.toLowerCase(),
        name: info.name || alreadyPresentData.name,
        token:
          !info.erc721 && info.symbol && info.decimals
            ? { decimals: info.decimals, symbol: info.symbol }
            : alreadyPresentData?.token,
        isSC: {},
        logo: info.logo ? `${githubSourceBaseUrl}/images/${info.logo}` : undefined
      }
    })
    return fsPromises.writeFile(humanizerInfoPath, JSON.stringify(humanizerInfo, null, 4), 'utf8')
  })
  .then(() =>
    console.log(
      `Successfully updated the Humanizer (info) JSON with the checksummed Ethereum contract addresses pulled from the @metamask/contract-metadata repo on ${new Date()}`
    )
  )
  .catch(console.log)
