export interface NetworkDescriptor {
  id: string
  name: string
  nativeAssetSymbol: string
  chainId: number
  rpcUrl: string
  rpcNoStateOverride: boolean
  // NOTE: should this be here? keep in mind networks can be user-inputted, so it's prob better to have
  // a separate mapping somewhere
  // @TODO remove this, add a separate mapping
  // coingeckoPlatformId: string
}
