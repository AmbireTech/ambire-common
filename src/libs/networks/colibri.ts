import { Network } from '../../interfaces/network'

export const COLIBRI_PROVER_URLS_BY_CHAIN_ID: Record<string, string> = {
  '1': 'https://mainnet1.colibri-proof.tech',
  '11155111': 'https://sepolia.colibri-proof.tech',
  '100': 'https://gnosis.colibri-proof.tech'
}

export const isColibriProviderAvailable = (chainId: Network['chainId']) => {
  return !!COLIBRI_PROVER_URLS_BY_CHAIN_ID[chainId.toString()]
}

export const getDefaultColibriProverUrl = (chainId: Network['chainId']) => {
  return COLIBRI_PROVER_URLS_BY_CHAIN_ID[chainId.toString()] || ''
}
