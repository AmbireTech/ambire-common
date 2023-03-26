// ethers does not export their Network type it seems
interface Network {
	chainId: number;
	name: string;
}

// @TODO better name instead of Txn
interface Txn {
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
export interface Bundle {
	accountAddr: string;
	network: Network;
	signingKeyAddr: string;
	nonce: number;
	txns: [Txn];
	gasLimit: number | null;
	signature: string | null;
	minFeeInUSDPerGas: number;
	// @TODO separate interface
	gasFeePayment: GasFeePayment | null
	// @TODO: meta?
}
