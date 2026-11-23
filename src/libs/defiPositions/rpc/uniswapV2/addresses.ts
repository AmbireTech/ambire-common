/**
 * The Uniswap V2 factory of each network, by chain id. Only the tokens it deployed are read as
 * pairs. Taken from https://docs.uniswap.org/contracts/v2/reference/smart-contracts/v2-deployments
 */
export const UNISWAP_V2_FACTORIES: { [chainId: string]: string } = {
  // Ethereum
  '1': '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
  // Unichain
  '130': '0x1f98400000000000000000000000000000000002',
  // Optimism
  '10': '0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf',
  // Base
  '8453': '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6',
  // Arbitrum One
  '42161': '0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9',
  // Polygon
  '137': '0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C',
  // World Chain
  '480': '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
  // Avalanche
  '43114': '0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C',
  // BNB Smart Chain
  '56': '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6',
  // Monad
  '143': '0x182a927119d56008d921126764bf884221b10f59',
  // MegaETH
  '4326': '0xbf56488c857a881ae7e3bed27cf99c10a7ab7e50',
  // Robinhood Chain
  '4663': '0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f',
  // HyperEVM
  '999': '0x89e5DB8B5aA49aA85AC63f691524311AEB649eba'
}
