import { Warning } from '../../interfaces/signAccountOp';
declare const ERRORS: {
    eoaInsufficientFunds: string;
};
declare const WARNINGS: {
    [key: string]: Warning;
};
declare const RETRY_TO_INIT_ACCOUNT_OP_MSG = "Please attempt to initiate the transaction again or contact Ambire support.";
export { ERRORS, WARNINGS, RETRY_TO_INIT_ACCOUNT_OP_MSG };
//# sourceMappingURL=errorHandling.d.ts.map