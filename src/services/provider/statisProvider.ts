/* eslint-disable no-underscore-dangle */
/* eslint-disable @typescript-eslint/no-floating-promises */
import { JsonRpcProvider, Network } from 'ethers'

// A StaticJsonRpcProvider is useful when you *know* for certain that
// the backend will never change, as it never calls eth_chainId to
// verify its backend. However, if the backend does change, the effects
// are undefined and may include:
// - inconsistent results
// - locking up the UI
// - block skew warnings
// - wrong results
// If the network is not explicit (i.e. auto-detection is expected), the
// node MUST be running and available to respond to requests BEFORE this

// is instantiated.
export class StaticJsonRpcProvider extends JsonRpcProvider {
  async detectNetwork(): Promise<Network> {
    let network = this._network
    if (network == null) {
      network = await super._detectNetwork()

      if (!network) {
        console.log('no network detected for RPC provider')
      }

      // If still not set, set it
      if (this._network == null) {
        this.emit('network', network, null)
      }
    }
    return network
  }
}
