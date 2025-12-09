import { networks } from '../../consts/networks'
import { Network } from '../../interfaces/network'
/* eslint-disable no-param-reassign */
import { RPCProvider } from '../../interfaces/provider'
import {
  SelectedAccountPortfolio,
  SelectedAccountPortfolioState
} from '../../interfaces/selectedAccount'
import { getRpcProvider } from '../../services/provider'
import {
  addPortfolioError,
  addRPCError,
  getNetworksWithErrors,
  SelectedAccountBalanceError
} from './errors'

const mockNetworks = structuredClone(networks) as Network[]

mockNetworks.find((n) => n.chainId === 137n)!.rpcUrls = ['rpc-1', 'rpc-2']
mockNetworks.find((n) => n.chainId === 42161n)!.rpcUrls = ['rpc-1', 'rpc-2']

const mockProviders = mockNetworks.reduce((acc, network) => {
  acc[network.chainId.toString()] = getRpcProvider(
    network.rpcUrls,
    network.chainId,
    network.selectedRpcUrl
  )
  acc[network.chainId.toString()]!.isWorking = true
  return acc
}, {} as Record<string, RPCProvider>)

const mockAccountState = mockNetworks.reduce((acc, network) => {
  acc[network.chainId.toString()] = {
    updatedAt: Date.now()
  }

  return acc
}, {} as any)

const getMockSelectedAccountPortfolio = (params?: {
  loadingChainIds?: bigint[]
  notReadyChainIds?: bigint[]
  criticalErrorChainIds?: bigint[]
  freshDataChainIds?: bigint[]
  nonCriticalErrorChainIds?: bigint[]
}): SelectedAccountPortfolioState => {
  const {
    loadingChainIds,
    notReadyChainIds,
    nonCriticalErrorChainIds,
    freshDataChainIds,
    criticalErrorChainIds
  } = params || {}

  return networks.reduce((acc, network) => {
    acc[network.chainId.toString()] = {
      isLoading: !!loadingChainIds?.includes(network.chainId),
      isReady: !!notReadyChainIds?.includes(network.chainId),
      result: {
        lastSuccessfulUpdate: !freshDataChainIds?.includes(network.chainId)
          ? Date.now() - 60 * 60 * 1000
          : Date.now() - 5 * 60 * 1000
      } as any,
      criticalError: criticalErrorChainIds?.includes(network.chainId)
        ? new Error('Critical portfolio error')
        : undefined,
      errors: nonCriticalErrorChainIds?.includes(network.chainId)
        ? [
            {
              message: "Some message, doesn't matter",
              name: 'PriceFetchError',
              level: 'warning'
            }
          ]
        : []
    }
    return acc
  }, {} as SelectedAccountPortfolio['portfolioState'])
}

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
        expect(result[0]!.networkNames).toEqual(['Ethereum'])
        expect(result[0]!.title).toBe(
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
        expect(result[0]!.id).toBe('custom-rpcs-down-137')
        expect(result[1]!.id).toBe('custom-rpcs-down-42161')
        expect(result[1]!.networkNames).toEqual(['Arbitrum'])
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
        expect(result[0]!.networkNames).toEqual(['Ethereum'])
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
          title: 'Failed to retrieve the portfolio data on Ethereum',
          text: 'Account balance and visible assets may be inaccurate.'
        })
      })

      it('should add network to existing portfolio-critical error', () => {
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
          title: 'Loading is taking longer than expected on BNB Smart Chain',
          text: 'Account balance and visible assets may be inaccurate.'
        })
      })

      it('should add network to existing loading-too-long error', () => {
        const existingErrors: SelectedAccountBalanceError[] = [
          {
            id: 'loading-too-long',
            networkNames: ['BNB Smart Chain'],
            type: 'warning',
            title: 'Loading is taking longer than expected on BNB Smart Chain',
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
          title: 'Failed to retrieve prices on Ethereum',
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
          title: 'Automatic asset discovery is temporarily unavailable on Polygon',
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
          title: 'Automatic asset discovery is temporarily unavailable on BNB Smart Chain',
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

        expect(result[0]!.title).toBe('Failed to retrieve the portfolio data on Ethereum, Polygon')
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

        expect(result[0]!.title).toBe('Something went wrong on Network One, Network Two')
      })
    })

    describe('different error types in same array', () => {
      it('should handle multiple different error types', () => {
        const errors: SelectedAccountBalanceError[] = []
        let result = addPortfolioError(errors, 'Ethereum', 'portfolio-critical')
        result = addPortfolioError(result, 'Polygon', 'loading-too-long')
        result = addPortfolioError(result, 'BNB Smart Chain', 'PriceFetchError')

        expect(result).toHaveLength(3)
        expect(result[0]!.id).toBe('portfolio-critical')
        expect(result[1]!.id).toBe('loading-too-long')
        expect(result[2].id).toBe('PriceFetchError')
      })

      it('should add to existing error of same type while having other types', () => {
        const errors: SelectedAccountBalanceError[] = []
        let result = addPortfolioError(errors, 'Ethereum', 'portfolio-critical')
        result = addPortfolioError(result, 'Polygon', 'loading-too-long')
        result = addPortfolioError(result, 'BNB Smart Chain', 'portfolio-critical') // Same type as first

        expect(result).toHaveLength(2)
        expect(result[0]!.networkNames).toEqual(['Ethereum', 'BNB Smart Chain'])
        expect(result[1]!.networkNames).toEqual(['Polygon'])
      })
    })

    describe('edge cases and error handling', () => {
      it('should handle empty network name', () => {
        const errors: SelectedAccountBalanceError[] = []
        const result = addPortfolioError(errors, '', 'portfolio-critical')

        expect(result).toHaveLength(1)
        expect(result[0]!.networkNames).toEqual([''])
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
        expect(result[0]!.networkNames).toEqual(['Ethereum'])
      })
    })
  })
  describe('getNetworksWithErrors', () => {
    it('all providers are not working - no errors are returned because the user is offline', () => {
      const providers = structuredClone(mockProviders)
      Object.values(providers).forEach((p) => {
        p.isWorking = false
      })

      const errors = getNetworksWithErrors({
        networks: mockNetworks,
        selectedAccountPortfolioState: getMockSelectedAccountPortfolio({
          criticalErrorChainIds: [1n, 137n]
        }),
        isAllReady: true,
        shouldShowPartialResult: false,
        providers,
        accountState: mockAccountState,
        networksWithAssets: {}
      })

      expect(errors).toHaveLength(0)
    })
    it('critical portfolio error', () => {
      const errors = getNetworksWithErrors({
        networks: mockNetworks,
        selectedAccountPortfolioState: getMockSelectedAccountPortfolio({
          criticalErrorChainIds: [1n, 137n]
        }),
        isAllReady: true,
        shouldShowPartialResult: false,
        providers: mockProviders,
        accountState: mockAccountState,
        networksWithAssets: { '1': true, '137': true }
      })

      expect(errors).toHaveLength(1)
      expect(errors[0]!.id).toBe('portfolio-critical')
      expect(errors[0]!.networkNames).toEqual(['Ethereum', 'Polygon'])
    })
    it('rpc down errors are added in favour of portfolio errors', () => {
      const providers = structuredClone(mockProviders)
      providers['1'].isWorking = false
      providers['56'].isWorking = false

      const errors = getNetworksWithErrors({
        networks: mockNetworks,
        selectedAccountPortfolioState: getMockSelectedAccountPortfolio({
          criticalErrorChainIds: [1n, 56n]
        }),
        isAllReady: true,
        shouldShowPartialResult: false,
        providers,
        accountState: mockAccountState,
        networksWithAssets: { '1': true, '56': true }
      })

      expect(errors).toHaveLength(1)
      expect(errors[0]!.id).toBe('rpcs-down')
      expect(errors[0]!.networkNames).toEqual(['Ethereum', 'BNB Smart Chain'])
    })
    it('no errors are added when the state is fresh (not Ethereum)', () => {
      const errors = getNetworksWithErrors({
        networks: mockNetworks,
        selectedAccountPortfolioState: getMockSelectedAccountPortfolio({
          freshDataChainIds: [56n, 137n],
          criticalErrorChainIds: [56n]
        }),
        isAllReady: true,
        shouldShowPartialResult: false,
        providers: mockProviders,
        accountState: mockAccountState,
        networksWithAssets: { '56': true, '137': true }
      })

      expect(errors).toHaveLength(0)
    })
    it('errors are added even when the state is fresh (Ethereum)', () => {
      const errors = getNetworksWithErrors({
        networks: mockNetworks,
        selectedAccountPortfolioState: getMockSelectedAccountPortfolio({
          freshDataChainIds: [1n, 56n, 137n],
          criticalErrorChainIds: [1n]
        }),
        isAllReady: true,
        shouldShowPartialResult: false,
        providers: mockProviders,
        accountState: mockAccountState,
        networksWithAssets: { '1': true, '56': true, '137': true }
      })

      expect(errors).toHaveLength(1)
      expect(errors[0]!.id).toBe('portfolio-critical')
      expect(errors[0]!.networkNames).toEqual(['Ethereum'])
    })
    it('no errors are added when the portfolio is loading from scratch', () => {
      const providers = structuredClone(mockProviders)
      providers['1'].isWorking = false
      providers['56'].isWorking = false

      const errors = getNetworksWithErrors({
        networks: mockNetworks,
        selectedAccountPortfolioState: getMockSelectedAccountPortfolio({
          loadingChainIds: [1n, 56n],
          criticalErrorChainIds: [1n, 56n]
        }),
        isAllReady: false,
        shouldShowPartialResult: false,
        providers,
        accountState: mockAccountState,
        networksWithAssets: { '1': true, '56': true }
      })

      expect(errors).toHaveLength(0)
    })
    it('critical portfolio error and the rpc is not working, but the user has no assets', () => {
      const providers = structuredClone(mockProviders)
      providers['137'].isWorking = false

      const errors = getNetworksWithErrors({
        networks: mockNetworks,
        selectedAccountPortfolioState: getMockSelectedAccountPortfolio({
          criticalErrorChainIds: [137n]
        }),
        isAllReady: true,
        shouldShowPartialResult: false,
        providers,
        accountState: mockAccountState,
        networksWithAssets: { '137': false }
      })

      expect(errors).toHaveLength(0)
    })
    it("critical portfolio error, but we don't know if the user has assets", () => {
      const errors = getNetworksWithErrors({
        networks: mockNetworks,
        selectedAccountPortfolioState: getMockSelectedAccountPortfolio({
          criticalErrorChainIds: [137n]
        }),
        isAllReady: true,
        shouldShowPartialResult: false,
        providers: mockProviders,
        accountState: mockAccountState,
        networksWithAssets: {}
      })

      expect(errors).toHaveLength(1)
      expect(errors[0]!.id).toBe('portfolio-critical')
      expect(errors[0]!.networkNames).toEqual(['Polygon'])
    })
    it('non-critical portfolio errors', () => {
      const errors = getNetworksWithErrors({
        networks: mockNetworks,
        selectedAccountPortfolioState: getMockSelectedAccountPortfolio({
          nonCriticalErrorChainIds: [1n, 137n],
          criticalErrorChainIds: [1n]
        }),
        isAllReady: true,
        shouldShowPartialResult: false,
        providers: mockProviders,
        accountState: mockAccountState,
        networksWithAssets: { '1': true, '137': true }
      })

      expect(errors).toHaveLength(2)

      expect(errors[0]!.id).toBe('portfolio-critical')
      expect(errors[0]!.networkNames).toEqual(['Ethereum'])

      expect(errors[1]!.id).toBe('PriceFetchError')
      expect(errors[1]!.networkNames).toEqual(['Polygon'])
    })
    it('no errors are added for loading networks if (isAllReady=false)', () => {
      const errors = getNetworksWithErrors({
        networks: mockNetworks,
        selectedAccountPortfolioState: getMockSelectedAccountPortfolio({
          loadingChainIds: [1n, 56n],
          criticalErrorChainIds: [1n, 56n]
        }),
        isAllReady: false,
        shouldShowPartialResult: false,
        providers: mockProviders,
        accountState: mockAccountState,
        networksWithAssets: { '1': true, '56': true }
      })

      expect(errors).toHaveLength(0)
    })
    it('errors are added for loading networks if (isAllReady=true)', () => {
      const errors = getNetworksWithErrors({
        networks: mockNetworks,
        selectedAccountPortfolioState: getMockSelectedAccountPortfolio({
          loadingChainIds: [1n, 56n],
          criticalErrorChainIds: [1n, 56n]
        }),
        isAllReady: true,
        shouldShowPartialResult: false,
        providers: mockProviders,
        accountState: mockAccountState,
        networksWithAssets: { '1': true, '56': true }
      })

      expect(errors).toHaveLength(1)

      expect(errors[0]!.id).toBe('portfolio-critical')
    })
    it('loading-too-long error is added for loading networks if isAllReady=false and shouldShowPartialResult=true', () => {
      const errors = getNetworksWithErrors({
        networks: mockNetworks,
        selectedAccountPortfolioState: getMockSelectedAccountPortfolio({
          loadingChainIds: [1n, 56n]
        }),
        isAllReady: false,
        shouldShowPartialResult: true,
        providers: mockProviders,
        accountState: mockAccountState,
        networksWithAssets: { '1': true, '56': true }
      })

      expect(errors).toHaveLength(1)

      expect(errors[0]!.id).toBe('loading-too-long')
      expect(errors[0]!.networkNames).toEqual(['Ethereum', 'BNB Smart Chain'])
    })
    it('loading-too-long error is not added for loading networks if isAllReady=true and shouldShowPartialResult=true', () => {
      const errors = getNetworksWithErrors({
        networks: mockNetworks,
        selectedAccountPortfolioState: getMockSelectedAccountPortfolio({
          loadingChainIds: [1n, 56n]
        }),
        isAllReady: true,
        shouldShowPartialResult: true,
        providers: mockProviders,
        accountState: mockAccountState,
        networksWithAssets: { '1': true, '56': true }
      })

      expect(errors).toHaveLength(0)
    })
  })
})
