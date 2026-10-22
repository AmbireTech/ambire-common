import { ControllerInterface } from './controller';
export type IMainController = ControllerInterface<InstanceType<typeof import('../controllers/main/main').MainController>>;
export declare const STATUS_WRAPPED_METHODS: {
    readonly removeAccount: "INITIAL";
    readonly updateAccounts: "INITIAL";
    readonly handleAccountPickerInitLedger: "INITIAL";
    readonly handleAccountPickerInitTrezor: "INITIAL";
    readonly handleAccountPickerInitOneKey: "INITIAL";
    readonly handleAccountPickerInitLattice: "INITIAL";
    readonly handleAccountPickerInitQr: "INITIAL";
    readonly handleAccountPickerInitNfc: "INITIAL";
    readonly importSmartAccountFromDefaultSeed: "INITIAL";
    readonly selectAccount: "INITIAL";
    readonly accountPickerSetInitParamsFromNewSeed: "INITIAL";
    readonly accountPickerSetInitParamsFromPrivateKeys: "INITIAL";
    readonly fetchSafeTxns: "INITIAL";
    readonly refreshSafeTxns: "INITIAL";
};
//# sourceMappingURL=main.d.ts.map