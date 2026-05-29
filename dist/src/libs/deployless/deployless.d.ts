import { JsonRpcProvider, Provider } from 'ethers';
export declare enum DeploylessMode {
    Detect = 0,
    ProxyContract = 1,
    StateOverride = 2
}
export type CallOptions = {
    mode: DeploylessMode;
    blockTag: string | number;
    from?: string;
    to?: string;
    gasPrice?: string;
    gasLimit?: string;
    stateToOverride: object | null;
};
export declare class Deployless {
    private abi;
    private contractBytecode;
    private provider;
    private isProviderInvictus;
    private providerUrl;
    private detectionPromise?;
    private stateOverrideSupported?;
    private contractRuntimeCode?;
    get isLimitedAt24kbData(): boolean;
    constructor(provider: JsonRpcProvider | Provider, abi: any[], code: string, codeAtRuntime?: string);
    private detectStateOverride;
    private static handleResponse;
    private static checkDataSize;
    /**
     * To be able to successfully pass a number as blockTag,
     * we need to call toQuantity to it, making it a no-leading zeros hex.
     * This is the standard to make sure RPCs don't revert
     */
    private static normalizeRpcBlockTag;
    call(methodName: string, args: any[], _opts?: Partial<CallOptions>): Promise<any>;
}
export declare function fromDescriptor(provider: JsonRpcProvider | Provider, desc: {
    abi: any;
    bin: string;
    binRuntime: string;
}, supportStateOverride: boolean): Deployless;
//# sourceMappingURL=deployless.d.ts.map