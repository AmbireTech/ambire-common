import { SubmittedAccountOp } from '../accountOp/submittedAccountOp';
export declare function getVersion(accOp: SubmittedAccountOp | undefined): string;
export declare function getPendingStatus(version: string): 100 | "PENDING";
export declare function getSuccessStatus(version: string): 200 | "CONFIRMED";
export declare function getFailureStatus(version: string): 400 | "FAILURE";
//# sourceMappingURL=5792.d.ts.map