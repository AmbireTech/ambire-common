import fetch from 'node-fetch'

import { describe } from '@jest/globals'

import { velcroUrl } from '../../../test/config'
import { networks } from '../../consts/networks'
import { getRpcProvider } from '../../services/provider'
import { formatExternalHintsAPIResponse, mergeERC721s } from './helpers'
import { ERC721s, ExternalHintsAPIResponse } from './interfaces'
import { Portfolio } from './portfolio'

const ethereum = networks.find((x) => x.chainId === 1n)
const polygon = networks.find((x) => x.chainId === 137n)

if (!ethereum || !polygon) throw new Error('Failed to find ethereum in networks')

const provider = getRpcProvider(ethereum.rpcUrls, ethereum.chainId)

const ethPortfolio = new Portfolio(fetch, provider, ethereum, velcroUrl)

const TEST_ACCOUNT_ADDRESS = '0xc4A6bB5139123bD6ba0CF387828a9A3a73EF8D1e'
const LEARNED_TOKEN_WITH_BALANCE_ADDRESS = '0x335F4e66B9B61CEE5CeaDE4e727FCEC20156B2F0'

const getTokens = async () => {
  const ethAccPortfolio = await ethPortfolio.get(TEST_ACCOUNT_ADDRESS, {
    additionalErc20Hints: [LEARNED_TOKEN_WITH_BALANCE_ADDRESS]
  })

  return ethAccPortfolio.tokens
}

describe('Portfolio helpers', () => {
  it('mergeERC721s', () => {
    const arrayOfHints: ERC721s[] = [
      {
        '0x026224A2940bFE258D0dbE947919B62fE321F042': [1n, 2n]
      },
      {
        '0x35bAc15f98Fa2F496FCb84e269d8d0a408442272': [5n],
        '0x026224A2940bFE258D0dbE947919B62fE321F042': [2n, 5n]
      }
    ]
    const merged = mergeERC721s(arrayOfHints)

    expect(Object.keys(merged).length).toBe(2)
    expect(merged['0x026224A2940bFE258D0dbE947919B62fE321F042']).toEqual([1n, 2n, 5n])
    expect(merged['0x026224A2940bFE258D0dbE947919B62fE321F042'].length).toBe(3)
    expect(merged['0x35bAc15f98Fa2F496FCb84e269d8d0a408442272']).toEqual([5n])
    expect(merged['0x35bAc15f98Fa2F496FCb84e269d8d0a408442272'].length).toBe(1)
  })
  it('formatExternalHintsAPIResponse', () => {
    const raw: ExternalHintsAPIResponse = {
      networkId: 'ethereum',
      chainId: 1,
      accountAddr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      erc20s: [
        '0x0000000000000000000000000000000000000000',
        '0x45804880De22913dAFE09f4980848ECE6EcbAf78',
        '0x47Cd7E91C3CBaAF266369fe8518345fc4FC12935',
        '0x4da27a545c0c5B758a6BA100e3a049001de870f5',
        '0x6B175474E89094C44Da98b954EedeAC495271d0F',
        '0x88800092fF476844f74dC2FC427974BBee2794Ae',
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0xADE00C28244d5CE17D72E40330B1c318cD12B7c3',
        '0xB6456b57f03352bE48Bf101B46c1752a0813491a',
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        '0xba100000625a3754423978a60c9317c58a424e3D',
        '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        '0xe575cc6ec0b5d176127ac61ad2d3d9d19d1aa4a0',
        '0x1abaea1f7c830bd89acc67ec4af516284b1bc33c',
        '0x514910771af9ca656af840dff83e8264ecf986ca',
        '0x40d16fc0246ad3160ccc09b8d0d3a2cd28ae6c2f',
        '0xae78736cd615f374d3085123a210448e74fc6393',
        '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
        '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
        '0x4Fabb145d64652a948d72533023f6E7A623C7C53',
        '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
        '0x028171bCA77440897B824Ca71D1c56caC55b68A3',
        '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
        '0xBcca60bB61934080951369a648Fb03DF4F96263C',
        '0x3Ed3B47Dd13EC9a98b44e6204A523E766B225811',
        '0x9ff58f4fFB29fA2266Ab25e75e2A8b3503311656',
        '0x030bA81f1c18d280636F32af80b9AAd02Cf0854e'
      ],
      erc721s: {
        '0x35bAc15f98Fa2F496FCb84e269d8d0a408442272': { isKnown: false, enumerable: true },
        '0x026224A2940bFE258D0dbE947919B62fE321F042': { isKnown: false, tokens: ['2162', '2647'] }
      },
      prices: {},
      hasHints: true,
      lastUpdate: Date.now()
    }

    const formatted = formatExternalHintsAPIResponse(raw)!

    expect(formatted).not.toBeNull()
    expect('prices' in formatted).toBeFalsy()
    expect('networkId' in formatted).toBeFalsy()
    expect('chainId' in formatted).toBeFalsy()
    expect('accountAddr' in formatted).toBeFalsy()

    expect(formatted.erc20s.length).toBe(raw.erc20s.length)
    expect(Object.keys(formatted.erc721s).length).toBe(Object.keys(raw.erc721s).length)
    expect(formatted.lastUpdate).toBe(raw.lastUpdate)
    expect(formatted.hasHints).toBe(raw.hasHints)

    expect(formatted.erc721s['0x35bAc15f98Fa2F496FCb84e269d8d0a408442272']).toEqual([])
    expect(formatted.erc721s['0x026224A2940bFE258D0dbE947919B62fE321F042']).toEqual([2162n, 2647n])
  })
})
