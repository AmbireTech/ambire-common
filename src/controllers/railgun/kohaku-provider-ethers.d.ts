// `@kohaku-eth/provider` ships `./ethers` as a subpath export (mapped in its package.json
// "exports" field to dist/ethers.js). This repo's tsconfig uses "moduleResolution": "node"
// (classic), which does not consult package.json "exports" maps, so the subpath fails to
// resolve at typecheck time even though bundlers (webpack) resolve it correctly at build time.
// This is a narrow, local shim mirroring the real declaration file verbatim
// (node_modules/@kohaku-eth/provider/dist/ethers.d.ts) so the import type-checks.
declare module '@kohaku-eth/provider/ethers' {
  import { JsonRpcProvider, Wallet } from 'ethers'
  import { EthereumProvider, TxData, TxSigner } from '@kohaku-eth/provider'

  export class EthersSignerAdapter implements TxSigner {
    constructor(signer: Wallet)

    signMessage(message: string | Uint8Array): Promise<string>

    sendTransaction(tx: TxData): Promise<string>

    getAddress(): Promise<string>
  }

  export const ethers: (provider: JsonRpcProvider) => EthereumProvider<JsonRpcProvider>
}
