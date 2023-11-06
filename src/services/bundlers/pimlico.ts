import { NetworkDescriptor } from "../../interfaces/networkDescriptor";
import { BundlerProvider } from "../../config/conf";
import { StaticJsonRpcProvider } from "@ethersproject/providers";

export default class Pimlico implements BundlerProvider {
  getProvider(network: NetworkDescriptor): StaticJsonRpcProvider {
    const endpoint = `https://api.pimlico.io/v1/${network.id}/rpc?apikey=${process.env.REACT_APP_PIMLICO_API_KEY}`
    return new StaticJsonRpcProvider(endpoint)
  }
}