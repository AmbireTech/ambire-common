import { NetworkState, PortfolioNetworkResult, TokenResult } from 'libs/portfolio/interfaces'

/* eslint-disable @typescript-eslint/no-use-before-define */
import { describe, expect, test } from '@jest/globals'

import { networks } from '../../consts/networks'
import { getRpcProvider } from '../../services/provider'
import { PORTFOLIO_STATE } from '../portfolio/testData'
import { enhancePortfolioTokensWithDefiPositions } from './defiPositions'
import { getAAVEPositions, getDebankEnhancedUniV3Positions, getUniV3Positions } from './providers'
import { AssetType, PositionsByProvider } from './types'

describe('DeFi positions providers', () => {
  // If this test ever fails because the accounts remove their positions, you can:
  // 1. Go to https://debank.com/protocols/matic_uniswap3/holders
  // 2. Find an account that has the required positions and use it in the test
  const userAddrUni = '0xbd67a10726e6d112295a698ea348f40d27fe5149'
  const userAddrAave = '0xe40d278afd00e6187db21ff8c96d572359ef03bf'

  const ethereum = networks.find((n) => n.chainId === 1n)
  if (!ethereum) throw new Error('unable to find ethereum network in consts')

  const polygon = networks.find((n) => n.chainId === 137n)
  if (!polygon) throw new Error('unable to find polygon network in consts')

  const providerEthereum = getRpcProvider(['https://invictus.ambire.com/ethereum'], 1n)
  const providerPolygon = getRpcProvider(['https://invictus.ambire.com/polygon'], 137n)

  describe('Uni V3', () => {
    test('Get uni v3 positions on Polygon', async () => {
      const uniV3Positions = await getUniV3Positions(userAddrUni, providerPolygon, polygon)
      expect(uniV3Positions).not.toBeNull()

      if (uniV3Positions !== null) {
        const firstPos = uniV3Positions.positions[0]!
        expect(firstPos.additionalData.liquidity).toBeGreaterThan(0)
        expect(firstPos.assets.length).toBeGreaterThan(0)
      }
    })
    test('Uni V3 returns multiple positions', async () => {
      const uniV3Positions = await getUniV3Positions(userAddrUni, providerPolygon, polygon)

      expect(uniV3Positions?.positions.length).toBeGreaterThan(1)
    })
    describe('getDebankEnhancedUniV3Positions', () => {
      it('returns the old mixed positions if Debank call fails', async () => {
        const res = await getDebankEnhancedUniV3Positions(
          userAddrUni,
          providerPolygon,
          polygon,
          [
            {
              providerName: 'Uniswap V3',
              chainId: 137n,
              source: 'mixed',
              iconUrl: '',
              siteUrl: 'https://app.uniswap.org/swap',
              type: 'common',
              positions: DEBANK_UNI_V3[0]!.positions
            }
          ],
          [],
          false
        )

        expect(res).not.toBeNull()
        expect(res?.source).toBe('mixed')
      })
      it('returns the original custom positions if matching positions are not found in the Debank response', async () => {
        const res = await getDebankEnhancedUniV3Positions(
          userAddrUni,
          providerPolygon,
          polygon,
          [],
          [],
          true
        )

        expect(res).not.toBeNull()
        expect(res?.source).toBe('custom')
      })
      it('merges positions from Debank and custom correctly', async () => {
        const res = await getDebankEnhancedUniV3Positions(
          userAddrUni,
          providerPolygon,
          polygon,
          [],
          DEBANK_UNI_V3,
          true
        )

        expect(res).not.toBeNull()
        expect(res?.source).toBe('mixed')
        expect(res?.positions.length).toBeGreaterThan(0)

        const firstPos = res?.positions[0]!
        expect(firstPos).toBeDefined()
        expect(firstPos?.additionalData.inRange).toBeDefined()
      })
    })
  })
  describe('AAVE v3', () => {
    test('Get AAVE positions on Ethereum', async () => {
      const aavePositions = await getAAVEPositions(userAddrAave, providerEthereum, ethereum)

      expect(aavePositions).not.toBeNull()
      if (aavePositions !== null) {
        const pos1 = aavePositions.positions[0]!
        expect(pos1.additionalData.healthRate).toBeGreaterThan(1)
      }
    })
    test('AAVE returns prices, health rate, additional date and asset value', async () => {
      const aavePositions = await getAAVEPositions(userAddrAave, providerEthereum, ethereum)
      const pos = aavePositions?.positions[0]!
      if (!pos) throw new Error('no positions found')

      expect(aavePositions?.positionInUSD).toBeGreaterThan(0)
      expect(pos.additionalData.positionInUSD).toBeGreaterThan(0)
      expect(pos.additionalData.healthRate).toBeGreaterThan(0)
      expect(pos.additionalData.collateralInUSD).toBeGreaterThan(0)
    })
  })
})

describe('Defi positions helper and portfolio functions', () => {
  it('should add positions to the portfolio', () => {
    const clonedPortfolioEthereumState = structuredClone(
      PORTFOLIO_STATE['1']
    ) as NetworkState<PortfolioNetworkResult>
    const originalTokenCount = clonedPortfolioEthereumState!.result!.tokens.length

    const tokens = enhancePortfolioTokensWithDefiPositions(
      clonedPortfolioEthereumState.result!.tokens,
      clonedPortfolioEthereumState.result!.defiPositions
    )

    // -- Defi positions are added to the portfolio

    // 5 portfolio tokens + 4 defi tokens
    expect(tokens?.length).toBe(originalTokenCount + 1)

    // -- Protocol representations of borrowed tokens don't have prices
    const variableDebtBasGHO = tokens!.find(
      ({ address }) => address === '0x38e59ADE183BbEb94583d44213c8f3297e9933e9'
    )

    expect(variableDebtBasGHO?.priceIn.length).toBe(0)

    // Tokens added from defi positions have flags

    // -- Defi tokens have the respective flag
    const aBasWETH = tokens!.find(
      ({ address }) => address === '0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7'
    )
    // Tokens added from defi positions have flags
    const aaveCbtc = tokens!.find(
      ({ address }) => address === '0xBdb9300b7CDE636d9cD4AFF00f6F009fFBBc8EE6'
    )

    expect(aBasWETH?.flags.defiTokenType).toBe(AssetType.Collateral)
    expect(aaveCbtc?.flags.defiTokenType).toBe(AssetType.Collateral)
    expect(variableDebtBasGHO?.flags.defiTokenType).toBe(AssetType.Borrow)
  })
  it('should add a price to portfolio defi tokens if the price is defined in the defi state', () => {
    const clonedPortfolioEthereumState = structuredClone(
      PORTFOLIO_STATE['1']
    ) as NetworkState<PortfolioNetworkResult>
    const secondPosition =
      clonedPortfolioEthereumState?.result?.defiPositions.positionsByProvider[2]?.positions[0]
    const secondPositionAsset = secondPosition?.assets[0]
    const aBasWETHWithoutPrice: TokenResult = {
      ...structuredClone(secondPositionAsset),
      flags: {
        onGasTank: false,
        rewardsType: null,
        isFeeToken: false,
        isCustom: false,
        canTopUpGasTank: false
      },
      priceIn: [],
      chainId: 1n,
      // Ensure required fields are present and not undefined
      address: secondPositionAsset?.address ?? '',
      symbol: secondPositionAsset?.symbol ?? '',
      name: secondPositionAsset?.name ?? '',
      decimals: secondPositionAsset?.decimals ?? 18,
      amount: secondPositionAsset?.amount ?? 0n
    }

    expect(aBasWETHWithoutPrice.priceIn.length).toBe(0)

    clonedPortfolioEthereumState.result?.tokens.push(aBasWETHWithoutPrice)

    const tokens = enhancePortfolioTokensWithDefiPositions(
      clonedPortfolioEthereumState.result!.tokens,
      clonedPortfolioEthereumState.result!.defiPositions
    )

    const aBasWETH = tokens!.findLast(
      ({ address }) => address === '0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7'
    )

    expect(aBasWETH?.flags.defiTokenType).toBe(AssetType.Collateral)
    expect(aBasWETH?.priceIn.length).toBe(1)
  })
})

const DEBANK_UNI_V3: PositionsByProvider[] = [
  {
    providerName: 'Uniswap V3',
    chainId: 137n,
    iconUrl:
      'https://static.debank.com/image/project/logo_url/uniswap3/87a541b3b83b041c8d12119e5a0d19f0.png',
    siteUrl: 'https://app.uniswap.org',
    type: 'common',
    source: 'debank' as const,
    positions: [
      {
        id: 'a49f7296-ce5a-4c61-99f7-8a0698742ddf',
        assets: [
          {
            address: '0xcb555a9926eb72f1622ce9bc34a385507c9f5be2',
            symbol: 'bPMPKN',
            name: 'beta Pumpkin',
            decimals: 6,
            amount: 10660978675n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 0,
            iconUrl: ''
          },
          {
            address: '0xeb18fc3350049043b21724d2260562e210714729',
            symbol: 'bFARM',
            name: 'beta CryptoFarmers',
            decimals: 6,
            amount: 3809952978464n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 0,
            iconUrl: ''
          },
          {
            address: '0xcb555a9926eb72f1622ce9bc34a385507c9f5be2',
            symbol: 'bPMPKN',
            name: 'beta Pumpkin',
            decimals: 6,
            amount: 2774999n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 3,
            iconUrl: ''
          },
          {
            address: '0xeb18fc3350049043b21724d2260562e210714729',
            symbol: 'bFARM',
            name: 'beta CryptoFarmers',
            decimals: 6,
            amount: 314276987n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 3,
            iconUrl: ''
          }
        ],
        additionalData: {
          positionIndex: '2055832',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1762302333,
          position_index: '2055832',
          pool: {
            id: '0x37483a11f242a4722d134e83861d15661950d1db',
            chain: 'matic',
            project_id: 'matic_uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0x37483a11f242a4722d134e83861d15661950d1db',
            index: null,
            time_at: 1724677257
          }
        }
      },
      {
        id: '993bf152-22aa-43c8-b50d-b8ade8e2e4bb',
        assets: [
          {
            address: '0x5c15cdb9d43824dca67fceb1201e5abebe0b2cbc',
            symbol: 'FARM',
            name: 'CryptoFarmers',
            decimals: 6,
            amount: 286662361586n,
            priceIn: {
              price: 0.0064250155002450425,
              baseCurrency: 'usd'
            },
            value: 1841.810116530017,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/matic_token/logo_url/0x5c15cdb9d43824dca67fceb1201e5abebe0b2cbc/5822b87a8dc5498ef4f94e74785eceb7.png'
          },
          {
            address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
            symbol: 'USDT',
            name: '(PoS) Tether USD',
            decimals: 6,
            amount: 1955350512n,
            priceIn: {
              price: 0.99997,
              baseCurrency: 'usd'
            },
            value: 1955.2918515009417,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/matic_token/logo_url/0xc2132d05d31c914a87c6611c10748aeb04b58e8f/3a2803ff6129961e8fa48f8b66d06735.png'
          },
          {
            address: '0x5c15cdb9d43824dca67fceb1201e5abebe0b2cbc',
            symbol: 'FARM',
            name: 'CryptoFarmers',
            decimals: 6,
            amount: 3873361735n,
            priceIn: {
              price: 0.0064250155002450425,
              baseCurrency: 'usd'
            },
            value: 24.88640918543103,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/matic_token/logo_url/0x5c15cdb9d43824dca67fceb1201e5abebe0b2cbc/5822b87a8dc5498ef4f94e74785eceb7.png'
          },
          {
            address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
            symbol: 'USDT',
            name: '(PoS) Tether USD',
            decimals: 6,
            amount: 59854519n,
            priceIn: {
              price: 0.99997,
              baseCurrency: 'usd'
            },
            value: 59.852723364430005,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/matic_token/logo_url/0xc2132d05d31c914a87c6611c10748aeb04b58e8f/3a2803ff6129961e8fa48f8b66d06735.png'
          }
        ],
        additionalData: {
          positionInUSD: 3881.84110058082,
          collateralInUSD: 3881.84110058082,
          positionIndex: '2195961',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1762302333,
          position_index: '2195961',
          pool: {
            id: '0x452a85701b93afacfef2910a857834f146fbb38f',
            chain: 'matic',
            project_id: 'matic_uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0x452a85701b93afacfef2910a857834f146fbb38f',
            index: null,
            time_at: 1730462142
          }
        }
      },
      {
        id: '618aebb2-c5d2-4a1e-8a61-88e171ad0143',
        assets: [
          {
            address: '0xa730b143ed614f0f38221e9106a214bdd6f89f31',
            symbol: 'tUSDT',
            name: 'Test USDT',
            decimals: 6,
            amount: 35550048042n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 0,
            iconUrl: ''
          },
          {
            address: '0xeb18fc3350049043b21724d2260562e210714729',
            symbol: 'bFARM',
            name: 'beta CryptoFarmers',
            decimals: 6,
            amount: 79092013483n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 0,
            iconUrl: ''
          },
          {
            address: '0xa730b143ed614f0f38221e9106a214bdd6f89f31',
            symbol: 'tUSDT',
            name: 'Test USDT',
            decimals: 6,
            amount: 16700246n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 3,
            iconUrl: ''
          }
        ],
        additionalData: {
          positionIndex: '2186893',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1762302333,
          position_index: '2186893',
          pool: {
            id: '0x83a9bc048061581faf3fc5fa652ef80e54736b10',
            chain: 'matic',
            project_id: 'matic_uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0x83a9bc048061581faf3fc5fa652ef80e54736b10',
            index: null,
            time_at: 1730115248
          }
        }
      },
      {
        id: 'd5793f5b-4ef5-4cb2-9743-3fd48bf66d5b',
        assets: [
          {
            address: '0x672f4417e4c0a05476022c816a120b57d8e40b1e',
            symbol: 'bTMATO',
            name: 'beta Tomato',
            decimals: 6,
            amount: 102928955442n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 0,
            iconUrl: ''
          },
          {
            address: '0xeb18fc3350049043b21724d2260562e210714729',
            symbol: 'bFARM',
            name: 'beta CryptoFarmers',
            decimals: 6,
            amount: 798247822341n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 0,
            iconUrl: ''
          },
          {
            address: '0x672f4417e4c0a05476022c816a120b57d8e40b1e',
            symbol: 'bTMATO',
            name: 'beta Tomato',
            decimals: 6,
            amount: 81040798n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 3,
            iconUrl: ''
          },
          {
            address: '0xeb18fc3350049043b21724d2260562e210714729',
            symbol: 'bFARM',
            name: 'beta CryptoFarmers',
            decimals: 6,
            amount: 434031560n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 3,
            iconUrl: ''
          }
        ],
        additionalData: {
          positionIndex: '2055790',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1762302333,
          position_index: '2055790',
          pool: {
            id: '0x8c46432f9175cea009f52702152b5863ac4ac51f',
            chain: 'matic',
            project_id: 'matic_uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0x8c46432f9175cea009f52702152b5863ac4ac51f',
            index: null,
            time_at: 1724676325
          }
        }
      },
      {
        id: '6e458328-ccf6-45a3-9e00-dd6527eb359d',
        assets: [
          {
            address: '0xeb18fc3350049043b21724d2260562e210714729',
            symbol: 'bFARM',
            name: 'beta CryptoFarmers',
            decimals: 6,
            amount: 4920719959772n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 0,
            iconUrl: ''
          },
          {
            address: '0xec85caa753c636d402ba7ac102b38ba85e82c637',
            symbol: 'bPEPPR',
            name: 'beta Pepper',
            decimals: 6,
            amount: 12051375197n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 0,
            iconUrl: ''
          },
          {
            address: '0xeb18fc3350049043b21724d2260562e210714729',
            symbol: 'bFARM',
            name: 'beta CryptoFarmers',
            decimals: 6,
            amount: 1232418529n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 3,
            iconUrl: ''
          },
          {
            address: '0xec85caa753c636d402ba7ac102b38ba85e82c637',
            symbol: 'bPEPPR',
            name: 'beta Pepper',
            decimals: 6,
            amount: 8424800n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 3,
            iconUrl: ''
          }
        ],
        additionalData: {
          positionIndex: '2055837',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1762302333,
          position_index: '2055837',
          pool: {
            id: '0x8e8c7a7cc169c07b2f2b6c2ff8a87a9af9bc9b99',
            chain: 'matic',
            project_id: 'matic_uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0x8e8c7a7cc169c07b2f2b6c2ff8a87a9af9bc9b99',
            index: null,
            time_at: 1724677349
          }
        }
      },
      {
        id: 'a2ba57c7-5732-42b9-8a03-c3870498d8d3',
        assets: [
          {
            address: '0x4c856e0886cf2ccfd8f80df4ec806e6121f60156',
            symbol: 'bPTATO',
            name: 'beta Potato',
            decimals: 6,
            amount: 50788102410n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 0,
            iconUrl: ''
          },
          {
            address: '0xeb18fc3350049043b21724d2260562e210714729',
            symbol: 'bFARM',
            name: 'beta CryptoFarmers',
            decimals: 6,
            amount: 1683073918758n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 0,
            iconUrl: ''
          },
          {
            address: '0x4c856e0886cf2ccfd8f80df4ec806e6121f60156',
            symbol: 'bPTATO',
            name: 'beta Potato',
            decimals: 6,
            amount: 15797889n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 3,
            iconUrl: ''
          },
          {
            address: '0xeb18fc3350049043b21724d2260562e210714729',
            symbol: 'bFARM',
            name: 'beta CryptoFarmers',
            decimals: 6,
            amount: 402992782n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 3,
            iconUrl: ''
          }
        ],
        additionalData: {
          positionIndex: '2055803',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1762302333,
          position_index: '2055803',
          pool: {
            id: '0x93608296ed7ccf879248926776b1c319d8b4e614',
            chain: 'matic',
            project_id: 'matic_uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0x93608296ed7ccf879248926776b1c319d8b4e614',
            index: null,
            time_at: 1724676637
          }
        }
      },
      {
        id: 'bd05e1da-2431-46f1-bcca-eefb6270991c',
        assets: [
          {
            address: '0xa1616f288deda4ef72474961652071e254414b41',
            symbol: 'bWHEAT',
            name: 'beta Wheat',
            decimals: 6,
            amount: 19963991523n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 0,
            iconUrl: ''
          },
          {
            address: '0xeb18fc3350049043b21724d2260562e210714729',
            symbol: 'bFARM',
            name: 'beta CryptoFarmers',
            decimals: 6,
            amount: 5892695039060n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 0,
            iconUrl: ''
          },
          {
            address: '0xa1616f288deda4ef72474961652071e254414b41',
            symbol: 'bWHEAT',
            name: 'beta Wheat',
            decimals: 6,
            amount: 2329422n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 3,
            iconUrl: ''
          },
          {
            address: '0xeb18fc3350049043b21724d2260562e210714729',
            symbol: 'bFARM',
            name: 'beta CryptoFarmers',
            decimals: 6,
            amount: 609425475n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 3,
            iconUrl: ''
          }
        ],
        additionalData: {
          positionIndex: '2055823',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1762302333,
          position_index: '2055823',
          pool: {
            id: '0xb9f4acda3c5fe887f2c355a8158412c0cf6c0281',
            chain: 'matic',
            project_id: 'matic_uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0xb9f4acda3c5fe887f2c355a8158412c0cf6c0281',
            index: null,
            time_at: 1724677061
          }
        }
      },
      {
        id: 'e075d447-201b-410a-80da-3b63083e6ac2',
        assets: [
          {
            address: '0x49ad651ec74a77a1c0f8484cd775176d254f34e2',
            symbol: 'bMAIZE',
            name: 'beta Maize',
            decimals: 6,
            amount: 29510098799n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 0,
            iconUrl: ''
          },
          {
            address: '0xeb18fc3350049043b21724d2260562e210714729',
            symbol: 'bFARM',
            name: 'beta CryptoFarmers',
            decimals: 6,
            amount: 4477425033629n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 0,
            iconUrl: ''
          },
          {
            address: '0x49ad651ec74a77a1c0f8484cd775176d254f34e2',
            symbol: 'bMAIZE',
            name: 'beta Maize',
            decimals: 6,
            amount: 3150186n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 3,
            iconUrl: ''
          },
          {
            address: '0xeb18fc3350049043b21724d2260562e210714729',
            symbol: 'bFARM',
            name: 'beta CryptoFarmers',
            decimals: 6,
            amount: 578333948n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 3,
            iconUrl: ''
          }
        ],
        additionalData: {
          positionIndex: '2055815',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1762302333,
          position_index: '2055815',
          pool: {
            id: '0xcd255c89203dc140ebc7c5350b8a8d73f344b128',
            chain: 'matic',
            project_id: 'matic_uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0xcd255c89203dc140ebc7c5350b8a8d73f344b128',
            index: null,
            time_at: 1724676881
          }
        }
      },
      {
        id: 'c6c43042-5b72-4154-8d99-4045a6660d9c',
        assets: [
          {
            address: '0xd3f809f0c93904c8d061d4cdd2465d562b153da9',
            symbol: 'bCCMBR',
            name: 'beta Cucumber',
            decimals: 6,
            amount: 51885758734n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 0,
            iconUrl: ''
          },
          {
            address: '0xeb18fc3350049043b21724d2260562e210714729',
            symbol: 'bFARM',
            name: 'beta CryptoFarmers',
            decimals: 6,
            amount: 996500531343n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 0,
            iconUrl: ''
          },
          {
            address: '0xd3f809f0c93904c8d061d4cdd2465d562b153da9',
            symbol: 'bCCMBR',
            name: 'beta Cucumber',
            decimals: 6,
            amount: 16452594n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 3,
            iconUrl: ''
          },
          {
            address: '0xeb18fc3350049043b21724d2260562e210714729',
            symbol: 'bFARM',
            name: 'beta CryptoFarmers',
            decimals: 6,
            amount: 172012660n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 3,
            iconUrl: ''
          }
        ],
        additionalData: {
          positionIndex: '2055797',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1762302333,
          position_index: '2055797',
          pool: {
            id: '0xcdea22c82ed56556e0c3b0b69988c3fca8f0bd3f',
            chain: 'matic',
            project_id: 'matic_uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0xcdea22c82ed56556e0c3b0b69988c3fca8f0bd3f',
            index: null,
            time_at: 1724676489
          }
        }
      },
      {
        id: 'c7389aa7-12e3-40d2-9b14-8e62b4206de3',
        assets: [
          {
            address: '0xa6b94767aed641deaec0e99863bcb0fb6c05af51',
            symbol: 'bCBBAG',
            name: 'beta Cabbage',
            decimals: 6,
            amount: 53002158673n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 0,
            iconUrl: ''
          },
          {
            address: '0xeb18fc3350049043b21724d2260562e210714729',
            symbol: 'bFARM',
            name: 'beta CryptoFarmers',
            decimals: 6,
            amount: 3361870568079n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 0,
            iconUrl: ''
          },
          {
            address: '0xa6b94767aed641deaec0e99863bcb0fb6c05af51',
            symbol: 'bCBBAG',
            name: 'beta Cabbage',
            decimals: 6,
            amount: 16522641n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 3,
            iconUrl: ''
          },
          {
            address: '0xeb18fc3350049043b21724d2260562e210714729',
            symbol: 'bFARM',
            name: 'beta CryptoFarmers',
            decimals: 6,
            amount: 448227650n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 3,
            iconUrl: ''
          }
        ],
        additionalData: {
          positionIndex: '2055809',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1762302333,
          position_index: '2055809',
          pool: {
            id: '0xe30450de2e5f035096402b89d37a4e5b0706191a',
            chain: 'matic',
            project_id: 'matic_uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0xe30450de2e5f035096402b89d37a4e5b0706191a',
            index: null,
            time_at: 1724676757
          }
        }
      },
      {
        id: 'd81c2dec-d585-4ee4-acb5-c840a8262e9b',
        assets: [
          {
            address: '0x1820396152887ebb10c20c19fd71c9536dedb0bd',
            symbol: 'bBRCLI',
            name: 'beta Broccoli',
            decimals: 6,
            amount: 19960063374n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 0,
            iconUrl: ''
          },
          {
            address: '0xeb18fc3350049043b21724d2260562e210714729',
            symbol: 'bFARM',
            name: 'beta CryptoFarmers',
            decimals: 6,
            amount: 7883411215077n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 0,
            iconUrl: ''
          },
          {
            address: '0x1820396152887ebb10c20c19fd71c9536dedb0bd',
            symbol: 'bBRCLI',
            name: 'beta Broccoli',
            decimals: 6,
            amount: 614999n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 3,
            iconUrl: ''
          },
          {
            address: '0xeb18fc3350049043b21724d2260562e210714729',
            symbol: 'bFARM',
            name: 'beta CryptoFarmers',
            decimals: 6,
            amount: 257304777n,
            priceIn: {
              price: 0,
              baseCurrency: 'usd'
            },
            value: 0,
            type: 3,
            iconUrl: ''
          }
        ],
        additionalData: {
          positionIndex: '2055829',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1762302333,
          position_index: '2055829',
          pool: {
            id: '0xe58f1317e3928014c12dca7edb5e5ef096215853',
            chain: 'matic',
            project_id: 'matic_uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0xe58f1317e3928014c12dca7edb5e5ef096215853',
            index: null,
            time_at: 1724677173
          }
        }
      }
    ],
    positionInUSD: 3881.84110058082
  }
]
