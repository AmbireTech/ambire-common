import { BundlerProvider } from "../services/bundlers/bundler";
import Pimlico from "../services/bundlers/pimlico";

interface Conf {
  bundler: BundlerProvider
}

const conf: Conf = {
  bundler: new Pimlico()
}

export default conf