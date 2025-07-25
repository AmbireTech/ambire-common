import {
  AccountState as DefiAccountState,
  AssetType,
  NetworkState as DefiNetworkState
} from '../defiPositions/types'
/* eslint-disable @typescript-eslint/no-use-before-define */
import { AccountState, NetworkState, PriceCache, TokenResult } from '../portfolio/interfaces'
import {
  calculateDefiPositions,
  calculateSelectedAccountPortfolio,
  calculateTokensArray,
  getIsRecalculationNeeded,
  stripPortfolioState
} from './selectedAccount'

type TokenResultWithStateAmounts = TokenResult & {
  pendingAmount: bigint
  latestAmount: bigint
}

describe('Selected Account lib', () => {
  it('stripPortfolioState works as expected', () => {
    const strippedState = stripPortfolioState({
      '1': PORTFOLIO_STATE['1']
    })

    expect(strippedState['1']?.result).toBeDefined()
    const result = strippedState['1']?.result || {}

    expect('tokens' in result).toBe(false)
    expect('collections' in result).toBe(false)
    expect('hintsFromExternalAPI' in result).toBe(false)
  })
  describe('calculateTokenArray', () => {
    it('should calculate token array correctly', () => {
      const { tokens, hasTokenWithAmount } = calculateTokensArray(
        '1',
        PORTFOLIO_STATE['1']!.result!.tokens,
        PENDING_PORTFOLIO_STATE['1']!.result!.tokens,
        true
      )
      const ETH = tokens[0] as TokenResultWithStateAmounts

      expect(ETH.pendingAmount).toBe(10n)
      expect(ETH.amount).toBe(10n)
      expect(ETH.latestAmount).toBe(100n)
      expect(hasTokenWithAmount).toBe(true)
    })

    it('The same token list is returned when gasTank tokens are passed', () => {
      const { tokens, hasTokenWithAmount } = calculateTokensArray(
        'gasTank',
        PORTFOLIO_STATE.gasTank!.result!.tokens,
        PORTFOLIO_STATE.gasTank!.result!.tokens,
        false
      )

      expect(tokens).toEqual(PORTFOLIO_STATE.gasTank!.result!.tokens)
      expect(hasTokenWithAmount).toBe(false)
    })
  })
  describe('getIsRecalculationNeeded', () => {
    it('should return true if there is no portfolio or defi positions state', () => {
      const result = getIsRecalculationNeeded(
        { totalBalance: 0, collections: [], tokens: [] },
        PORTFOLIO_STATE['1'],
        PORTFOLIO_STATE['1'],
        PORTFOLIO_STATE['1'],
        undefined
      )

      expect(result).toBe(true)

      const result2 = getIsRecalculationNeeded(
        { totalBalance: 0, collections: [], tokens: [] },
        undefined,
        undefined,
        undefined,
        DEFI_STATE['1']
      )

      expect(result2).toBe(true)
    })
    it('should return false if the portfolio or defi positions state is loading', () => {
      // THIS ONE IS VITAL. IF THE PORTFOLIO OR DEFI POSITIONS STATE IS LOADING WE NEVER
      // WANT A RECALCULATION AS THAT WOULD FLIP ISALLREADY TO FALSE
      const clonedPortfolioEthereumState = structuredClone(PORTFOLIO_STATE['1']) as NetworkState
      const clonedPortfolioEthereumStatePending = structuredClone(
        PENDING_PORTFOLIO_STATE['1']
      ) as NetworkState
      const clonedDefiEthereumState = structuredClone(DEFI_STATE['1']) as DefiNetworkState
      clonedPortfolioEthereumState.isLoading = true

      const result = getIsRecalculationNeeded(
        { totalBalance: 0, collections: [], tokens: [] },
        clonedPortfolioEthereumState,
        clonedPortfolioEthereumStatePending,
        clonedPortfolioEthereumStatePending,
        DEFI_STATE['1']
      )

      expect(result).toBe(false)

      clonedDefiEthereumState.isLoading = true

      const result2 = getIsRecalculationNeeded(
        { totalBalance: 0, collections: [], tokens: [] },
        clonedPortfolioEthereumState,
        clonedPortfolioEthereumStatePending,
        clonedPortfolioEthereumStatePending,
        clonedDefiEthereumState
      )

      expect(result2).toBe(false)
    })
    it('should return true if the portfolio or defi positions state has been updated', () => {
      const clonedPortfolioEthereumState = structuredClone(PORTFOLIO_STATE['1']) as NetworkState
      const clonedPortfolioEthereumStatePending = structuredClone(
        PENDING_PORTFOLIO_STATE['1']
      ) as NetworkState

      const mockPastState = {
        totalBalance: 0,
        collections: [],
        tokens: [],
        defiPositionsUpdatedAt: DEFI_STATE['1'].updatedAt,
        blockNumber: clonedPortfolioEthereumStatePending?.result?.blockNumber
      }

      clonedPortfolioEthereumStatePending.accountOps = []

      const result = getIsRecalculationNeeded(
        mockPastState,
        clonedPortfolioEthereumState,
        clonedPortfolioEthereumStatePending,
        clonedPortfolioEthereumStatePending,
        DEFI_STATE['1']
      )

      expect(result).toBe(false)

      // Update defiPositionsUpdatedAt to be older than the new state
      mockPastState.defiPositionsUpdatedAt = (DEFI_STATE['1'] as any).updatedAt - 1000

      const result2 = getIsRecalculationNeeded(
        mockPastState,
        clonedPortfolioEthereumState,
        clonedPortfolioEthereumStatePending,
        clonedPortfolioEthereumStatePending,
        DEFI_STATE['1']
      )

      expect(result2).toBe(true)
    })
    it('should return false if the pending portfolio state is loaded but the latest is not', () => {
      const clonedPortfolioEthereumState = structuredClone(PORTFOLIO_STATE['1']) as NetworkState
      const clonedPortfolioEthereumStatePending = structuredClone(
        PENDING_PORTFOLIO_STATE['1']
      ) as NetworkState

      clonedPortfolioEthereumState.isLoading = true
      clonedPortfolioEthereumStatePending.isLoading = false

      const result = getIsRecalculationNeeded(
        { totalBalance: 0, collections: [], tokens: [] },
        clonedPortfolioEthereumState,
        clonedPortfolioEthereumStatePending,
        clonedPortfolioEthereumStatePending,
        DEFI_STATE['1']
      )

      expect(result).toBe(false)
    })
  })
  describe('updatePortfolioNetworkWithDefiPositions', () => {
    const prepareTest = (state?: NetworkState, pendingState?: NetworkState) => {
      const clonedPortfolioState = structuredClone(state) as NetworkState
      const clonedPortfolioPendingState = structuredClone(pendingState) as NetworkState

      const { tokens } = calculateTokensArray(
        '1',
        clonedPortfolioState.result!.tokens,
        clonedPortfolioPendingState ? clonedPortfolioPendingState.result!.tokens : [],
        true
      )

      return { tokens }
    }
    it('should return null if the defi positions are loading/not initialized', () => {
      const { tokens } = prepareTest(PORTFOLIO_STATE['1'], PENDING_PORTFOLIO_STATE['1'])
      const result = calculateDefiPositions('1', tokens, undefined)

      expect(result).toBe(null)
    })
    it('should return null if an internal chain is passed', () => {
      const { tokens } = prepareTest(PORTFOLIO_STATE.gasTank, undefined)

      const result = calculateDefiPositions('gasTank', tokens, undefined)

      expect(result).toEqual(null)
    })
    it('should add positions to the portfolio', () => {
      const clonedPortfolioEthereumState = structuredClone(PORTFOLIO_STATE['1']) as NetworkState
      const { tokens: calculatedTokens } = prepareTest(
        clonedPortfolioEthereumState,
        PENDING_PORTFOLIO_STATE['1']
      )
      const originalTokenCount = clonedPortfolioEthereumState!.result!.tokens.length
      const { tokens, defiPositionsBalance } =
        calculateDefiPositions('1', calculatedTokens, DEFI_STATE) || {}

      // -- Defi positions are added to the portfolio

      // 5 portfolio tokens + 4 defi tokens
      expect(tokens?.length).toBe(originalTokenCount + 4)
      expect(defiPositionsBalance).toBe(250)

      // -- Protocol representations of borrowed tokens don't have prices
      const variableDebtBasGHO = tokens!.find(
        ({ address }) => address === '0x38e59ADE183BbEb94583d44213c8f3297e9933e9'
      )

      expect(variableDebtBasGHO?.priceIn.length).toBe(0)
      // Tokens added from the defi positions have latestAmount
      expect(variableDebtBasGHO?.latestAmount).toBeDefined()

      // -- Defi tokens have the respective flag
      const aBasWETH = tokens!.find(
        ({ address }) => address === '0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7'
      )

      expect(aBasWETH?.flags.defiTokenType).toBe(AssetType.Collateral)
      expect(variableDebtBasGHO?.flags.defiTokenType).toBe(AssetType.Borrow)
    })
    it('should add a price to portfolio defi tokens if the price is defined in the defi state', () => {
      const clonedPortfolioEthereumState = structuredClone(PORTFOLIO_STATE['1']) as NetworkState
      const { tokens: calculatedTokens } = prepareTest(
        clonedPortfolioEthereumState,
        PENDING_PORTFOLIO_STATE['1']
      )

      const aBasWETHWithoutPrice: TokenResult = {
        ...structuredClone(DEFI_STATE['1'].positionsByProvider[2].positions[0].assets[0]),
        flags: {
          onGasTank: false,
          rewardsType: null,
          isFeeToken: false,
          isCustom: false,
          canTopUpGasTank: false
        },
        priceIn: [],
        chainId: 1n
      }

      expect(aBasWETHWithoutPrice.priceIn.length).toBe(0)

      clonedPortfolioEthereumState.result?.tokens.push(aBasWETHWithoutPrice)

      const { tokens } = calculateDefiPositions('1', calculatedTokens, DEFI_STATE) || {}

      const aBasWETH = tokens!.findLast(
        ({ address }) => address === '0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7'
      )

      expect(aBasWETH?.flags.defiTokenType).toBe(AssetType.Collateral)
      expect(aBasWETH?.priceIn.length).toBe(1)
    })
    it('should add the value of hidden collateral tokens to the total balance', () => {
      const clonedPortfolioEthereumState = structuredClone(PORTFOLIO_STATE['1']) as NetworkState
      const { tokens: calculatedTokens } = prepareTest(
        clonedPortfolioEthereumState,
        PENDING_PORTFOLIO_STATE['1']
      )

      const originalToken = structuredClone(
        DEFI_STATE['1'].positionsByProvider[2].positions[0].assets[0]
      )
      const hiddenCollateralToken: TokenResult = {
        ...originalToken,
        flags: {
          onGasTank: false,
          rewardsType: null,
          isFeeToken: false,
          isCustom: false,
          canTopUpGasTank: false,
          isHidden: true
        },
        priceIn: [originalToken.priceIn],
        chainId: 1n
      }

      clonedPortfolioEthereumState.result?.tokens.push(hiddenCollateralToken)

      const { tokens, defiPositionsBalance } =
        calculateDefiPositions('1', calculatedTokens, DEFI_STATE) || {}

      const aBasWETH = tokens!.findLast(
        ({ address }) => address === '0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7'
      )

      expect(aBasWETH?.flags.defiTokenType).toBe(AssetType.Collateral)
      expect(aBasWETH?.priceIn.length).toBe(1)
      expect(defiPositionsBalance).toBe(250) // 10 is the original total balance
    })
  })
  describe('calculateSelectedAccountPortfolio', () => {
    it('should calculate tokens, collections and total balance correctly', () => {
      const clonedPortfolioLatestState = structuredClone(PORTFOLIO_STATE) as AccountState
      const clonedPortfolioPendingState = structuredClone(PENDING_PORTFOLIO_STATE) as AccountState
      const clonedDefiAccountState = structuredClone(DEFI_STATE) as DefiAccountState

      const { selectedAccountPortfolio } = calculateSelectedAccountPortfolio(
        clonedPortfolioLatestState,
        clonedPortfolioPendingState,
        {},
        Date.now(),
        clonedDefiAccountState,
        true
      )

      expect(selectedAccountPortfolio.tokens.length).toBe(10)
      expect(selectedAccountPortfolio.collections.length).toBe(1)
      // 10 from tokens on Ethereum, 10 from tokens on Base, 5 from gas tank and 250 from defi positions
      expect(selectedAccountPortfolio.totalBalance).toBe(10 + 10 + 5 + 250)
      expect(selectedAccountPortfolio.isAllReady).toBe(true)
      expect(selectedAccountPortfolio.networkSimulatedAccountOp['1']).toBeDefined()
    })
    it('should flip isReadyToVisualize to true if the portfolio has been loading for more than 5 seconds', () => {
      const clonedPortfolioLatestState = structuredClone(PORTFOLIO_STATE) as AccountState
      const clonedPortfolioPendingState = structuredClone(PENDING_PORTFOLIO_STATE) as AccountState
      const clonedDefiAccountState = structuredClone(DEFI_STATE) as DefiAccountState
      const portfolioStartedLoadingAtTimestamp = Date.now() - 6000

      clonedPortfolioLatestState['1']!.isLoading = true
      clonedPortfolioPendingState['1']!.isLoading = true

      const result = calculateSelectedAccountPortfolio(
        clonedPortfolioLatestState,
        clonedPortfolioPendingState,
        {},
        portfolioStartedLoadingAtTimestamp,
        clonedDefiAccountState,
        true
      )

      expect(result.selectedAccountPortfolio.isReadyToVisualize).toBe(true)
      expect(result.selectedAccountPortfolio.isAllReady).toBe(false)
    })
    it('should cache the portfolio state if pastAccountPortfolioWithDefiPositions is passed and nothing has changed', () => {
      const clonedPortfolioLatestState = structuredClone(PORTFOLIO_STATE) as AccountState
      const clonedPortfolioPendingState = structuredClone(PENDING_PORTFOLIO_STATE) as AccountState
      const clonedDefiAccountState = structuredClone(DEFI_STATE) as DefiAccountState

      // Remove the account ops. Otherwise getIsRecalculationNeeded will return true
      clonedPortfolioPendingState['1']!.accountOps = []

      const { selectedAccountPortfolioByNetworks } = calculateSelectedAccountPortfolio(
        clonedPortfolioLatestState,
        clonedPortfolioPendingState,
        {},
        Date.now(),
        clonedDefiAccountState,
        true
      )

      expect(
        getIsRecalculationNeeded(
          selectedAccountPortfolioByNetworks['1'],
          clonedPortfolioLatestState['1'],
          clonedPortfolioPendingState['1'],
          clonedPortfolioPendingState['1'],
          clonedDefiAccountState['1']
        )
      ).toBe(false)
    })
  })
})

const DEFI_TOKEN_CBTC = {
  amount: 200n,
  chainId: 8453n,
  decimals: 8,
  name: 'Aave Base cbBTC',
  symbol: 'aBascbBTC',
  address: '0xBdb9300b7CDE636d9cD4AFF00f6F009fFBBc8EE6',
  flags: {
    onGasTank: false,
    rewardsType: null,
    isFeeToken: false,
    isCustom: false,
    defiTokenType: 1,
    canTopUpGasTank: false
  },
  priceIn: [{ baseCurrency: 'usd', price: 119160.33359345 }]
}

const PORTFOLIO_STATE: AccountState = {
  '1': {
    isReady: true,
    isLoading: false,
    errors: [],
    result: {
      hintsFromExternalAPI: {
        erc20s: [],
        erc721s: {},
        lastUpdate: 1753192918712,
        skipOverrideSavedHints: false
      },
      errors: [],
      updateStarted: 1753192918299,
      discoveryTime: 415,
      oracleCallTime: 364,
      priceUpdateTime: 1585,
      priceCache: {} as PriceCache,
      tokens: [
        {
          amount: 100n,
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
          priceIn: [{ baseCurrency: 'usd', price: 3701.67 }]
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
          priceIn: [{ baseCurrency: 'usd', price: 4.46 }]
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
          priceIn: [{ baseCurrency: 'usd', price: 0.999879 }]
        },
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
            canTopUpGasTank: false
          },
          priceIn: [{ baseCurrency: 'usd', price: 310.44 }]
        },
        // Defi token
        DEFI_TOKEN_CBTC
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
      lastSuccessfulUpdate: 1753192920665,
      total: { usd: 10 }
    }
  },
  '8453': {
    isReady: true,
    isLoading: false,
    errors: [],
    result: {
      hintsFromExternalAPI: {
        erc20s: [],
        erc721s: {},
        lastUpdate: 1753192918712,
        skipOverrideSavedHints: false
      },
      errors: [],
      updateStarted: 1753192918299,
      discoveryTime: 415,
      oracleCallTime: 364,
      priceUpdateTime: 1585,
      priceCache: {} as PriceCache,
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
      lastSuccessfulUpdate: 1753192920665,
      total: { usd: 10 }
    }
  },
  gasTank: {
    isReady: true,
    isLoading: false,
    errors: [],
    result: {
      updateStarted: 1753193544309,
      lastSuccessfulUpdate: 1753193545311,
      tokens: [],
      gasTankTokens: [
        {
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          symbol: 'USDC',
          name: 'USD Coin',
          amount: 5n ** 6n,
          availableAmount: 5n ** 6n,
          cashback: 1n,
          saved: 14040n,
          decimals: 6,
          chainId: 1n,
          priceIn: [{ baseCurrency: 'usd', price: 1 }],
          flags: { onGasTank: true, rewardsType: null, isFeeToken: true, canTopUpGasTank: false }
        }
      ],
      total: { usd: 5 }
    }
  }
}

const DEFI_STATE: DefiAccountState = {
  '1': {
    providerErrors: [],
    isLoading: false,
    positionsByProvider: [
      {
        providerName: 'LIDO',
        chainId: 1n,
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
  }
}

const PENDING_PORTFOLIO_STATE = structuredClone(PORTFOLIO_STATE)
PENDING_PORTFOLIO_STATE['1']!.result!.tokens[0].amount = 10n
PENDING_PORTFOLIO_STATE['1']!.accountOps = [
  {
    accountAddr: '0x',
    chainId: 1n,
    signingKeyAddr: '0x',
    signingKeyType: 'internal',
    nonce: 10n,
    calls: [],
    gasLimit: null,
    signature: '0x',
    gasFeePayment: null,
    accountOpToExecuteBefore: null
  }
]

PENDING_PORTFOLIO_STATE['1']!.result!.blockNumber =
  PORTFOLIO_STATE['1']!.result!.blockNumber || 0 + 1
