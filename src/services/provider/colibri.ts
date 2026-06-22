import Colibri from '@corpus-core/colibri-stateless'
import { JsonRpcApiProviderOptions, JsonRpcProvider, Network } from 'ethers'

import { Network as NetworkInterface } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import {
  getDefaultColibriProverUrl,
  isColibriProviderAvailable
} from '../../libs/networks/colibri'

const assertSupportedBlockTag = (method: string, params: any[] | Record<string, any>) => {
  if (!Array.isArray(params)) return
  if (method !== 'eth_call' && method !== 'eth_estimateGas') return
  if (params[1] !== 'pending') return

  throw new Error('Colibri verifier does not support pending block tag requests')
}

class ColibriRpcProvider extends JsonRpcProvider {
  #colibri: Colibri

  constructor(network: NetworkInterface, proverUrl: string, options?: JsonRpcApiProviderOptions) {
    super(network.selectedRpcUrl, Network.from(Number(network.chainId)), options)

    this.#colibri = new Colibri({
      chainId: Number(network.chainId),
      rpcs: [network.selectedRpcUrl],
      prover: [proverUrl],
      zk_proof: true
    })
  }

  send(method: string, params: any[] | Record<string, any>): Promise<any> {
    assertSupportedBlockTag(method, params)

    return this.#colibri.request({ method, params }) as Promise<any>
  }

  destroy(): void {
    this.#colibri.destroy()
    super.destroy()
  }
}

export const getColibriRpcProvider = (
  network: NetworkInterface,
  options?: JsonRpcApiProviderOptions
): RPCProvider => {
  const colibriProverUrl =
    network.colibriProverUrl?.trim() || getDefaultColibriProverUrl(network.chainId)

  if (
    !network.isColibriEnabled ||
    !colibriProverUrl ||
    !isColibriProviderAvailable(network.chainId)
  ) {
    throw new Error('Colibri verifier is not configured for this network')
  }

  return new ColibriRpcProvider(network, colibriProverUrl, options) as RPCProvider
}
