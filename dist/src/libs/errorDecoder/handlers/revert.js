/* eslint-disable class-methods-use-this */
import { AbiCoder, ErrorFragment } from 'ethers';
import { ERROR_PREFIX } from '../constants';
import { ErrorType } from '../types';
class RevertErrorHandler {
    matches(data) {
        return data?.startsWith(ERROR_PREFIX);
    }
    handle(data) {
        const encodedReason = data.slice(ERROR_PREFIX.length);
        const abi = new AbiCoder();
        try {
            const fragment = ErrorFragment.from('Error(string)');
            const args = abi.decode(fragment.inputs, `0x${encodedReason}`);
            const reason = args[0];
            return {
                type: ErrorType.RevertError,
                reason,
                data
            };
        }
        catch (e) {
            console.error('Failed to decode revert error', e);
            return {
                type: ErrorType.RevertError,
                reason: '',
                data
            };
        }
    }
}
export default RevertErrorHandler;
//# sourceMappingURL=revert.js.map