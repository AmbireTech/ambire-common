import { networks } from '../../consts/networks'
import { Network } from '../../interfaces/network'
import { addPortfolioError, addRPCError, SelectedAccountBalanceError } from './errors'

const mockNetworks = structuredClone(networks) as Network[]

mockNetworks.find((n) => n.chainId === 137n)!.rpcUrls = ['rpc-1', 'rpc-2']
mockNetworks.find((n) => n.chainId === 42161n)!.rpcUrls = ['rpc-1', 'rpc-2']

describe('selectedAccount errors', () => {
  describe('addRPCError', () => {
    describe('when adding RPC error for network with single RPC URL', () => {
      it('should add a new error when no existing errors', () => {
        const errors: SelectedAccountBalanceError[] = []
        const result = addRPCError(errors, '1', mockNetworks)

        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
          id: 'rpcs-down',
          networkNames: ['Ethereum'],
          type: 'error',
          title: 'Failed to retrieve network data for Ethereum (RPC malfunction)',
          text: 'Affected features: visible assets, DeFi positions, sign message/transaction, ENS domain resolving, add account.',
          actions: undefined
        })
      })

      it('should add network to existing rpcs-down error', () => {
        const existingErrors: SelectedAccountBalanceError[] = [
          {
            id: 'rpcs-down',
            networkNames: ['Ethereum'],
            type: 'error',
            title: 'Failed to retrieve network data for Ethereum (RPC malfunction)',
            text: 'Affected features: visible assets, DeFi positions, sign message/transaction, ENS domain resolving, add account.'
          }
        ]
        const result = addRPCError(existingErrors, '56', mockNetworks)

        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
          id: 'rpcs-down',
          networkNames: ['Ethereum', 'BNB Smart Chain'],
          type: 'error',
          title: 'Failed to retrieve network data for Ethereum, BNB Smart Chain (RPC malfunction)',
          text: 'Affected features: visible assets, DeFi positions, sign message/transaction, ENS domain resolving, add account.'
        })
      })

      it('should not add duplicate network names to existing error', () => {
        const existingErrors: SelectedAccountBalanceError[] = [
          {
            id: 'rpcs-down',
            networkNames: ['Ethereum'],
            type: 'error',
            title: 'Failed to retrieve network data for Ethereum (RPC malfunction)',
            text: 'Affected features: visible assets, DeFi positions, sign message/transaction, ENS domain resolving, add account.'
          }
        ]
        const result = addRPCError(existingErrors, '1', mockNetworks)

        expect(result).toHaveLength(1)
        expect(result[0].networkNames).toEqual(['Ethereum'])
        expect(result[0].title).toBe(
          'Failed to retrieve network data for Ethereum (RPC malfunction)'
        )
      })
    })

    describe('when adding RPC error for network with multiple RPC URLs', () => {
      it('should add a new custom-rpcs-down error', () => {
        const errors: SelectedAccountBalanceError[] = []
        const result = addRPCError(errors, '137', mockNetworks)

        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
          id: 'custom-rpcs-down-137',
          networkNames: ['Polygon'],
          type: 'error',
          title:
            'Failed to retrieve network data for Polygon. You can try selecting another RPC URL',
          text: 'Affected features: visible assets, DeFi positions, sign message/transaction, ENS domain resolving, add account.',
          actions: [
            {
              label: 'Select',
              actionName: 'select-rpc-url',
              meta: { network: mockNetworks[1] }
            }
          ]
        })
      })

      it('should not modify existing custom-rpcs-down error for same network', () => {
        const existingErrors: SelectedAccountBalanceError[] = [
          {
            id: 'custom-rpcs-down-137',
            networkNames: ['Polygon'],
            type: 'error',
            title:
              'Failed to retrieve network data for Polygon. You can try selecting another RPC URL',
            text: 'Affected features: visible assets, DeFi positions, sign message/transaction, ENS domain resolving, add account.',
            actions: [
              {
                label: 'Select',
                actionName: 'select-rpc-url',
                meta: { network: mockNetworks[1] }
              }
            ]
          }
        ]
        const result = addRPCError(existingErrors, '137', mockNetworks)

        expect(result).toHaveLength(1)
        expect(result[0]).toEqual(existingErrors[0])
      })

      it('should add separate custom-rpcs-down errors for different mockNetworks', () => {
        const errors: SelectedAccountBalanceError[] = []
        let result = addRPCError(errors, '137', mockNetworks)
        result = addRPCError(result, '42161', mockNetworks)

        expect(result).toHaveLength(2)
        expect(result[0].id).toBe('custom-rpcs-down-137')
        expect(result[1].id).toBe('custom-rpcs-down-42161')
        expect(result[1].networkNames).toEqual(['Arbitrum'])
      })
    })

    describe('edge cases', () => {
      it('should return an empty errors array when network is not found', () => {
        const errors: SelectedAccountBalanceError[] = []
        const result = addRPCError(errors, '999', mockNetworks)

        expect(result).toHaveLength(0)
      })

      it('should handle empty networks array', () => {
        const errors: SelectedAccountBalanceError[] = []
        const result = addRPCError(errors, '1', [])

        expect(result).toHaveLength(0)
      })

      it('should not modify original errors array', () => {
        const originalErrors: SelectedAccountBalanceError[] = []
        const result = addRPCError(originalErrors, '1', mockNetworks)

        expect(result).not.toBe(originalErrors)
        expect(originalErrors).toHaveLength(0)
        expect(result).toHaveLength(1)
        expect(result[0].networkNames).toEqual(['Ethereum'])
      })
    })

    describe('mixed error scenarios', () => {
      it('should handle both single and multiple RPC URL errors together', () => {
        const errors: SelectedAccountBalanceError[] = []
        let result = addRPCError(errors, '1', mockNetworks) // Single RPC
        result = addRPCError(result, '137', mockNetworks) // Multiple RPCs
        result = addRPCError(result, '56', mockNetworks) // Single RPC

        expect(result).toHaveLength(2)

        // Should have one rpcs-down error with both single-RPC mockNetworks
        const rpcsDownError = result.find((e) => e.id === 'rpcs-down')
        expect(rpcsDownError).toBeDefined()
        expect(rpcsDownError!.networkNames).toEqual(['Ethereum', 'BNB Smart Chain'])

        // Should have one custom error for the multiple-RPC network
        const customRpcError = result.find((e) => e.id === 'custom-rpcs-down-137')
        expect(customRpcError).toBeDefined()
        expect(customRpcError!.networkNames).toEqual(['Polygon'])
      })
    })
  })

  describe('addPortfolioError', () => {
    describe('portfolio-critical error type', () => {
      it('should add a new portfolio-critical error', () => {
        const errors: SelectedAccountBalanceError[] = []
        const result = addPortfolioError(errors, 'Ethereum', 'portfolio-critical')

        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
          id: 'portfolio-critical',
          networkNames: ['Ethereum'],
          type: 'error',
          title: 'Failed to retrieve the portfolio data',
          text: 'Account balance and visible assets may be inaccurate.'
        })
      })

      it('should add network to existing portfolio-critical error', () => {
        const existingErrors: SelectedAccountBalanceError[] = [
          {
            id: 'portfolio-critical',
            networkNames: ['Ethereum'],
            type: 'error',
            title: 'Failed to retrieve the portfolio data',
            text: 'Account balance and visible assets may be inaccurate.'
          }
        ]
        const result = addPortfolioError(existingErrors, 'Polygon', 'portfolio-critical')

        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
          id: 'portfolio-critical',
          networkNames: ['Ethereum', 'Polygon'],
          type: 'error',
          title: 'Failed to retrieve the portfolio data on Ethereum, Polygon',
          text: 'Account balance and visible assets may be inaccurate.'
        })
      })
    })

    describe('loading-too-long error type', () => {
      it('should add a new loading-too-long error', () => {
        const errors: SelectedAccountBalanceError[] = []
        const result = addPortfolioError(errors, 'BNB Smart Chain', 'loading-too-long')

        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
          id: 'loading-too-long',
          networkNames: ['BNB Smart Chain'],
          type: 'warning',
          title: 'Loading is taking longer than expected',
          text: 'Account balance and visible assets may be inaccurate.'
        })
      })

      it('should add network to existing loading-too-long error', () => {
        const existingErrors: SelectedAccountBalanceError[] = [
          {
            id: 'loading-too-long',
            networkNames: ['BNB Smart Chain'],
            type: 'warning',
            title: 'Loading is taking longer than expected',
            text: 'Account balance and visible assets may be inaccurate.'
          }
        ]
        const result = addPortfolioError(existingErrors, 'Arbitrum', 'loading-too-long')

        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
          id: 'loading-too-long',
          networkNames: ['BNB Smart Chain', 'Arbitrum'],
          type: 'warning',
          title: 'Loading is taking longer than expected on BNB Smart Chain, Arbitrum',
          text: 'Account balance and visible assets may be inaccurate.'
        })
      })
    })

    describe('PORTFOLIO_LIB_ERROR_NAMES error types', () => {
      it('should return new array for non-existent error type', () => {
        const errors: SelectedAccountBalanceError[] = []
        const result = addPortfolioError(errors, 'Ethereum', 'NonCriticalApiHintsError')

        expect(result).not.toBe(errors)
        expect(result).toHaveLength(0)
      })

      it('should add PriceFetchError', () => {
        const errors: SelectedAccountBalanceError[] = []
        const result = addPortfolioError(errors, 'Ethereum', 'PriceFetchError')

        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
          id: 'PriceFetchError',
          networkNames: ['Ethereum'],
          type: 'warning',
          title: 'Failed to retrieve prices',
          text: 'Account balance and asset prices may be inaccurate.'
        })
      })

      it('should add NoApiHintsError', () => {
        const errors: SelectedAccountBalanceError[] = []
        const result = addPortfolioError(errors, 'Polygon', 'NoApiHintsError')

        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
          id: 'NoApiHintsError',
          networkNames: ['Polygon'],
          type: 'error',
          title: 'Automatic asset discovery is temporarily unavailable',
          text: 'Your funds are safe, but your portfolio will be inaccurate. You can add assets manually or wait for the issue to be resolved.'
        })
      })

      it('should add StaleApiHintsError', () => {
        const errors: SelectedAccountBalanceError[] = []
        const result = addPortfolioError(errors, 'BNB Smart Chain', 'StaleApiHintsError')

        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
          id: 'StaleApiHintsError',
          networkNames: ['BNB Smart Chain'],
          type: 'warning',
          title: 'Automatic asset discovery is temporarily unavailable',
          text: 'New assets may not be visible in your portfolio. You can add assets manually or wait for the issue to be resolved.'
        })
      })
    })

    describe('title formatting with multiple mockNetworks', () => {
      it('should handle title that already contains " on " when adding mockNetworks', () => {
        const existingErrors: SelectedAccountBalanceError[] = [
          {
            id: 'portfolio-critical',
            networkNames: ['Ethereum'],
            type: 'error',
            title: 'Failed to retrieve the portfolio data on Ethereum',
            text: 'Account balance and visible assets may be inaccurate.'
          }
        ]
        const result = addPortfolioError(existingErrors, 'Polygon', 'portfolio-critical')

        expect(result[0].title).toBe('Failed to retrieve the portfolio data on Ethereum, Polygon')
      })

      it('should handle title without " on " when adding mockNetworks', () => {
        const existingErrors: SelectedAccountBalanceError[] = [
          {
            id: 'portfolio-critical',
            networkNames: ['Ethereum'],
            type: 'error',
            title: 'Failed to retrieve the portfolio data',
            text: 'Account balance and visible assets may be inaccurate.'
          }
        ]
        const result = addPortfolioError(existingErrors, 'Polygon', 'portfolio-critical')

        expect(result[0].title).toBe('Failed to retrieve the portfolio data on Ethereum, Polygon')
      })

      it('should handle multiple " on " occurrences correctly', () => {
        const existingErrors: SelectedAccountBalanceError[] = [
          {
            id: 'loading-too-long',
            networkNames: ['Network One'],
            type: 'warning',
            title: 'Something went wrong on Network One',
            text: 'Test error'
          }
        ]
        const result = addPortfolioError(existingErrors, 'Network Two', 'loading-too-long')

        expect(result[0].title).toBe('Something went wrong on Network One, Network Two')
      })
    })

    describe('different error types in same array', () => {
      it('should handle multiple different error types', () => {
        const errors: SelectedAccountBalanceError[] = []
        let result = addPortfolioError(errors, 'Ethereum', 'portfolio-critical')
        result = addPortfolioError(result, 'Polygon', 'loading-too-long')
        result = addPortfolioError(result, 'BNB Smart Chain', 'PriceFetchError')

        expect(result).toHaveLength(3)
        expect(result[0].id).toBe('portfolio-critical')
        expect(result[1].id).toBe('loading-too-long')
        expect(result[2].id).toBe('PriceFetchError')
      })

      it('should add to existing error of same type while having other types', () => {
        const errors: SelectedAccountBalanceError[] = []
        let result = addPortfolioError(errors, 'Ethereum', 'portfolio-critical')
        result = addPortfolioError(result, 'Polygon', 'loading-too-long')
        result = addPortfolioError(result, 'BNB Smart Chain', 'portfolio-critical') // Same type as first

        expect(result).toHaveLength(2)
        expect(result[0].networkNames).toEqual(['Ethereum', 'BNB Smart Chain'])
        expect(result[1].networkNames).toEqual(['Polygon'])
      })
    })

    describe('edge cases and error handling', () => {
      it('should handle empty network name', () => {
        const errors: SelectedAccountBalanceError[] = []
        const result = addPortfolioError(errors, '', 'portfolio-critical')

        expect(result).toHaveLength(1)
        expect(result[0].networkNames).toEqual([''])
      })

      it('should create new array (function does not mutate input)', () => {
        const originalErrors: SelectedAccountBalanceError[] = []
        const result = addPortfolioError(originalErrors, 'Ethereum', 'portfolio-critical')

        expect(result).not.toBe(originalErrors)
        expect(originalErrors).toHaveLength(0)
        expect(result).toHaveLength(1)
      })
      it('should handle adding same network multiple times to same error type', () => {
        const errors: SelectedAccountBalanceError[] = []
        let result = addPortfolioError(errors, 'Ethereum', 'portfolio-critical')
        result = addPortfolioError(result, 'Ethereum', 'portfolio-critical')

        expect(result).toHaveLength(1)
        expect(result[0].networkNames).toEqual(['Ethereum'])
      })
    })
  })
})
