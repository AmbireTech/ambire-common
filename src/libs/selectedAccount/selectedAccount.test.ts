import { getTotal } from '../portfolio/helpers'
import { AccountState, PortfolioNetworkResult } from '../portfolio/interfaces'

import { PORTFOLIO_STATE } from '../portfolio/testData'
import { calculateSelectedAccountPortfolio, stripPortfolioState } from './selectedAccount'

describe('Selected Account lib', () => {
  it('stripPortfolioState works as expected', () => {
    const strippedState = stripPortfolioState({
      '1': PORTFOLIO_STATE['1']
    })

    expect(strippedState['1']?.result).toBeDefined()
    const result = strippedState['1']?.result || {}

    expect('tokens' in result).toBe(false)
    expect('collections' in result).toBe(false)
    expect('lastExternalApiUpdateData' in result).toBe(false)
  })
  describe('calculateSelectedAccountPortfolio', () => {
    it('should calculate tokens, collections and total balance correctly', () => {
      const clonedPortfolioLatestState = structuredClone(PORTFOLIO_STATE) as AccountState

      const selectedAccountPortfolio = calculateSelectedAccountPortfolio(
        clonedPortfolioLatestState,
        false,
        true,
        false
      )

      expect(selectedAccountPortfolio.tokens.length).toBe(8)
      expect(selectedAccountPortfolio.collections.length).toBe(1)
      // 10 from tokens on Ethereum, 10 from tokens on Base, 5 from gas tank and 250 from defi
      // positions, which count the $30 Aave loan as they don't subtract loans by default
      expect(selectedAccountPortfolio.totalBalance).toBe(230 + 30 + 10 + 5)
      expect(selectedAccountPortfolio.isAllReady).toBe(true)
      expect(selectedAccountPortfolio.networkSimulatedAccountOp['1']).toBeDefined()
    })
    it.each([
      ['with its supplied token in the wallet, like Aave v3', true],
      ['known only from the app, like Morpho', false]
    ])(
      'should count a lending position %s at its net value only when asked to subtract loans',
      (_, isSuppliedTokenPriced) => {
        const portfolioState = structuredClone(PORTFOLIO_STATE) as AccountState
        const ethereumResult = portfolioState['1']!.result as PortfolioNetworkResult
        // Without a price the aBasWETH doesn't count, so the position is counted from the app
        if (!isSuppliedTokenPriced) {
          ethereumResult.tokens = ethereumResult.tokens.map((token) =>
            token.symbol === 'aBasWETH' ? { ...token, priceIn: [] } : token
          )
        }
        ethereumResult.total = getTotal(ethereumResult.tokens, ethereumResult.defiPositions)
        const netEthereumBalance = ethereumResult.total.usd || 0

        const withLoans = calculateSelectedAccountPortfolio(portfolioState, false, true, false)
        const withoutLoans = calculateSelectedAccountPortfolio(portfolioState, false, true, true)

        // $30 borrowed against the Aave position on Ethereum
        expect(withoutLoans.balancePerNetwork['1']).toBeCloseTo(netEthereumBalance)
        expect(withLoans.balancePerNetwork['1']).toBeCloseTo(netEthereumBalance + 30)
        expect(withLoans.totalBalance).toBeCloseTo(withoutLoans.totalBalance + 30)
        expect(withLoans.balancePerNetwork['8453']).toBe(withoutLoans.balancePerNetwork['8453'])
        // The DeFi tab shows the value the total counts
        const getAave = ({ defiPositions }: typeof withLoans) =>
          defiPositions.find(({ providerName }) => providerName === 'AAVE v3')!
        expect(getAave(withoutLoans).balanceInUSD).toBe(170)
        expect(getAave(withLoans).balanceInUSD).toBe(200)
        expect(getAave(withLoans).positions[0]!.balanceInUSD).toBe(200)
      }
    )
    it('should flip isReadyToVisualize to true if the portfolio has been loading for more than 5 seconds', () => {
      const clonedPortfolioLatestState = structuredClone(PORTFOLIO_STATE) as AccountState

      clonedPortfolioLatestState['1']!.isLoading = true

      const result = calculateSelectedAccountPortfolio(
        clonedPortfolioLatestState,
        true,
        true,
        false
      )

      expect(result.isReadyToVisualize).toBe(true)
      expect(result.isAllReady).toBe(false)
    })
    it('Portfolio state is not ready - should be isAllReady false', () => {
      const clonedPortfolioLatestState = structuredClone(PORTFOLIO_STATE) as AccountState

      Object.keys(clonedPortfolioLatestState).forEach((chainId) => {
        clonedPortfolioLatestState[chainId]!.isReady = false
      })

      const selectedAccountPortfolio = calculateSelectedAccountPortfolio(
        clonedPortfolioLatestState,
        false,
        false,
        false
      )

      expect(selectedAccountPortfolio.isAllReady).toBe(false)
      expect(selectedAccountPortfolio.isReloading).toBe(false)
    })
    it('Manual update: the state is ready, but loading - should be isAllReady false', () => {
      const clonedPortfolioLatestState = structuredClone(PORTFOLIO_STATE) as AccountState

      Object.keys(clonedPortfolioLatestState).forEach((chainId) => {
        clonedPortfolioLatestState[chainId]!.isLoading = true
      })

      // Not a manual update
      const selectedAccountPortfolio = calculateSelectedAccountPortfolio(
        clonedPortfolioLatestState,
        false,
        false,
        false
      )

      // isAllReady should be true because both states are ready
      expect(selectedAccountPortfolio.isAllReady).toBe(true)

      // Manual update
      const selectedAccountPortfolio2 = calculateSelectedAccountPortfolio(
        clonedPortfolioLatestState,
        false,
        true,
        false
      )

      // isAllReady should be false because it's a manual update
      expect(selectedAccountPortfolio2.isAllReady).toBe(false)
    })
    it('Portfolio is ready, state is older than 60min and loading - isReloading should be true', () => {
      const clonedPortfolioLatestState = structuredClone(PORTFOLIO_STATE) as AccountState

      const sixtyMinutesAndOneSecondAgo = Date.now() - 60 * 60 * 1000 - 1000

      Object.keys(clonedPortfolioLatestState).forEach((chainId) => {
        clonedPortfolioLatestState[chainId]!.isLoading = true
        clonedPortfolioLatestState[chainId]!.lastSuccessfulUpdate = sixtyMinutesAndOneSecondAgo
      })

      const selectedAccountPortfolio = calculateSelectedAccountPortfolio(
        clonedPortfolioLatestState,
        false,
        false,
        false
      )

      expect(selectedAccountPortfolio.isReloading).toBe(true)
      expect(selectedAccountPortfolio.isAllReady).toBe(true)
    })
    it('Portfolio is ready, state is fresh and loading - isReloading should be false', () => {
      const clonedPortfolioLatestState = structuredClone(PORTFOLIO_STATE) as AccountState

      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000

      Object.keys(clonedPortfolioLatestState).forEach((chainId) => {
        clonedPortfolioLatestState[chainId]!.isLoading = true
        clonedPortfolioLatestState[chainId]!.lastSuccessfulUpdate = fiveMinutesAgo
      })

      const selectedAccountPortfolio = calculateSelectedAccountPortfolio(
        clonedPortfolioLatestState,
        false,
        false,
        false
      )

      expect(selectedAccountPortfolio.isReloading).toBe(false)
      expect(selectedAccountPortfolio.isAllReady).toBe(true)
    })
  })
})
