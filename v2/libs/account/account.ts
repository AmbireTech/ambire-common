import { Interface } from 'ethers'

export interface Account {
	addr: string;
	label: string;
	// URL (https, ipfs or nft721://contractAddr/tokenId)
	pfp: string;
	associatedKeys: string[];
	// Creation data
	factoryAddr: string;
	bytecode: string;
	salt: string;
	// baseIdentityAddr is intentionally omitted because it's not used anywhere
	// and because it can be retrieved from the bytecode
}

// returns to, data
export function getAccountDeployParams (account: Account): [string, string] {
	const factory = new Interface(['function deploy(bytes calldata code, uint256 salt) external'])
	return [account.factoryAddr, factory.encodeFunctionData('deploy', [account.bytecode, account.salt])]
}
