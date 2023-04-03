import { Interface, concat, AbiCoder } from 'ethers/lib/utils'
import { JsonRpcProvider } from '@ethersproject/providers'

// this is a magic contract that is constructed like `constructor(bytes memory contractCode, bytes memory data)` and returns the result from the call
// compiled from relayer:a7ea373559d8c419577ac05527bd37fbee8856ae/src/velcro-v3/contracts/Deployless.sol with solc 0.8.17
const deploylessProxyBin = '0x608060405234801561001057600080fd5b5060405161031038038061031083398181016040528101906100329190610239565b60008251602084016000f09050803b61004a57600080fd5b60008173ffffffffffffffffffffffffffffffffffffffff168360405161007191906102f8565b6000604051808303816000865af19150503d80600081146100ae576040519150601f19603f3d011682016040523d82523d6000602084013e6100b3565b606091505b509150506000815190508060208301f35b6000604051905090565b600080fd5b600080fd5b600080fd5b600080fd5b6000601f19601f8301169050919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b61012b826100e2565b810181811067ffffffffffffffff8211171561014a576101496100f3565b5b80604052505050565b600061015d6100c4565b90506101698282610122565b919050565b600067ffffffffffffffff821115610189576101886100f3565b5b610192826100e2565b9050602081019050919050565b60005b838110156101bd5780820151818401526020810190506101a2565b60008484015250505050565b60006101dc6101d78461016e565b610153565b9050828152602081018484840111156101f8576101f76100dd565b5b61020384828561019f565b509392505050565b600082601f8301126102205761021f6100d8565b5b81516102308482602086016101c9565b91505092915050565b600080604083850312156102505761024f6100ce565b5b600083015167ffffffffffffffff81111561026e5761026d6100d3565b5b61027a8582860161020b565b925050602083015167ffffffffffffffff81111561029b5761029a6100d3565b5b6102a78582860161020b565b9150509250929050565b600081519050919050565b600081905092915050565b60006102d2826102b1565b6102dc81856102bc565b93506102ec81856020860161019f565b80840191505092915050565b600061030482846102c7565b91508190509291505056fe'
// This is another magic contract that can return the contract code at an address; this is not the deploy bytecode but rather the contract code itself
const codeAtCode = '0x608060405234801561001057600080fd5b506004361061002b5760003560e01c8063d35b9d8314610030575b600080fd5b61004a600480360381019061004591906100ff565b610060565b60405161005791906101bc565b60405180910390f35b60608173ffffffffffffffffffffffffffffffffffffffff16803b806020016040519081016040528181526000908060200190933c9050919050565b600080fd5b600073ffffffffffffffffffffffffffffffffffffffff82169050919050565b60006100cc826100a1565b9050919050565b6100dc816100c1565b81146100e757600080fd5b50565b6000813590506100f9816100d3565b92915050565b6000602082840312156101155761011461009c565b5b6000610123848285016100ea565b91505092915050565b600081519050919050565b600082825260208201905092915050565b60005b8381101561016657808201518184015260208101905061014b565b60008484015250505050565b6000601f19601f8301169050919050565b600061018e8261012c565b6101988185610137565b93506101a8818560208601610148565b6101b181610172565b840191505092915050565b600060208201905081810360008301526101d68184610183565b90509291505056fea2646970667358221220e3ab8acdd4722fecd2818f6095e31a71f7117d0cffa8933a3428c0966945d30164736f6c63430008120033'
const codeAtAbi = ['function codeAt(address at) external view returns (bytes)']
// any made up addr would work
const codeAtAddr = '0x0000000000000000000000000000000000696969'
const abiCoder = new AbiCoder()

enum DeploylessMode { Detect, ProxyContract, StateOverride }

export class Deployless {
	private iface: Interface;
	private contractCode: string;
	private provider: JsonRpcProvider;
	// We need to detect whether the provider supports state override
	private detectionPromise: Promise<void>;
	private stateOverrideSupported?: boolean;
	private contractCodeDeployed?: string;

	public get isLimitedAt24kbData() {
		return !this.stateOverrideSupported
	}

	constructor (provider: JsonRpcProvider, abi: any, code: string) {
		this.contractCode = code
		this.provider = provider
		this.iface = new Interface(abi)
		this.detectionPromise = this.detectStateOverride()
	}

	// this will detect whether the provider supports state override and also retrieve the actual code of the contract we are using
	private async detectStateOverride (): Promise<void> {
		const codeAtIface = new Interface(codeAtAbi)
		const code = await this.provider.send('eth_call', [
			{ to: codeAtAddr, data: codeAtIface.encodeFunctionData('codeAt', [codeAtAddr]) },
			'latest',
			{ [codeAtAddr]: { code: codeAtCode } }
		])
		this.stateOverrideSupported = code.length > 2
	}

	async call (methodName: string, args: any[], opts: { mode: DeploylessMode, tag?: string } = { mode: DeploylessMode.Detect }): Promise<any> {
		await this.detectionPromise
		const callData = this.iface.encodeFunctionData(methodName, args)
		const returnDataRaw = await this.provider.call({
			data: concat([
				deploylessProxyBin,
				abiCoder.encode(['bytes', 'bytes'], [this.contractCode, callData])
			])
		})
		return this.iface.decodeFunctionResult(methodName, returnDataRaw)[0]
	}
}
