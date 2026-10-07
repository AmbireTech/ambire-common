export const PORTFOLIO_LIB_ERROR_NAMES = {
  /** External hints API (Velcro) request failed but fallback is sufficient */
  NonCriticalApiHintsError: 'NonCriticalApiHintsError',
  /** External API (Velcro) hints are older than X minutes */
  StaleApiHintsError: 'StaleApiHintsError',
  /** No external API (Velcro) hints are available- the request failed without fallback */
  NoApiHintsError: 'NoApiHintsError',
  /** One or more cena request has failed */
  PriceFetchError: 'PriceFetchError',
  /** Defi discovery failed */
  DefiDiscoveryError: 'DefiDiscoveryError'
}
