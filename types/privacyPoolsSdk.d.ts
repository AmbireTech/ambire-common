/**
 * Stands in for the Privacy Pools SDK packages in `build:v2` (included only by `tsconfig.build.json`).
 *
 * The consuming apps install these packages, so this repo does not declare them in `package.json`
 * and `tsc` cannot resolve them here. Declaring them lets the build compile the Privacy Pools code,
 * which the build's consumers never load at runtime. Where a package is installed, TypeScript
 * resolves the real one instead of these declarations.
 *
 * Only the names `src` imports are declared, all untyped. When `src` starts importing a new one,
 * the build fails with "Module ... has no exported member" - add it here.
 */

declare module '@kohaku-eth/privacy-pools' {
  export class PrivacyPoolsV1Protocol {
    constructor(...args: any[])
    [key: string]: any
  }
  export class OxBowAspService {
    constructor(...args: any[])
    [key: string]: any
  }
  export class DataService {
    constructor(...args: any[])
    [key: string]: any
  }
  export const SignatureSecretManager: any
  export const createSagaLogSource: any
  export const createPPv1Broadcaster: any
}

declare module '@kohaku-eth/plugins' {
  export type Host = any
  export type Keystore = any
  export type Network = any
  export type Storage = any
}

declare module '@kohaku-eth/provider' {
  export type EthereumProvider<T = any> = any
  export type TxLog = any
}

declare module '@fatsolutions/privacy-pools-core-circuits' {
  export type CircuitName = any
  export type CircuitInputSignalsMap = any
  export type CircuitPublicSignalsMap = any
  export const Prover: any
}
