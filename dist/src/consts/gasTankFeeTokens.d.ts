declare const _default: ({
    address: string;
    symbol: string;
    networkId: string;
    decimals: number;
    icon: string;
    disableGasTankDeposit?: undefined;
    disableAsFeeToken?: undefined;
    baseToken?: undefined;
} | {
    address: string;
    symbol: string;
    networkId: string;
    disableGasTankDeposit: boolean;
    decimals: number;
    icon: string;
    disableAsFeeToken?: undefined;
    baseToken?: undefined;
} | {
    address: string;
    disableGasTankDeposit: boolean;
    disableAsFeeToken: boolean;
    symbol: string;
    networkId: string;
    decimals: number;
    icon: string;
    baseToken?: undefined;
} | {
    address: string;
    baseToken: string;
    symbol: string;
    networkId: string;
    decimals: number;
    icon: string;
    disableGasTankDeposit?: undefined;
    disableAsFeeToken?: undefined;
})[];
export default _default;
//# sourceMappingURL=gasTankFeeTokens.d.ts.map