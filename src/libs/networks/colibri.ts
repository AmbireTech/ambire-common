import { Network } from '../../interfaces/network'

export const COLIBRI_PROVER_URLS_BY_CHAIN_ID: Record<string, string[]> = {
  '1': [
    'https://mainnet.colibri-proof.tech',
    'https://mainnet-prover.incubed.net',
    'https://mainnet.colibri.link'
  ],
  '11155111': ['https://sepolia.colibri-proof.tech'],
  '100': [
    'https://gnosis.colibri-proof.tech',
    'https://gnosis-prover.incubed.net',
    'https://gnosis.colibri.link'
  ]
}

export const isColibriProviderAvailable = (chainId: Network['chainId']) => {
  return !!COLIBRI_PROVER_URLS_BY_CHAIN_ID[chainId.toString()]?.length
}

export const getDefaultColibriProverUrls = (chainId: Network['chainId']) => {
  const urls = COLIBRI_PROVER_URLS_BY_CHAIN_ID[chainId.toString()]

  return urls ? [...urls] : []
}
