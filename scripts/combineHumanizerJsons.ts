/* eslint-disable no-continue */
/* eslint-disable no-param-reassign */
import { id, Interface } from 'ethers'
import { HumanizerMeta } from 'libs/humanizer/interfaces'

const fsPromises = require('fs').promises
const path = require('path')
// eslint-disable-next-line import/no-extraneous-dependencies
const fetch = require('node-fetch')
require('dotenv').config()

const additionalSighashes: Sighashes = require('../src/consts/humanizer/dappSelectors.json')
const dappAddressList: DappAddrList = require('../src/consts/humanizer/dappAddressList.json')

const AMBIRE_CONSTANTS_URL = 'https://jason.ambire.com/result.json'
const CENA_TOKENS_URL = 'https://cena.ambire.com/api/v3/lists/top-tokens-info'
const humanizerV2ResultPath = path.join(
  __dirname,
  '..',
  'src',
  'consts',
  'humanizer',
  'humanizerInfo.json'
)

interface AmbireConstants {
  tokenList: { [network: string]: { address: string; symbol: string; decimals: number }[] }
  humanizerInfo: {
    abis: { [contractName: string]: any[] }
    tokens: { [address: string]: [string, number] }
    names: { [address: string]: string }
  }
}
interface CenaTokens {
  [network: string]: { [address: string]: string }
}
interface Sighashes {
  [selector: string]: {
    type: 'error' | 'function' | 'event'
    signature: string
    selector: string
  }
}
interface DappAddrList {
  [chainId: string]: {
    [address: string]: { appName: string; label: string }
  }
}

function integrateAmbireConstants(
  initialJson: HumanizerMeta,
  ambireConstants: AmbireConstants
): HumanizerMeta {
  Object.entries(ambireConstants.humanizerInfo.tokens).forEach(([address, [symbol, decimals]]) => {
    let addrInfo = initialJson.knownAddresses[address]
    if (!addrInfo) addrInfo = {}
    if (!addrInfo.token) addrInfo.token = { symbol, decimals }
    addrInfo.isSC = true
    initialJson.knownAddresses[address] = addrInfo
  })
  Object.entries(ambireConstants.tokenList).forEach(([networkId, tokens]) => {
    const networksChainIdMapping: { [n: string]: number } = {
      ethereum: 1,
      base: 8453,
      optimism: 10,
      'binance-smart-chain': 56,
      scroll: 534352,
      arbitrum: 42161,
      avalanche: 43114,
      gnosis: 100
    }
    const chainId = networksChainIdMapping[networkId]
    if (!chainId) return
    tokens.forEach(({ address, symbol, decimals }) => {
      let addrInfo = initialJson.knownAddresses[address]
      if (!addrInfo) addrInfo = {}
      if (!addrInfo.token) addrInfo.token = { symbol, decimals }
      if (!addrInfo.chainIds) addrInfo.chainIds = []
      const arr = addrInfo.chainIds
      addrInfo.chainIds = [...new Set([...arr, Number(chainId)])]
      initialJson.knownAddresses[address] = addrInfo
    })
  })
  Object.entries(ambireConstants.humanizerInfo.names).forEach(([address, name]) => {
    if (!initialJson.knownAddresses[address]) initialJson.knownAddresses[address] = {}
    initialJson.knownAddresses[address].name = name
  })

  // eslint-disable-next-line no-restricted-syntax
  for (const abi of Object.values(ambireConstants.humanizerInfo.abis)) {
    const iface = new Interface(abi)
    // eslint-disable-next-line no-restricted-syntax
    for (const f of iface.fragments) {
      const type = f.type
      if (type === 'constructor') continue
      if (type === 'fallback') continue
      if (type === 'struct') continue
      const selector = id(f.format('sighash')).slice(0, 10)
      const signature = f.format('minimal')
      initialJson.abis.NO_ABI[selector] = { selector, signature, type }
    }
  }
  return initialJson
}

function integrateAmbireCena(initialJson: HumanizerMeta, cenaTokens: CenaTokens): HumanizerMeta {
  Object.entries(cenaTokens).forEach(([chainId, tokens]) => {
    Object.entries(tokens).forEach(([address, symbol]) => {
      let addrInfo = initialJson.knownAddresses[address]
      if (!addrInfo) addrInfo = {}
      if (!addrInfo.token) addrInfo.token = { symbol }
      if (!addrInfo.chainIds) addrInfo.chainIds = []
      const arr = addrInfo.chainIds
      addrInfo.chainIds = [...new Set([...arr, Number(chainId)])]
      addrInfo.isSC = true

      initialJson.knownAddresses[address] = addrInfo
    })
  })
  return initialJson
}

function integrateAdditionalSigHashes(
  initialJson: HumanizerMeta,
  sighashes: Sighashes
): HumanizerMeta {
  initialJson.abis.NO_ABI = { ...initialJson.abis.NO_ABI, ...sighashes }
  return initialJson
}

function integrateDappAddrList(
  initialJson: HumanizerMeta,
  dappAddrList: DappAddrList
): HumanizerMeta {
  Object.entries(dappAddrList).forEach(([chainId, contracts]) => {
    Object.entries(contracts).forEach(([address, { appName }]) => {
      let addrInfo = initialJson.knownAddresses[address]
      if (!addrInfo) addrInfo = {}
      addrInfo.name = appName
      if (!addrInfo.chainIds) addrInfo.chainIds = []
      const arr = addrInfo.chainIds
      addrInfo.chainIds = [...new Set([...arr, Number(chainId)])]
      addrInfo.isSC = true
      initialJson.knownAddresses[address] = addrInfo
    })
  })
  return initialJson
}

const fetchAmbireConstants = async (): Promise<AmbireConstants> => {
  const fetchedAmbireConstants = await fetch(AMBIRE_CONSTANTS_URL)
    .then((res: any) => res.json())
    .catch(console.log)

  return fetchedAmbireConstants
}
const fetchAmbireCenaTokens = async (): Promise<CenaTokens> => {
  const fetchedAmbireCenaTokens = await fetch(CENA_TOKENS_URL)
    .then((res: any) => res.json())
    .catch(console.log)

  return fetchedAmbireCenaTokens
}
const main = async () => {
  let initialV2HumanizerMeta: HumanizerMeta = await fsPromises
    .readFile(humanizerV2ResultPath, 'utf-8')
    .then((r: string) => JSON.parse(r || '{}'))

  if (!initialV2HumanizerMeta) initialV2HumanizerMeta = { abis: { NO_ABI: {} }, knownAddresses: {} }
  if (!initialV2HumanizerMeta.abis) initialV2HumanizerMeta.abis = { NO_ABI: {} }
  if (!initialV2HumanizerMeta.abis.NO_ABI) initialV2HumanizerMeta.abis.NO_ABI = {}
  if (!initialV2HumanizerMeta.knownAddresses) initialV2HumanizerMeta.knownAddresses = {}

  const fetchedAmbireConstants = await fetchAmbireConstants()
  const fetchedAmbireCenaTokens = await fetchAmbireCenaTokens()

  let finalV2HumanizerMeta: HumanizerMeta = JSON.parse(JSON.stringify(initialV2HumanizerMeta))
  finalV2HumanizerMeta = integrateAmbireConstants(finalV2HumanizerMeta, fetchedAmbireConstants)
  finalV2HumanizerMeta = integrateAmbireCena(finalV2HumanizerMeta, fetchedAmbireCenaTokens)
  finalV2HumanizerMeta = integrateAdditionalSigHashes(finalV2HumanizerMeta, additionalSighashes)
  finalV2HumanizerMeta = integrateDappAddrList(finalV2HumanizerMeta, dappAddressList)

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
