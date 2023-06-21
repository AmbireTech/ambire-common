export type NetworkId = string

// NetworkId is a string: this is our internal identifier for the network
// chainId is a number and is the chainID used for replay protection (EIP-155)
// we need this distinction because:
// 1) it's easier to work with the string identifier, for example if we have an object segmented by networks it's easier to debug with string IDs
// 2) multiple distinct networks may (rarely) run the same chainId
export interface NetworkDescriptor {
  id: NetworkId
  name: string
  nativeAssetSymbol: string
  chainId: bigint
  rpcUrl: string
  rpcNoStateOverride: boolean
  // NOTE: should this be here? keep in mind networks can be user-inputted, so it's prob better to have
  // a separate mapping somewhere
  // @TODO remove this, add a separate mapping
  // coingeckoPlatformId: string
}
