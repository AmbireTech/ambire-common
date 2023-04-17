// ethers does not export their Network type it seems
interface Network {
	chainId: number;
	name: string;
}

interface Call {
	to: string;
	// @TODO: hex?
	value: string;
	data: string;
}

enum GasFeePaymentType {
	// when a paymaster is used, we put it in the `paidBy` instead of the accountAddr
	ERC4337 = 'erc4337',
	AmbireRelayer = 'ambireRelayer',
	AmbireGasTank = 'ambireGasTank',
	EOA = 'eoa'
}
interface GasFeePayment {
	feePaymentType: GasFeePaymentType;
	paidBy: string;
	inToken: string;
	amount: number;
}

// @TODO class
// Equivalent to ERC-4337 UserOp, but more 'general' than it since a Bundle can be transformed to
// a UserOp, or to a direct EOA transaction, or relayed through the Ambire relayer
export interface Bundle {
	accountAddr: string;
	network: Network;
	signingKeyAddr: string;
	nonce: number;
	// @TODO: nonce namespace? it is dependent on gasFeePayment
	calls: [Call];
	gasLimit: number | null;
	signature: string | null;
	// @TODO separate interface
	gasFeePayment: GasFeePayment | null
	// @TODO: meta?
}
