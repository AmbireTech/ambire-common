import { StaticJsonRpcProvider } from "@ethersproject/providers";
import { NetworkDescriptor } from "../../interfaces/networkDescriptor";
import { BundlerProvider } from "./bundler";

export default class Pimlico implements BundlerProvider {
  getProvider(network: NetworkDescriptor) {
    const endpoint = `https://api.pimlico.io/v1/${network.id}/rpc?apikey=${process.env.REACT_APP_PIMLICO_API_KEY}`
    return new StaticJsonRpcProvider(endpoint)
  }
}