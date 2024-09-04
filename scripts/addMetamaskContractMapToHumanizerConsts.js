const fsPromises = require('fs').promises
const path = require('path')
const humanizerInfo = require('../src/consts/humanizer/humanizerInfo.json')

const humanizerInfoPath = path.join(
  __dirname,
  '..',
  'src',
  'consts',
  'humanizer',
  'humanizerInfo.json'
)
fetch('https://raw.githubusercontent.com/MetaMask/contract-metadata/master/contract-map.json')
  .then((r) => r.json())
  .then((mmContractMap) => {
    Object.entries(mmContractMap).forEach(([address, info]) => {
      const alreadyPresentData = humanizerInfo.knownAddresses[address.toLowerCase()]
      humanizerInfo.knownAddresses[address.toLowerCase()] = {
        ...alreadyPresentData,
        address: address.toLowerCase(),
        name: info.name,
        token:
          !info.erc721 && info.symbol && info.decimals
            ? { decimals: info.decimals, symbol: info.symbol }
            : alreadyPresentData?.token,
        isSC: {},
        logo: info.logo
          ? `https://raw.githubusercontent.com/MetaMask/contract-metadata/master/images/${info.logo}`
          : undefined
      }
    })
    return fsPromises.writeFile(humanizerInfoPath, JSON.stringify(humanizerInfo, null, 4), 'utf8')
  })
  .then(() => console.log('ready'))
  .catch(console.log)
