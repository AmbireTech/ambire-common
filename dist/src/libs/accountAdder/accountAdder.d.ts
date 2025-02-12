import { Fetch } from '../../interfaces/fetch';
export declare function getIdentity(address: string, fetch: Fetch, relayerUrl: string): Promise<{
    creation: {
        factoryAddr: any;
        bytecode: any;
        salt: any;
    } | null;
    associatedKeys: string[];
    initialPrivileges: any;
}>;
//# sourceMappingURL=accountAdder.d.ts.map