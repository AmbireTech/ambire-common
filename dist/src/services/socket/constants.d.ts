import { SwapAndBridgeToToken } from '../../interfaces/swapAndBridge';
export declare const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export declare const NULL_ADDRESS = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
export declare const ETH_ON_OPTIMISM_LEGACY_ADDRESS = "0xdeaddeaddeaddeaddeaddeaddeaddeaddead0000";
/**
 * The % of fee to be cut from the source input token amount.
 * Can be up to three decimal places and cannot be more than 5%.
 */
export declare const FEE_PERCENT = 0.5;
export declare const AMBIRE_WALLET_TOKEN_ON_ETHEREUM: SwapAndBridgeToToken;
export declare const AMBIRE_WALLET_TOKEN_ON_BASE: SwapAndBridgeToToken;
export declare const JPYC_TOKEN: {
    name: string;
    symbol: string;
    decimals: number;
    address: string;
    icon: string;
};
export declare const AMBIRE_FEE_TAKER_ADDRESSES: {
    [chainId: number]: string;
};
export declare const SOCKET_EXPLORER_URL = "https://www.socketscan.io";
export declare const PROTOCOLS_WITH_CONTRACT_FEE_IN_NATIVE: string[];
//# sourceMappingURL=constants.d.ts.map