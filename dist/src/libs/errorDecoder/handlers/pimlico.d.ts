import { DecodedError, ErrorHandler } from '../types';
declare class PimlicoEstimationErrorHandler implements ErrorHandler {
    matches(data: string, error: any): any;
    handle(data: string, error: any): DecodedError;
}
export default PimlicoEstimationErrorHandler;
//# sourceMappingURL=pimlico.d.ts.map