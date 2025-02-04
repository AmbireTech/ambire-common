/* eslint-disable class-methods-use-this */
import { AbiCoder, ErrorFragment } from 'ethers';
import { PANIC_ERROR_PREFIX } from '../constants';
import { panicErrorCodeToReason } from '../helpers';
import { ErrorType } from '../types';
class PanicErrorHandler {
    matches(data) {
        return data?.startsWith(PANIC_ERROR_PREFIX);
    }
    handle(data) {
        const encodedReason = data.slice(PANIC_ERROR_PREFIX.length);
        const abi = new AbiCoder();
        try {
            const fragment = ErrorFragment.from('Panic(uint256)');
            const args = abi.decode(fragment.inputs, `0x${encodedReason}`);
            const reason = panicErrorCodeToReason(args[0]) ?? 'Unknown panic code';
            return {
                type: ErrorType.PanicError,
                reason,
                data
            };
        }
        catch (e) {
            console.error('Failed to decode panic error', e);
            return {
                type: ErrorType.PanicError,
                reason: 'Failed to decode panic error',
                data
            };
        }
    }
}
export default PanicErrorHandler;
//# sourceMappingURL=panic.js.map