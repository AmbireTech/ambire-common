import { AssetType } from '../defiPositions/types'
import { AccountState, NetworkState, PortfolioGasTankResult, TokenResult } from './interfaces'

const GAS_TANK_STATE: NetworkState<PortfolioGasTankResult> = {
  isReady: true,
  isLoading: false,
  errors: [],
  lastSuccessfulUpdate: 1753193545311,
  result: {
    updateStarted: 1753193544309,
    tokens: [],
    gasTankTokens: [
      {
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        symbol: 'USDC',
        name: 'USD Coin',
        amount: 5n * 10n ** 6n,
        availableAmount: 5n * 10n ** 6n,
        decimals: 6,
        chainId: 1n,
        priceIn: [{ baseCurrency: 'usd', price: 1 }],
        flags: { onGasTank: true, rewardsType: null, isFeeToken: true, canTopUpGasTank: false }
      }
    ],
    total: { usd: 5 }
  }
}

const PORTFOLIO_STATE: AccountState = {
  '1': {
    isReady: true,
    isLoading: false,
    errors: [],
    lastSuccessfulUpdate: 1753192920665,
    accountOps: [
      {
        accountAddr: '0x',
        chainId: 1n,
        signingKeyAddr: '0x',
        signingKeyType: 'internal',
        nonce: 10n,
        calls: [],
        gasLimit: null,
        signature: '0x',
        gasFeePayment: null
      }
    ],
    result: {
      lastExternalApiUpdateData: {
        hasHints: true,
        lastUpdate: 1753192918712
      },
      priceCache: new Map(),
      toBeLearned: {
        erc20s: [],
        erc721s: {}
      },
      updateStarted: 1753192918299,
      discoveryTime: 415,
      oracleCallTime: 364,
      priceUpdateTime: 1585,
      tokens: [
        {
          amount: 10n,
          chainId: 1n,
          decimals: 18,
          name: 'Ether',
          symbol: 'ETH',
          address: '0x0000000000000000000000000000000000000000',
          flags: {
            onGasTank: false,
            rewardsType: null,
            canTopUpGasTank: true,
            isFeeToken: true,
            isCustom: false
          },
          priceIn: [{ baseCurrency: 'usd', price: 3000 }]
        },
        {
          amount: 0n,
          chainId: 1n,
          decimals: 18,
          name: 'Render Token',
          symbol: 'RNDR',
          address: '0x6De037ef9aD2725EB40118Bb1702EBb27e4Aeb24',
          flags: {
            onGasTank: false,
            rewardsType: null,
            isFeeToken: false,
            isCustom: false,
            canTopUpGasTank: false
          },
          priceIn: [{ baseCurrency: 'usd', price: 4.5 }]
        },
        {
          amount: 50000n,
          chainId: 1n,
          decimals: 6,
          name: 'USD Coin',
          symbol: 'USDC',
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          flags: {
            onGasTank: false,
            rewardsType: null,
            canTopUpGasTank: true,
            isFeeToken: true,
            isCustom: false
          },
          priceIn: [{ baseCurrency: 'usd', price: 1 }]
        },
        // Defi tokens
        {
          amount: 0n,
          chainId: 1n,
          decimals: 18,
          name: 'Staked Aave',
          symbol: 'stkAAVE',
          address: '0x4da27a545c0c5B758a6BA100e3a049001de870f5',
          flags: {
            onGasTank: false,
            rewardsType: null,
            isFeeToken: false,
            isCustom: false,
            canTopUpGasTank: false,
            defiTokenType: AssetType.Collateral,
            defiPositionId: '51ee679b-3fc4-4736-9a30-661175777122'
          },
          priceIn: [{ baseCurrency: 'usd', price: 310 }]
        },
        {
          address: '0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7',
          symbol: 'aBasWETH',
          name: 'Aave Base WETH',
          chainId: 1n,
          decimals: 18,
          amount: 10n ** 18n,
          flags: {
            onGasTank: false,
            rewardsType: null,
            isFeeToken: false,
            isCustom: false,
            canTopUpGasTank: false,
            defiTokenType: AssetType.Collateral,
            defiPositionId: '50901a6f-5c4b-4447-98d8-1eed1b7db67a'
          },
          priceIn: [{ baseCurrency: 'usd', price: 100 }]
        },
        {
          address: '0xBdb9300b7CDE636d9cD4AFF00f6F009fFBBc8EE6',
          symbol: 'aBascbBTC',
          name: 'Aave Base cbBTC',
          chainId: 1n,
          decimals: 8,
          amount: 10n ** 8n,
          flags: {
            onGasTank: false,
            rewardsType: null,
            isFeeToken: false,
            isCustom: false,
            canTopUpGasTank: false,
            defiTokenType: AssetType.Collateral,
            defiPositionId: '50901a6f-5c4b-4447-98d8-1eed1b7db67a'
          },
          priceIn: [{ baseCurrency: 'usd', price: 100 }]
        },
        {
          address: '0x38e59ADE183BbEb94583d44213c8f3297e9933e9',
          symbol: 'variableDebtBasGHO',
          name: 'Gho Token',
          chainId: 1n,
          decimals: 18,
          amount: 20n ** 18n,
          flags: {
            onGasTank: false,
            rewardsType: null,
            isFeeToken: false,
            isCustom: false,
            canTopUpGasTank: false,
            defiTokenType: AssetType.Borrow,
            defiPositionId: '50901a6f-5c4b-4447-98d8-1eed1b7db67a'
          },
          priceIn: []
        },
        {
          address: '0x03D01595769333174036832e18fA2f17C74f8161',
          symbol: 'variableDebtBasEURC',
          name: 'EURC',
          chainId: 1n,
          decimals: 6,
          amount: 10n ** 6n,
          flags: {
            onGasTank: false,
            rewardsType: null,
            isFeeToken: false,
            isCustom: false,
            canTopUpGasTank: false,
            defiTokenType: AssetType.Borrow,
            defiPositionId: '50901a6f-5c4b-4447-98d8-1eed1b7db67a'
          },
          priceIn: []
        }
      ],
      feeTokens: [],
      blockNumber: 22975182,
      tokenErrors: [],
      collections: [
        {
          name: 'Ambire Rewards',
          chainId: 1n,
          symbol: 'AMR',
          amount: 0n,
          flags: {} as TokenResult['flags'],
          decimals: 1,
          collectibles: [],
          address: '0x35bAc15f98Fa2F496FCb84e269d8d0a408442272',
          priceIn: []
        }
      ],
      defiPositions: {
        providerErrors: [],
        isLoading: false,
        positionsByProvider: [
          {
            providerName: 'LIDO',
            chainId: 1n,
            source: 'debank',
            iconUrl:
              'https://static.debank.com/image/project/logo_url/lido/081388ebc44fa042561749bd5338d49e.png',
            siteUrl: 'https://stake.lido.fi',
            type: 'common',
            positions: [
              {
                id: '51ee679b-3fc4-4736-9a30-661175777122',
                assets: [
                  {
                    address: 'eth',
                    symbol: 'ETH',
                    name: 'ETH',
                    decimals: 18,
                    amount: 10n ** 18n,
                    priceIn: { price: 10, baseCurrency: 'usd' },
                    value: 10,
                    type: 1,
                    iconUrl:
                      'https://static.debank.com/image/coin/logo_url/eth/6443cdccced33e204d90cb723c632917.png'
                  }
                ],
                additionalData: {
                  positionInUSD: 10,
                  collateralInUSD: 10,
                  name: 'Staked',
                  detailTypes: ['common'],
                  updateAt: 1753088424,
                  pool: {
                    id: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84',
                    chain: 'eth',
                    project_id: 'lido',
                    adapter_id: 'lido_staked',
                    controller: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84',
                    index: null,
                    time_at: 1608242396
                  }
                }
              }
            ],
            positionInUSD: 10
          },
          {
            providerName: 'Uniswap V2',
            chainId: 1n,
            source: 'debank',

            iconUrl:
              'https://static.debank.com/image/project/logo_url/uniswap2/87a541b3b83b041c8d12119e5a0d19f0.png',
            siteUrl: 'https://app.uniswap.org',
            type: 'common',
            positions: [
              {
                id: '34d6f8a9-f125-4223-9e39-763103009671',
                assets: [
                  {
                    address: '0x88800092ff476844f74dc2fc427974bbee2794ae',
                    symbol: 'WALLET',
                    name: 'Ambire Wallet',
                    decimals: 18,
                    amount: 20n ** 18n,
                    priceIn: { price: 20, baseCurrency: 'usd' },
                    value: 40,
                    type: 1,
                    iconUrl:
                      'https://static.debank.com/image/eth_token/logo_url/0x88800092ff476844f74dc2fc427974bbee2794ae/6d920bb617173a2c6d5e4d8d91febeeb.png'
                  }
                ],
                additionalData: {
                  positionInUSD: 40,
                  collateralInUSD: 40,
                  name: 'Liquidity Pool',
                  detailTypes: ['common'],
                  updateAt: 1753242105,
                  pool: {
                    id: '0x3cd6f8781ae6293cb1e1da7a0dde2f627b31ab49',
                    chain: 'eth',
                    project_id: 'uniswap2',
                    adapter_id: 'uniswap2_liquidity_proxy',
                    controller: '0x3cd6f8781ae6293cb1e1da7a0dde2f627b31ab49',
                    index: null,
                    time_at: 1751111543
                  }
                }
              }
            ],
            positionInUSD: 40
          },
          {
            providerName: 'AAVE v3',
            chainId: 8453n,
            source: 'debank',
            type: 'lending',
            positions: [
              {
                id: '50901a6f-5c4b-4447-98d8-1eed1b7db67a',
                additionalData: {
                  healthRate: 5,
                  positionInUSD: 170,
                  deptInUSD: -30,
                  collateralInUSD: 200,
                  availableBorrowInUSD: 120,
                  name: 'Lending'
                },
                assets: [
                  {
                    address: '0x4200000000000000000000000000000000000006',
                    symbol: 'WETH',
                    name: 'Wrapped Ether',
                    iconUrl: '',
                    decimals: 18,
                    amount: 10n ** 18n,
                    priceIn: { baseCurrency: 'usd', price: 100 },
                    value: 100,
                    type: 1,
                    additionalData: { APY: 2.3947434847108195 },
                    protocolAsset: {
                      address: '0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7',
                      symbol: 'aBasWETH',
                      name: 'Aave Base WETH',
                      decimals: 18
                    }
                  },
                  {
                    address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
                    symbol: 'cbBTC',
                    name: 'Coinbase Wrapped BTC',
                    iconUrl: '',
                    decimals: 8,
                    amount: 10n ** 8n,
                    priceIn: { baseCurrency: 'usd', price: 100 },
                    value: 100,
                    type: 1,
                    additionalData: { APY: 0.05634346614514422 },
                    protocolAsset: {
                      address: '0xBdb9300b7CDE636d9cD4AFF00f6F009fFBBc8EE6',
                      symbol: 'aBascbBTC',
                      name: 'Aave Base cbBTC',
                      decimals: 8
                    }
                  },
                  {
                    address: '0x6Bb7a212910682DCFdbd5BCBb3e28FB4E8da10Ee',
                    symbol: 'GHO',
                    name: 'Gho Token',
                    iconUrl: '',
                    decimals: 18,
                    amount: 20n ** 18n,
                    priceIn: { baseCurrency: 'usd', price: 1 },
                    value: 20,
                    type: 2,
                    additionalData: { APY: 6.512766261896412 },
                    protocolAsset: {
                      address: '0x38e59ADE183BbEb94583d44213c8f3297e9933e9',
                      symbol: 'variableDebtBasGHO',
                      name: 'Gho Token',
                      decimals: 18
                    }
                  },
                  {
                    address: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42',
                    symbol: 'EURC',
                    name: 'EURC',
                    iconUrl: '',
                    decimals: 6,
                    amount: 10n ** 6n,
                    priceIn: { baseCurrency: 'usd', price: 1 },
                    value: 10,
                    type: 2,
                    additionalData: { APY: 5.6437973314138095 },
                    protocolAsset: {
                      address: '0x03D01595769333174036832e18fA2f17C74f8161',
                      symbol: 'variableDebtBasEURC',
                      name: 'EURC',
                      decimals: 6
                    }
                  }
                ]
              }
            ],
            iconUrl: '',
            siteUrl: 'https://app.aave.com/',
            positionInUSD: 18985.66497510702
          }
        ],
        updatedAt: 1753258959994
      },
      total: { usd: 260 }
    }
  },
  '8453': {
    isReady: true,
    isLoading: false,
    errors: [],
    lastSuccessfulUpdate: 1753192920665,
    result: {
      lastExternalApiUpdateData: {
        hasHints: true,
        lastUpdate: 1753192918712
      },
      updateStarted: 1753192918299,
      discoveryTime: 415,
      oracleCallTime: 364,
      priceCache: new Map(),
      toBeLearned: {
        erc20s: [],
        erc721s: {}
      },
      priceUpdateTime: 1585,
      tokens: [
        {
          amount: 10n ** 18n,
          chainId: 8453n,
          decimals: 18,
          name: 'Ether',
          symbol: 'ETH',
          address: '0x0000000000000000000000000000000000000000',
          flags: {
            onGasTank: false,
            rewardsType: null,
            canTopUpGasTank: true,
            isFeeToken: true,
            isCustom: false
          },
          priceIn: [{ baseCurrency: 'usd', price: 10 }]
        }
      ],
      feeTokens: [],
      blockNumber: 22975182,
      tokenErrors: [],
      collections: [],
      total: { usd: 10 },
      defiPositions: {
        providerErrors: [],
        isLoading: false,
        positionsByProvider: [],
        updatedAt: 1753258959994
      }
    }
  },
  gasTank: GAS_TANK_STATE as any // fixes a weird ts issue
}

export { PORTFOLIO_STATE }
