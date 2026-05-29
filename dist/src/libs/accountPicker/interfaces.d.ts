export interface AmbireLinkedAccounts {
    [address: string]: {
        associatedKeys: {
            [address: string]: string;
        }[];
        bytecode: string;
        factoryAddr: string;
        initialPrivilegesAddrs: string[];
        salt: string;
    };
}
//# sourceMappingURL=interfaces.d.ts.map