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
    private iface;
    private contractBytecode;
    private provider;
    private isProviderInvictus;
    private detectionPromise?;
    private stateOverrideSupported?;
    private contractRuntimeCode?;
    get isLimitedAt24kbData(): boolean;
    constructor(provider: JsonRpcProvider | Provider, abi: any[], code: string, codeAtRuntime?: string);
    private detectStateOverride;
    call(methodName: string, args: any[], opts?: Partial<CallOptions>): Promise<any>;
}
export declare function fromDescriptor(provider: JsonRpcProvider | Provider, desc: {
    abi: any;
    bin: string;
    binRuntime: string;
}, supportStateOverride: boolean): Deployless;
export declare function parseErr(data: string): string | null;
//# sourceMappingURL=deployless.d.ts.map