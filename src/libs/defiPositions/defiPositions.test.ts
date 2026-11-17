import { ZeroAddress } from 'ethers'

import { describe, expect, jest, test } from '@jest/globals'

import { suppressConsole } from '../../../test/helpers/console'
import { STK_WALLET } from '../../consts/addresses'
import { NetworkState, PortfolioNetworkResult, TokenResult } from '../portfolio/interfaces'
import { PORTFOLIO_STATE } from '../portfolio/testData'
import {
  DefiUpdateMode,
  enhancePortfolioTokensWithDefiPositions,
  getAllAssetsAsHints,
  getDefiUpdateMode,
  getFormattedApiPositions,
  getNewDefiState,
  getUniqueMergedPositions
} from './defiPositions'
import { getStakedWalletPositions } from './stkWallet'
import { DEBANK_UNI_V3 } from './testData'
import { AssetType, DeFiPositionsError, PositionsByProvider } from './types'

describe('Defi positions helper and portfolio functions', () => {
  describe('enhancePortfolioTokensWithDefiPositions', () => {
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
        marketDataIn: [],
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
  describe('getDefiUpdateMode', () => {
    const buildDefiState = (
      overrides: Partial<PortfolioNetworkResult['defiPositions']> = {}
    ): PortfolioNetworkResult['defiPositions'] => {
      const portfolioState = structuredClone(
        PORTFOLIO_STATE['1']
      ) as NetworkState<PortfolioNetworkResult>

      return Object.assign(portfolioState.result!.defiPositions, overrides)
    }

    const buildParams = (
      overrides: Partial<Parameters<typeof getDefiUpdateMode>[0]> = {}
    ): Parameters<typeof getDefiUpdateMode>[0] => ({
      previousState: buildDefiState({ lastSuccessfulUpdate: Date.now() - 10000 }),
      bypassServerSideCache: false,
      isManualUpdate: false,
      hasKeys: false,
      sessionIds: [],
      hasNonceChangedSinceLastUpdate: false,
      hasScheduledUpdate: false,
      maxDataAgeMs: 60000,
      ...overrides
    })

    it('Should force when bypassServerSideCache is set, regardless of everything else', () => {
      const mode = getDefiUpdateMode(buildParams({ bypassServerSideCache: true }))

      expect(mode).toBe(DefiUpdateMode.Force)
    })
    it('Should force when the nonce has changed and no scheduled update is pending', () => {
      const mode = getDefiUpdateMode(buildParams({ hasNonceChangedSinceLastUpdate: true }))

      expect(mode).toBe(DefiUpdateMode.Force)
    })
    it('Should force on a manual update with keys and session ids when the last force update is older than the cooldown', () => {
      const mode = getDefiUpdateMode(
        buildParams({
          isManualUpdate: true,
          hasKeys: true,
          sessionIds: ['session-id-1'],
          previousState: buildDefiState({ lastForceApiUpdate: Date.now() - 31000 })
        })
      )

      expect(mode).toBe(DefiUpdateMode.Force)
    })
    it('Should force on a manual update even when a scheduled update is pending (manual updates are exempt)', () => {
      const mode = getDefiUpdateMode(
        buildParams({
          isManualUpdate: true,
          hasKeys: true,
          sessionIds: ['session-id-1'],
          hasScheduledUpdate: true,
          previousState: buildDefiState({ lastForceApiUpdate: Date.now() - 31000 })
        })
      )

      expect(mode).toBe(DefiUpdateMode.Force)
    })

    it('Should NOT force on an automatic update when a scheduled update is pending, even if the nonce has changed', () => {
      const mode = getDefiUpdateMode(
        buildParams({ hasNonceChangedSinceLastUpdate: true, hasScheduledUpdate: true })
      )

      expect(mode).not.toBe(DefiUpdateMode.Force)
    })
    it('Should NOT force on an automatic update with a pending scheduled update, even with keys/sessions and an old force update', () => {
      const mode = getDefiUpdateMode(
        buildParams({
          hasKeys: true,
          sessionIds: ['session-id-1'],
          hasScheduledUpdate: true,
          previousState: buildDefiState({
            lastSuccessfulUpdate: Date.now() - 10000,
            lastForceApiUpdate: Date.now() - 31000
          })
        })
      )

      expect(mode).not.toBe(DefiUpdateMode.Force)
    })
    it('Should NOT force on a manual update with a scheduled update pending if the last force update is within the cooldown', () => {
      const mode = getDefiUpdateMode(
        buildParams({
          isManualUpdate: true,
          hasKeys: true,
          sessionIds: ['session-id-1'],
          hasScheduledUpdate: true,
          previousState: buildDefiState({
            lastSuccessfulUpdate: Date.now() - 10000,
            lastForceApiUpdate: Date.now() - 20000
          })
        })
      )

      expect(mode).not.toBe(DefiUpdateMode.Force)
    })

    it('Should return Cache when the data is fresh enough', () => {
      const mode = getDefiUpdateMode(
        buildParams({ previousState: buildDefiState({ lastSuccessfulUpdate: Date.now() - 10000 }) })
      )

      expect(mode).toBe(DefiUpdateMode.Cache)
    })
    it('Should return Default when the data is older than maxDataAgeMs', () => {
      const mode = getDefiUpdateMode(
        buildParams({ previousState: buildDefiState({ lastSuccessfulUpdate: Date.now() - 61000 }) })
      )

      expect(mode).toBe(DefiUpdateMode.Default)
    })
    it('Should return Default when there is no previous successful update', () => {
      const mode = getDefiUpdateMode(buildParams({ previousState: undefined }))

      expect(mode).toBe(DefiUpdateMode.Default)
    })
    it('Should return Cache when freshness is disabled (maxDataAgeMs < 0)', () => {
      const mode = getDefiUpdateMode(
        buildParams({
          maxDataAgeMs: -1,
          previousState: buildDefiState({ lastSuccessfulUpdate: Date.now() - 100000000 })
        })
      )

      expect(mode).toBe(DefiUpdateMode.Cache)
    })
  })
  describe('getAllAssetsAsHints', () => {
    it('assets are returned as hints', () => {
      const state = structuredClone(PORTFOLIO_STATE['1']) as NetworkState<PortfolioNetworkResult>

      const hints = getAllAssetsAsHints(state.result?.defiPositions)

      expect(hints.length).toBe(9)
      expect(hints).not.toContain('eth')
      expect(hints).toContain('0x88800092ff476844f74dc2fc427974bbee2794ae'.toLowerCase())
      expect(hints).toContain('0x4200000000000000000000000000000000000006'.toLowerCase())
      expect(hints).toContain('0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'.toLowerCase())
      expect(hints).toContain('0x6Bb7a212910682DCFdbd5BCBb3e28FB4E8da10Ee'.toLowerCase())
      expect(hints).toContain('0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42'.toLowerCase())
    })
    it('protocol assets are returned as hints', () => {
      const state = structuredClone(PORTFOLIO_STATE['1']) as NetworkState<PortfolioNetworkResult>

      const hints = getAllAssetsAsHints(state.result?.defiPositions)

      expect(hints).toContain('0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7'.toLowerCase())
      expect(hints).toContain('0xBdb9300b7CDE636d9cD4AFF00f6F009fFBBc8EE6'.toLowerCase())
      expect(hints).toContain('0x38e59ADE183BbEb94583d44213c8f3297e9933e9'.toLowerCase())
      expect(hints).toContain('0x03D01595769333174036832e18fA2f17C74f8161'.toLowerCase())
    })
  })
  describe('getUniqueMergedPositions', () => {
    it('Debank and custom positions are merged correctly', () => {
      const debankPositions = DEBANK_UNI_V3
      const customPositions = structuredClone(DEBANK_UNI_V3)

      customPositions[0]!.source = 'custom'
      customPositions[0]!.positions[0]!.assets[0]!.amount += 1000n

      const mergedPositions = getUniqueMergedPositions(
        debankPositions,
        customPositions,
        getStakedWalletPositions({
          address: STK_WALLET,
          amount: 1000n * 10n ** 18n,
          priceIn: [{ price: 1, baseCurrency: 'usd' }],
          chainId: 1n,
          symbol: 'stkWALLET',
          name: 'Ambire Staked Wallet',
          decimals: 18,
          flags: {
            rewardsType: 'wallet-rewards',
            onGasTank: false,
            canTopUpGasTank: false,
            isFeeToken: false
          },
          marketDataIn: []
        })
      )

      expect(mergedPositions.length).toBe(2)
      expect(mergedPositions[0]!.source).toBe('custom')
      expect(
        mergedPositions[0]!.positions
          .find(({ id }) => id === 'a49f7296-ce5a-4c61-99f7-8a0698742ddf')!
          .assets.find(({ address }) => address === '0xcb555a9926eb72f1622ce9bc34a385507c9f5be2')
          ?.amount
      ).toBe(2775999n)
      expect(mergedPositions[1]?.providerName).toBe('Ambire')
    })
    it('Positions and assets are sorted by value', () => {
      const debankPositions = DEBANK_UNI_V3

      const mergedPositions = getUniqueMergedPositions(debankPositions, [], null)

      expect(mergedPositions.length).toBeGreaterThan(0)

      mergedPositions.forEach((providerPositions) => {
        let previousPositionValue = Number.POSITIVE_INFINITY

        providerPositions.positions.forEach((position) => {
          const positionValue = position.additionalData.positionInUSD || 0

          expect(positionValue).toBeLessThanOrEqual(previousPositionValue)

          previousPositionValue = positionValue

          let previousAssetValue = Number.POSITIVE_INFINITY

          position.assets.forEach((asset) => {
            const assetValue = asset.value || 0
            expect(assetValue).toBeLessThanOrEqual(previousAssetValue)
            previousAssetValue = assetValue
          })
        })
      })
    })
  })
  describe('getNewDefiState', () => {
    const getStoredPositions = (
      providerName: string,
      source: PositionsByProvider['source']
    ): PositionsByProvider => ({
      providerName,
      chainId: 1n,
      source,
      iconUrl: '',
      siteUrl: '',
      type: 'common',
      positions: [
        { id: `${providerName}-1`, additionalData: { positionIndex: '1' }, assets: [] }
      ]
    })
    const previousDebankLido = getStoredPositions('Lido', 'debank')
    const previousMixedUniV3 = getStoredPositions('Uniswap V3', 'mixed')
    const customAave = getStoredPositions('AAVE v3', 'custom')
    const getPastPortfolioState = (): PortfolioNetworkResult => {
      const ethereumState = structuredClone(
        PORTFOLIO_STATE['1']
      ) as NetworkState<PortfolioNetworkResult>

      return {
        ...ethereumState.result!,
        defiPositions: {
          ...ethereumState.result!.defiPositions,
          positionsByProvider: [previousDebankLido, previousMixedUniV3, customAave]
        }
      }
    }
    const getProviderNames = (positionsByProvider: PositionsByProvider[]) =>
      positionsByProvider.map((p) => p.providerName).sort()

    it('keeps the previous API positions when the API call is skipped', () => {
      const res = getNewDefiState(
        getPastPortfolioState(),
        null,
        [customAave],
        null,
        [],
        null,
        undefined
      )

      expect(getProviderNames(res.positionsByProvider)).toEqual(['AAVE v3', 'Lido', 'Uniswap V3'])
      expect(res.error).toBeNull()
    })
    it('keeps the previous API positions when the API call fails', () => {
      const res = getNewDefiState(
        getPastPortfolioState(),
        { data: null, discoveryTime: 0, errors: [] },
        [customAave],
        null,
        [],
        null,
        undefined
      )

      expect(getProviderNames(res.positionsByProvider)).toEqual(['AAVE v3', 'Lido', 'Uniswap V3'])
      expect(res.error).toBe(DeFiPositionsError.CriticalError)
    })
    it('replaces the previous API positions with the new ones', () => {
      const newDebankMorpho = getStoredPositions('Morpho', 'debank')
      const res = getNewDefiState(
        getPastPortfolioState(),
        {
          data: {
            hints: null,
            defi: { positions: [newDebankMorpho], updatedAt: Date.now(), isForceUpdate: false },
            otherNetworksDefiCounts: {}
          },
          discoveryTime: 0,
          errors: []
        },
        [customAave],
        null,
        [],
        null,
        undefined
      )

      expect(getProviderNames(res.positionsByProvider)).toEqual(['AAVE v3', 'Morpho'])
      expect(res.error).toBeNull()
    })
  })
  describe('getFormattedApiPositions', () => {
    it('Invalid positions are filtered out', () => {
      const { restore } = suppressConsole()
      const clonedDebankUniV3 = structuredClone(DEBANK_UNI_V3)

      // @ts-expect-error test
      delete clonedDebankUniV3[0]!.source
      // @ts-expect-error test
      delete clonedDebankUniV3[0]!.positions[0]!.additionalData

      const firstPositionId = clonedDebankUniV3[0]!.positions[0]!.id

      const formattedPositions = getFormattedApiPositions(clonedDebankUniV3)

      expect(formattedPositions.length).toBe(1)
      expect(formattedPositions[0]?.source).toBe('debank')
      expect(formattedPositions[0]!.positions.find((p) => p.id === firstPositionId)).toBeUndefined()

      restore()
    })
    it('Invalid positions are passed to onInvalidPosition, valid ones are not', () => {
      const { restore } = suppressConsole()
      const clonedDebankUniV3 = structuredClone(DEBANK_UNI_V3)
      const provider = clonedDebankUniV3[0]!
      const validPositionsCount = provider.positions.length - 1
      const onInvalidPosition = jest.fn()

      // @ts-expect-error test
      provider.positions[0]!.assets[0]!.amount = 'not an amount'

      const formattedPositions = getFormattedApiPositions(clonedDebankUniV3, onInvalidPosition)

      expect(formattedPositions[0]!.positions).toHaveLength(validPositionsCount)
      expect(onInvalidPosition).toHaveBeenCalledTimes(1)
      expect(onInvalidPosition).toHaveBeenCalledWith(
        expect.any(Error),
        'Uniswap V3',
        'Liquidity Pool'
      )

      restore()
    })
    it('Non-hex addresses are converted to ZeroAddress', () => {
      const clonedDebankUniV3 = structuredClone(DEBANK_UNI_V3)

      clonedDebankUniV3[0]!.positions[0]!.assets[0]!.address = 'eth'

      const formattedPositions = getFormattedApiPositions(clonedDebankUniV3)

      expect(formattedPositions[0]!.positions[0]!.assets[0]!.address).toBe(ZeroAddress)
    })
    it('Asset amounts are converted to BigInt', () => {
      const clonedDebankUniV3 = structuredClone(DEBANK_UNI_V3)

      // @ts-expect-error test
      clonedDebankUniV3[0]!.positions[0]!.assets[0]!.amount = 1234567890

      const formattedPositions = getFormattedApiPositions(clonedDebankUniV3)

      expect(formattedPositions[0]!.positions[0]!.assets[0]!.amount).toBe(1234567890n)
    })
    it('App chain positions with exponent amounts are kept', () => {
      const clonedDebankUniV3 = structuredClone(DEBANK_UNI_V3)
      const appChainProvider = clonedDebankUniV3[0]!
      const [firstAsset, secondAsset] = appChainProvider.positions[0]!.assets

      // App chains (like Hyperliquid) have no chainId and send decimal amounts as numbers
      // @ts-expect-error test
      delete appChainProvider.chainId
      // @ts-expect-error test
      firstAsset!.amount = 5.3e-7
      // @ts-expect-error test
      secondAsset!.amount = 1.5
      firstAsset!.decimals = 18

      const formattedPositions = getFormattedApiPositions(clonedDebankUniV3)
      const formattedPosition = formattedPositions[0]!.positions.find(
        (p) => p.id === appChainProvider.positions[0]!.id
      )

      expect(formattedPosition).toBeDefined()
      expect(formattedPosition!.assets[0]!.amount).toBe(530_000_000_000n)
      expect(formattedPosition!.assets[1]!.amount).toBe(1_500_000n)
    })
  })
})
