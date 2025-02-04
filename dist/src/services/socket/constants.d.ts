export declare const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export declare const NULL_ADDRESS = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
export declare const ETH_ON_OPTIMISM_LEGACY_ADDRESS = "0xdeaddeaddeaddeaddeaddeaddeaddeaddead0000";
/**
 * The % of fee to be cut from the source input token amount.
 * Can be up to three decimal places and cannot be more than 5%.
 */
export declare const FEE_PERCENT = 0.25;
export declare const AMBIRE_WALLET_TOKEN_ON_ETHEREUM: {
    name: string;
    symbol: string;
    decimals: number;
    logoURI: string;
    icon: string;
    chainId: number;
    address: string;
};
export declare const AMBIRE_WALLET_TOKEN_ON_BASE: {
    name: string;
    symbol: string;
    decimals: number;
    logoURI: string;
    icon: string;
    chainId: number;
    address: string;
};
export declare const AMBIRE_FEE_TAKER_ADDRESSES: {
    [chainId: number]: string;
};
//# sourceMappingURL=constants.d.ts.map