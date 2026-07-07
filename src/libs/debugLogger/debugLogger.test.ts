import {
  createScopedDebugLogger,
  debugLog,
  debugLoggerRegistry,
  SEED_NAMESPACES
} from './debugLogger'

const USDC = {
  address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  symbol: 'USDC',
  chainId: '1'
}
const WETH = {
  address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  symbol: 'WETH',
  chainId: '1'
}

// Each log line embeds Date.now(), so pin it to keep exact-match assertions stable.
const NOW = 1700000000000

describe('debugLogger', () => {
  let logSpy: jest.SpyInstance
  let warnSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance

  beforeEach(() => {
    // The registry is a module-level singleton, so reset the toggles and buffers
    // between tests. hydrate({}) clears the enabled set; clear() empties the buffers.
    debugLoggerRegistry.hydrate({})
    debugLoggerRegistry.clear()
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(Date, 'now').mockReturnValue(NOW)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('toggle gating', () => {
    it('stays completely silent for a controller that is switched off', () => {
      debugLog(
        'PortfolioController',
        'simulating account op',
        { accountOps: 2 },
        { flow: 'simulation' }
      )

      expect(logSpy).not.toHaveBeenCalled()
      expect(debugLoggerRegistry.read('PortfolioController')).toHaveLength(0)
    })

    it('does not evaluate the lazy payload function while disabled', () => {
      const buildExpensivePayload = jest.fn(() => ({ tokens: 5000 }))

      debugLog('PortfolioController', 'portfolio fetched', buildExpensivePayload, { flow: 'fetch' })

      expect(buildExpensivePayload).not.toHaveBeenCalled()
    })

    it('starts logging the moment the controller is enabled and goes quiet again when disabled', () => {
      debugLoggerRegistry.setEnabled('AccountsController', true)
      debugLog('AccountsController', 'accounts reloaded', { count: 3 }, { flow: 'update' })
      expect(logSpy).toHaveBeenCalledTimes(1)

      debugLoggerRegistry.setEnabled('AccountsController', false)
      debugLog('AccountsController', 'accounts reloaded again', { count: 4 }, { flow: 'update' })
      expect(logSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('log line format and buffering', () => {
    beforeEach(() => debugLoggerRegistry.setEnabled('PortfolioController', true))

    it('tags the line with the Controller:flow scope and appends the serialized payload', () => {
      debugLog('PortfolioController', 'filtered token', USDC, { flow: 'blacklist' })

      const expected =
        `Debug: PortfolioController:blacklist (at ${NOW}) filtered token ` +
        '{"address":"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48","symbol":"USDC","chainId":"1"}'
      expect(logSpy).toHaveBeenCalledWith(expected)
      expect(debugLoggerRegistry.read('PortfolioController')).toEqual([expected])
    })

    it('omits the flow tag when no flow is given', () => {
      debugLog('PortfolioController', 'update queued')

      expect(logSpy).toHaveBeenCalledWith(
        `Debug: PortfolioController (at ${NOW}) update queued No payload (perhaps an error?)`
      )
    })

    it('resolves a thunk payload so callers can defer building it until logging is on', () => {
      const buildPayload = jest.fn(() => ({ symbol: 'DAI', chainId: '1' }))

      debugLog('PortfolioController', 'token learned', buildPayload, { flow: 'learnedTokens' })

      expect(buildPayload).toHaveBeenCalledTimes(1)
      expect(debugLoggerRegistry.read('PortfolioController')[0]).toBe(
        `Debug: PortfolioController:learnedTokens (at ${NOW}) token learned {"symbol":"DAI","chainId":"1"}`
      )
    })

    it('prefixes a traceId when given, to correlate one flow across controllers', () => {
      debugLoggerRegistry.setEnabled('SignAccountOpController', true)

      debugLog(
        'SignAccountOpController',
        'user op submitted',
        { hash: '0xfeed' },
        { flow: 'broadcast', traceId: 'op-7f3a' }
      )

      expect(debugLoggerRegistry.read('SignAccountOpController')[0]).toBe(
        `Debug: op-7f3a:SignAccountOpController:broadcast (at ${NOW}) user op submitted {"hash":"0xfeed"}`
      )
    })

    it('routes warn-level lines to console.warn instead of console.log', () => {
      debugLoggerRegistry.setEnabled('GasPriceController', true)

      debugLog('GasPriceController', 'rpc gas estimate slow', undefined, {
        flow: 'fetch',
        level: 'warn'
      })

      expect(warnSpy).toHaveBeenCalledWith(
        `Debug: GasPriceController:fetch (at ${NOW}) rpc gas estimate slow No payload (perhaps an error?)`
      )
      expect(logSpy).not.toHaveBeenCalled()
    })

    it('stores the serialized string in the buffer, not the live object reference', () => {
      const mutablePayload = { symbol: 'USDC', chainId: '1' }
      debugLog('PortfolioController', 'fetched', mutablePayload, { flow: 'fetch' })
      mutablePayload.symbol = 'MUTATED'

      expect(debugLoggerRegistry.read('PortfolioController')[0]).toContain('"symbol":"USDC"')
      expect(debugLoggerRegistry.read('PortfolioController')[0]).not.toContain('MUTATED')
    })
  })

  describe('payload serialization', () => {
    beforeEach(() => debugLoggerRegistry.setEnabled('PortfolioController', true))

    it('serializes a bigint amount without throwing', () => {
      debugLog(
        'PortfolioController',
        'native balance',
        { wei: 1500000000000000000n },
        { flow: 'fetch' }
      )

      expect(debugLoggerRegistry.read('PortfolioController')[0]).toBe(
        `Debug: PortfolioController:fetch (at ${NOW}) native balance {"wei":{"$bigint":"1500000000000000000"}}`
      )
    })

    it('catches a payload thunk that throws - logs the error and still records the line without a payload', () => {
      const explodingThunk = jest.fn(() => {
        throw new Error('balance fetch failed')
      })

      expect(() =>
        debugLog('PortfolioController', 'reading balances', explodingThunk, { flow: 'fetch' })
      ).not.toThrow()

      expect(errorSpy).toHaveBeenCalledWith(
        'Debug: PortfolioController:fetch payload function threw',
        expect.any(Error)
      )
      expect(debugLoggerRegistry.read('PortfolioController')[0]).toBe(
        `Debug: PortfolioController:fetch (at ${NOW}) reading balances No payload (perhaps an error?)`
      )
    })

    it('falls back to a placeholder when a payload cannot be serialized', () => {
      const payloadThatThrowsOnRead = {
        get balance() {
          throw new Error('getter blew up')
        }
      }

      debugLog('PortfolioController', 'reading balance', payloadThatThrowsOnRead, { flow: 'fetch' })

      expect(debugLoggerRegistry.read('PortfolioController')[0]).toBe(
        `Debug: PortfolioController:fetch (at ${NOW}) reading balance [unserializable payload]`
      )
    })

    it('preserves nested objects and arrays - the token list a portfolio "fetch" log is meant to show', () => {
      debugLog(
        'PortfolioController',
        'portfolio fetched',
        {
          chainId: '1',
          tokens: [USDC, WETH],
          totalMs: 42
        },
        { flow: 'fetch' }
      )

      expect(debugLoggerRegistry.read('PortfolioController')[0]).toBe(
        `Debug: PortfolioController:fetch (at ${NOW}) portfolio fetched ` +
          '{"chainId":"1","tokens":[' +
          '{"address":"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48","symbol":"USDC","chainId":"1"},' +
          '{"address":"0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2","symbol":"WETH","chainId":"1"}' +
          '],"totalMs":42}'
      )
    })
  })

  describe('per-namespace ring buffer', () => {
    it('caps a namespace at 200 lines, evicting the oldest first', () => {
      debugLoggerRegistry.setEnabled('ActivityController', true)
      for (let i = 0; i < 220; i++) {
        debugLog('ActivityController', `tx #${i} broadcast`, undefined, { flow: 'submitted' })
      }

      const buffer = debugLoggerRegistry.read('ActivityController')
      expect(buffer).toHaveLength(200)
      expect(buffer[0]).toContain('tx #20 broadcast') // 0..19 evicted
      expect(buffer[buffer.length - 1]).toContain('tx #219 broadcast')
    })

    it('keeps a separate buffer per controller', () => {
      debugLoggerRegistry.setEnabled('PortfolioController', true)
      debugLoggerRegistry.setEnabled('ActivityController', true)

      debugLog('PortfolioController', 'portfolio fetched', undefined, { flow: 'fetch' })
      debugLog('ActivityController', 'tx broadcast', undefined, { flow: 'submitted' })

      expect(debugLoggerRegistry.read('PortfolioController')).toHaveLength(1)
      expect(debugLoggerRegistry.read('ActivityController')).toHaveLength(1)
    })

    it('clears one namespace without disturbing the others, and clears everything when called bare', () => {
      debugLoggerRegistry.setEnabled('PortfolioController', true)
      debugLoggerRegistry.setEnabled('ActivityController', true)
      debugLog('PortfolioController', 'portfolio fetched', undefined, { flow: 'fetch' })
      debugLog('ActivityController', 'tx broadcast', undefined, { flow: 'submitted' })

      debugLoggerRegistry.clear('PortfolioController')
      expect(debugLoggerRegistry.read('PortfolioController')).toHaveLength(0)
      expect(debugLoggerRegistry.read('ActivityController')).toHaveLength(1)

      debugLoggerRegistry.clear()
      expect(debugLoggerRegistry.read('ActivityController')).toHaveLength(0)
    })
  })

  describe('catalog and UI subscriptions', () => {
    it('seeds the on-demand controllers so they can be toggled before they are ever constructed', () => {
      expect(SEED_NAMESPACES).toContain('SignAccountOpController')
      SEED_NAMESPACES.forEach((namespace) =>
        expect(debugLoggerRegistry.catalog()).toContain(namespace)
      )
    })

    it('lists a library namespace as soon as its scoped logger is created', () => {
      const swapAndBridgeLog = createScopedDebugLogger('SwapAndBridgeController')
      debugLoggerRegistry.setEnabled('SwapAndBridgeController', true)

      swapAndBridgeLog('fetched route', { provider: 'socket' }, { flow: 'quote' })

      expect(debugLoggerRegistry.catalog()).toContain('SwapAndBridgeController')
      expect(debugLoggerRegistry.read('SwapAndBridgeController')[0]).toBe(
        `Debug: SwapAndBridgeController:quote (at ${NOW}) fetched route {"provider":"socket"}`
      )
    })

    it('notifies subscribers once for a brand-new controller and dedupes repeated registrations', () => {
      const onCatalogChange = jest.fn()
      const unsubscribe = debugLoggerRegistry.subscribe(onCatalogChange)

      // NetworksController has not been registered by any earlier test.
      debugLoggerRegistry.registerNamespace('NetworksController') // new -> notifies
      debugLoggerRegistry.registerNamespace('NetworksController') // already known -> silent
      debugLoggerRegistry.registerNamespace('NetworksController')

      expect(onCatalogChange).toHaveBeenCalledTimes(1)
      expect(debugLoggerRegistry.catalog()).toContain('NetworksController')
      unsubscribe()
    })

    it('stops notifying a subscriber after it unsubscribes', () => {
      const onCatalogChange = jest.fn()
      const unsubscribe = debugLoggerRegistry.subscribe(onCatalogChange)
      unsubscribe()

      debugLoggerRegistry.registerNamespace('DappsController')

      expect(onCatalogChange).not.toHaveBeenCalled()
    })
  })

  describe('persistence (snapshot / hydrate)', () => {
    it('snapshots only the enabled controllers, which is what gets stored', () => {
      debugLoggerRegistry.setEnabled('PortfolioController', true)
      debugLoggerRegistry.setEnabled('ActivityController', true)

      expect(debugLoggerRegistry.snapshot()).toEqual({
        PortfolioController: true,
        ActivityController: true
      })
    })

    it('hydrates enabled controllers from storage and keeps a persisted dynamic one visible cold', () => {
      // SignAccountOpController was enabled last session but is not constructed yet this session.
      debugLoggerRegistry.hydrate({ SignAccountOpController: true })

      expect(debugLoggerRegistry.isEnabled('SignAccountOpController')).toBe(true)
      expect(debugLoggerRegistry.catalog()).toContain('SignAccountOpController')
    })

    it('hydrate replaces the previous enabled set rather than merging into it', () => {
      debugLoggerRegistry.setEnabled('PortfolioController', true)

      debugLoggerRegistry.hydrate({ KeystoreController: true })

      expect(debugLoggerRegistry.isEnabled('PortfolioController')).toBe(false)
      expect(debugLoggerRegistry.isEnabled('KeystoreController')).toBe(true)
    })

    it('hydrate notifies subscribers so the UI re-renders the toggles', () => {
      const onChange = jest.fn()
      const unsubscribe = debugLoggerRegistry.subscribe(onChange)

      debugLoggerRegistry.hydrate({ PortfolioController: true })

      expect(onChange).toHaveBeenCalled()
      unsubscribe()
    })
  })
})
