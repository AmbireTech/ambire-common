import { createScopedDebugLogger } from '../debugLogger/debugLogger'

// Flow tags used by both the lib and the controller
export type PortfolioDebugFlow =
  | 'update'
  | 'discovery'
  | 'simulation'
  | 'defi'
  | 'learning'
  | 'hints'
  | 'blacklist'

// Used only in the lib
export const portfolioDebugLog = createScopedDebugLogger('PortfolioController')
