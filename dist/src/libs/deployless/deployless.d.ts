import { JsonRpcProvider, Provider } from 'ethers';
/** Error message for when the network answers a call with no data or with data that isn't hex. */
export declare const INVALID_CALL_RESPONSE_ERROR_MESSAGE = "The network returned an empty or invalid response";
export declare enum DeploylessMode {
    Detect = 0,
    ProxyContract = 1,
    StateOverride = 2,
    Predeployed = 3
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
    /**
     * True when the provider talks JSON-RPC itself, so a call can be sent as the
     * RPC takes it instead of through ethers' request handling.
     */
    private get isJsonRpcProvider();
    private detectStateOverride;
    private static handleResponse;
    private static checkDataSize;
    /**
     * To be able to successfully pass a number as blockTag,
     * we need to turn it into a no-leading zeros hex.
     * This is the standard to make sure RPCs don't revert
     */
    private static normalizeRpcBlockTag;
    /**
     * Sends `eth_call` straight to the RPC instead of through `provider.call`,
     * which re-hexlifies the already-valid calldata twice on its way there.
     * Deployless calldata is tens of KB, so skipping that is worth it.
     */
    private sendCall;
    private getCallPromise;
    call(methodName: string, args: any[], _opts?: Partial<CallOptions>): Promise<any>;
}
export declare function fromDescriptor(provider: JsonRpcProvider | Provider, desc: {
    abi: any;
    bin: string;
    binRuntime: string;
}, supportStateOverride: boolean): Deployless;
//# sourceMappingURL=deployless.d.ts.map