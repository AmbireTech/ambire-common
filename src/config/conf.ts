import { NetworkDescriptor } from "../interfaces/networkDescriptor";
import Pimlico from "../services/bundlers/pimlico";
import { JsonRpcProvider } from "@ethersproject/providers";

export interface BundlerProvider {
  getProvider(network: NetworkDescriptor): JsonRpcProvider
}

interface Conf {
  bundler: BundlerProvider
}

const conf: Conf = {
  bundler: new Pimlico()
}

export default conf