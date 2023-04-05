import { Interface, concat, AbiCoder } from 'ethers/lib/utils'
import { JsonRpcProvider, BaseProvider } from '@ethersproject/providers'

// this is a magic contract that is constructed like `constructor(bytes memory contractBytecode, bytes memory data)` and returns the result from the call
// compiled from relayer:a7ea373559d8c419577ac05527bd37fbee8856ae/src/velcro-v3/contracts/Deployless.sol with solc 0.8.17
const deploylessProxyBin = '0x608060405234801561001057600080fd5b506040516103563803806103568339818101604052810190610032919061027f565b60008251602084016000f0905060008173ffffffffffffffffffffffffffffffffffffffff163b03610090576040517fb4f5411100000000000000000000000000000000000000000000000000000000815260040160405180910390fd5b60008173ffffffffffffffffffffffffffffffffffffffff16836040516100b7919061033e565b6000604051808303816000865af19150503d80600081146100f4576040519150601f19603f3d011682016040523d82523d6000602084013e6100f9565b606091505b509150506000815190508060208301f35b6000604051905090565b600080fd5b600080fd5b600080fd5b600080fd5b6000601f19601f8301169050919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b61017182610128565b810181811067ffffffffffffffff821117156101905761018f610139565b5b80604052505050565b60006101a361010a565b90506101af8282610168565b919050565b600067ffffffffffffffff8211156101cf576101ce610139565b5b6101d882610128565b9050602081019050919050565b60005b838110156102035780820151818401526020810190506101e8565b60008484015250505050565b600061022261021d846101b4565b610199565b90508281526020810184848401111561023e5761023d610123565b5b6102498482856101e5565b509392505050565b600082601f8301126102665761026561011e565b5b815161027684826020860161020f565b91505092915050565b6000806040838503121561029657610295610114565b5b600083015167ffffffffffffffff8111156102b4576102b3610119565b5b6102c085828601610251565b925050602083015167ffffffffffffffff8111156102e1576102e0610119565b5b6102ed85828601610251565b9150509250929050565b600081519050919050565b600081905092915050565b6000610318826102f7565b6103228185610302565b93506103328185602086016101e5565b80840191505092915050565b600061034a828461030d565b91508190509291505056fe'
const deployErrorSig = '0xb4f54111'
// This is another magic contract that can return the contract code at an address; this is not the deploy bytecode but rather the contract code itself
// see https://gist.github.com/Ivshti/fbcc37c0a8b88d6e51bb30db57f3d50e
const codeOfContractCode = '0x608060405234801561001057600080fd5b506004361061002b5760003560e01c80631e05758f14610030575b600080fd5b61004a60048036038101906100459190610248565b61004c565b005b60008151602083016000f0905060008173ffffffffffffffffffffffffffffffffffffffff163b036100aa576040517fb4f5411100000000000000000000000000000000000000000000000000000000815260040160405180910390fd5b60008173ffffffffffffffffffffffffffffffffffffffff16803b806020016040519081016040528181526000908060200190933c90506000815190508060208301f35b6000604051905090565b600080fd5b600080fd5b600080fd5b600080fd5b6000601f19601f8301169050919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b6101558261010c565b810181811067ffffffffffffffff821117156101745761017361011d565b5b80604052505050565b60006101876100ee565b9050610193828261014c565b919050565b600067ffffffffffffffff8211156101b3576101b261011d565b5b6101bc8261010c565b9050602081019050919050565b82818337600083830152505050565b60006101eb6101e684610198565b61017d565b90508281526020810184848401111561020757610206610107565b5b6102128482856101c9565b509392505050565b600082601f83011261022f5761022e610102565b5b813561023f8482602086016101d8565b91505092915050565b60006020828403121561025e5761025d6100f8565b5b600082013567ffffffffffffffff81111561027c5761027b6100fd565b5b6102888482850161021a565b9150509291505056fea2646970667358221220de4923c71abcedf68454c251a9becff7e8a4f8db4adee6fdb16d583f509c63bb64736f6c63430008120033'
const codeOfContractAbi = ['function codeOf(bytes deployCode) external view']
// any made up addr would work
const arbitraryAddr = '0x0000000000000000000000000000000000696969'
const abiCoder = new AbiCoder()

export enum DeploylessMode { Detect, ProxyContract, StateOverride }

export class Deployless {
	private iface: Interface;
	private contractBytecode: string;
	private provider: JsonRpcProvider | BaseProvider;
	// We need to detect whether the provider supports state override
	private detectionPromise?: Promise<void>;
	private stateOverrideSupported?: boolean;
	private contractBytecodeWhenDeployed?: string;

	public get isLimitedAt24kbData() {
		return !this.stateOverrideSupported
	}

	constructor (provider: JsonRpcProvider | BaseProvider, abi: any, code: string, codeWhenDeployed?: string) {
		this.contractBytecode = code
		this.provider = provider
		this.iface = new Interface(abi)
		if (codeWhenDeployed !== undefined) {
			this.stateOverrideSupported = true
			this.contractBytecodeWhenDeployed = codeWhenDeployed
		}
	}

	// this will detect whether the provider supports state override and also retrieve the actual code of the contract we are using
	private async detectStateOverride (): Promise<void> {
		if (!(this.provider instanceof JsonRpcProvider)) {
			throw new Error('state override mode (or auto-detect) not available unless you use JsonRpcProvider')
		}
		const codeOfIface = new Interface(codeOfContractAbi)
		const code = await (this.provider as JsonRpcProvider).send('eth_call', [
			{ to: arbitraryAddr, data: codeOfIface.encodeFunctionData('codeOf', [this.contractBytecode]) },
			'latest',
			{ [arbitraryAddr]: { code: codeOfContractCode } }
		// @TODO more elegant mapping
		]).catch(e => (e.error && e.error.data) || Promise.reject(e))
		// any response bigger than 0x is sufficient to know that state override worked
		this.stateOverrideSupported = code.length > 2
		// but this particular resposne means that the contract deploy failed
		if (code === deployErrorSig) throw new Error('contract deploy failed')
		this.contractBytecodeWhenDeployed = code
	}

	// @TODO: options need to be de-uglified
	async call (methodName: string, args: any[], opts: { mode: DeploylessMode, blockTag?: string | number } = { mode: DeploylessMode.Detect, blockTag: 'latest' }): Promise<any> {
		const forceProxy = opts.mode === DeploylessMode.ProxyContract

		// First, start by detecting which modes are available, unless we're forcing the proxy mode
		// if we use state override, we do need detection to run still so it can populate contractBytecodeWhenDeployed
		if (!this.detectionPromise && !forceProxy && this.contractBytecodeWhenDeployed === undefined) {
			this.detectionPromise = this.detectStateOverride()
		}
		await this.detectionPromise

		if (opts.mode === DeploylessMode.StateOverride && !this.stateOverrideSupported) {
			// @TODO test this case
			throw new Error('state override requested but not supported')
		}

		const callData = this.iface.encodeFunctionData(methodName, args)
		// @TODO preemtively test the 24kb limit in proxy mode
		const callPromise = (this.stateOverrideSupported && !forceProxy)
			? (this.provider as JsonRpcProvider).send('eth_call', [
				{ to: arbitraryAddr, data: callData },
				opts.blockTag,
				{ [arbitraryAddr]: { code: this.contractBytecodeWhenDeployed } }
			])
			: this.provider.call({
				data: concat([
					deploylessProxyBin,
					abiCoder.encode(['bytes', 'bytes'], [this.contractBytecode, callData])
				])
			}, opts.blockTag)
		const returnDataRaw = await callPromise
		if (returnDataRaw === deployErrorSig) throw new Error('contract deploy failed')
		return this.iface.decodeFunctionResult(methodName, returnDataRaw)[0]
	}
}
