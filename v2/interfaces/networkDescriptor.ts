export interface NetworkDescriptor {
	name: string
	nativeAssetSymbol: string
	chainId: bigint
	rpcUrl: string
	rpcNoStateOverride: boolean
}
