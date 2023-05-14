import { NetworkDescriptor } from '../interfaces/networkDescriptor'

const networks: NetworkDescriptor[] = [{
	name: 'Ethereum',
	nativeAssetSymbol: 'ETH',
	rpcUrl: 'https://rpc.ankr.com/eth',
	rpcNoStateOverride: false,
	chainId: 1n,
}]

export { networks }
