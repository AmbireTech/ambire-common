import Colibri from '@corpus-core/colibri-stateless'
import { JsonRpcApiProviderOptions, JsonRpcProvider, Network } from 'ethers'

type VerifiedJsonRpcProviderOptions = JsonRpcApiProviderOptions

function parseCsvEnv(value: string | undefined): string[] | null {
  if (!value) return null
  const parts = value
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  return parts.length ? parts : null
}

function shouldBypassColibri(method: string, params: any[] | undefined): boolean {
  // Colibri is an EIP-1193 provider. Some wallet internals rely on JsonRpcProvider-specific behavior
  // (e.g. state override in Deployless eth_call). Those should continue to use the direct RPC.
  if (method !== 'eth_call') return false
  if (!Array.isArray(params)) return false

  // State override calls look like: eth_call([tx, blockTag, stateOverride])
  // We bypass only when a 3rd param object is present.
  if (params.length >= 3 && params[2] && typeof params[2] === 'object') return true

  return false
}

export class VerifiedJsonRpcProvider extends JsonRpcProvider {
  readonly #colibri: any

  constructor(rpcUrl: string, chainId: bigint | number, options?: VerifiedJsonRpcProviderOptions) {
    const staticNetwork = Network.from(Number(chainId))
    super(rpcUrl, staticNetwork, {
      ...(staticNetwork ? { staticNetwork } : {}),
      ...(options || {})
    })

    const proverUrls =
      parseCsvEnv(process.env.COLIBRI_PROVER_URLS) ?? ['https://sepolia.colibri-proof.tech/']
    const trustedCheckpoint = process.env.COLIBRI_TRUSTED_CHECKPOINT || undefined
    const debug = process.env.COLIBRI_DEBUG === 'true'

    this.#colibri = new Colibri({
      chainId: Number(chainId),
      rpcs: [rpcUrl],
      prover: proverUrls,
      ...(trustedCheckpoint ? { trusted_checkpoint: trustedCheckpoint } : {}),
      verify: () => true,
      debug
    })
  }

  override async send(method: string, params: Array<any> | Record<string, any> = []): Promise<any> {
    if (shouldBypassColibri(method, params as any)) {
      return super.send(method, params as any)
    }

    // Colibri implements EIP-1193. Use it for verified RPC where possible,
    // while its internal proof strategy can fall back to unverified RPC for unsupported methods.
    return this.#colibri.request({ method, params })
  }
}

