import { AccountState } from '../portfolio/interfaces'
/* eslint-disable @typescript-eslint/no-use-before-define */
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
        true
      )

      expect(selectedAccountPortfolio.tokens.length).toBe(9)
      expect(selectedAccountPortfolio.collections.length).toBe(1)
      // 10 from tokens on Ethereum, 10 from tokens on Base, 5 from gas tank and 250 from defi positions
      expect(selectedAccountPortfolio.totalBalance).toBe(260 + 10 + 5)
      expect(selectedAccountPortfolio.isAllReady).toBe(true)
      expect(selectedAccountPortfolio.networkSimulatedAccountOp['1']).toBeDefined()
    })
    it('should flip isReadyToVisualize to true if the portfolio has been loading for more than 5 seconds', () => {
      const clonedPortfolioLatestState = structuredClone(PORTFOLIO_STATE) as AccountState

      clonedPortfolioLatestState['1']!.isLoading = true

      const result = calculateSelectedAccountPortfolio(clonedPortfolioLatestState, true, true)

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
        false
      )

      // isAllReady should be true because both states are ready
      expect(selectedAccountPortfolio.isAllReady).toBe(true)

      // Manual update
      const selectedAccountPortfolio2 = calculateSelectedAccountPortfolio(
        clonedPortfolioLatestState,
        false,
        true
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
        false
      )

      expect(selectedAccountPortfolio.isReloading).toBe(false)
      expect(selectedAccountPortfolio.isAllReady).toBe(true)
    })
  })
})
