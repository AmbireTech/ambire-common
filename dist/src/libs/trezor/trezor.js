/**
 * Used to "translate" error codes returned by the Trezor device into a
 * human-readable messages. Although there is a message incoming from Trezor,
 * it's not self-explanatory and can be difficult for the end users to understand.
 */
export const getMessageFromTrezorErrorCode = (errorCode, errorMsg) => {
    if (!errorCode && !errorMsg)
        return 'Could not connect to your Trezor device. Please try again.';
    if (errorCode === 'Method_Interrupted')
        return 'Closing the Trezor popup interrupted the connection.';
    if (errorCode === 'Failure_ActionCancelled')
        return 'Rejected by your Trezor device.';
    if (errorMsg?.toLowerCase()?.includes('device disconnected during action') ||
        errorCode === 'Device_Disconnected')
        return 'Trezor device got disconnected.';
    return `${errorMsg} (${errorCode ?? 'no error code incoming'})`;
};
/**
 * Used to "translate" errors thrown by the Trezor device into a human-readable
 * messages. Some of them are not self-explanatory and can be difficult for the
 * end users to understand.
 */
export const normalizeTrezorMessage = (error) => {
    if (!error || error?.includes('handshake failed')) {
        return 'Could not connect to your Trezor device. Please try again.';
    }
    return error;
};
//# sourceMappingURL=trezor.js.map