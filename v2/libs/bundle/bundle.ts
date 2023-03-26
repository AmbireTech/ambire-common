// @TODO: separate Network object; or use the ethers type (which is practically the same)
interface Network {
	chainId: number;
	id: string;
}

// @TODO better name instead of Txn
interface Txn {
	to: string;
	// @TODO: hex?
	value: string;
	data: string;
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
	gasFeePayment: {
		// @TODO enum 
		feePaymentType: string; // 4337, 4337Paymaster, ambireRelayer, ambireGasTank, eoa
		paidBy: string;
		inToken: string;
		amount: number;
	}
	// @TODO: meta?
}
