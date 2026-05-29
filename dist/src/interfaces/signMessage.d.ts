import { ControllerInterface } from './controller';
export type ISignMessageController = ControllerInterface<InstanceType<typeof import('../controllers/signMessage/signMessage').SignMessageController>>;
export type SignMessageUpdateParams = {
    isAutoLoginEnabledByUser?: boolean;
    autoLoginDuration?: number;
};
export declare enum SignMessageStatus {
    Initial = "initial",
    Done = "done",
    Partial = "partial"
}
//# sourceMappingURL=signMessage.d.ts.map