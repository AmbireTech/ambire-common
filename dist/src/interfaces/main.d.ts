import { ControllerInterface } from './controller';
export type IMainController = ControllerInterface<InstanceType<typeof import('../controllers/main/main').MainController>>;
export declare const STATUS_WRAPPED_METHODS: {
    readonly removeAccount: "INITIAL";
    readonly handleAccountPickerInitLedger: "INITIAL";
    readonly handleAccountPickerInitTrezor: "INITIAL";
    readonly handleAccountPickerInitLattice: "INITIAL";
    readonly handleAccountPickerInitQr: "INITIAL";
    readonly importSmartAccountFromDefaultSeed: "INITIAL";
    readonly selectAccount: "INITIAL";
};
//# sourceMappingURL=main.d.ts.map