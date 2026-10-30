import TokenInfoGetter from '../../../contracts/compiled/TokenInfoGetter.json'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { fromDescriptor } from '../deployless/deployless'

export type TokenInfo = {
  address: string
  name: string
  symbol: string
  decimals: number
}

/**
 * Reads the name, symbol and decimals of a token with a single call, for no account in
 * particular. It is stateless: nothing is cached or remembered between calls, and nothing is
 * sent to an Ambire service (the call goes to the RPC of the network).
 *
 * Returns null if the address is not a token (same rule as the portfolio: it has a symbol).
 */
export const getTokenInfo = async ({
  provider,
  network,
  address
}: {
  provider: RPCProvider
  network: Network
  address: string
}): Promise<TokenInfo | null> => {
  const deployless = fromDescriptor(provider, TokenInfoGetter, !network.rpcNoStateOverride)

  const { name, symbol, decimals } = await deployless.call('getTokenInfo', [address], {
    blockTag: 'latest'
  })

  if (!symbol) return null

  return { address, name, symbol, decimals: Number(decimals) }
}
