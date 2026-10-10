/**
 * Stands in for `@kohaku-eth/privacy-pools` and `@fatsolutions/privacy-pools-core-circuits` under
 * Jest (see `moduleNameMapper` in `jest.config.js`).
 *
 * Both ship as ES modules only - their `exports` have no `require` condition - so the CommonJS
 * runtime Jest uses here cannot load them, and every suite that builds a `MainController` would
 * fail on the import alone. Nothing that runs under Jest reaches the real protocol: a suite that
 * exercises Privacy Pools replaces these with its own fakes through `jest.mock`.
 */

const notAvailable = (name: string) => () => {
  throw new Error(`${name} is not available under Jest - mock it in the test that needs it`)
}

export class PrivacyPoolsV1Protocol {
  constructor() {
    notAvailable('PrivacyPoolsV1Protocol')()
  }
}

export class OxBowAspService {
  constructor() {
    notAvailable('OxBowAspService')()
  }
}

export class DataService {
  constructor() {
    notAvailable('DataService')()
  }
}

export const createPPv1Broadcaster = notAvailable('createPPv1Broadcaster')

export const createSagaLogSource = notAvailable('createSagaLogSource')

export const Prover = notAvailable('Prover')
