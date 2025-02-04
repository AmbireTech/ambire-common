export async function estimateWithRetries(fetchRequests, timeoutType, errorCallback, timeoutInMill = 10000, counter = 0) {
    // stop the execution on 5 fails;
    // the below error message is not shown to the user so we are safe
    if (counter >= 5)
        return new Error('Estimation failure, retrying in a couple of seconds. If this issue persists, please change your RPC provider or contact Ambire support');
    const santinelTimeoutErr = {};
    const estimationTimeout = new Promise((resolve) => {
        setTimeout(() => {
            resolve(santinelTimeoutErr);
        }, timeoutInMill);
    });
    let result = await Promise.race([Promise.all(fetchRequests()), estimationTimeout]);
    // retry on a timeout
    if (result === santinelTimeoutErr) {
        const incremented = counter + 1;
        // display a timeout error only on the first try
        switch (timeoutType) {
            case 'estimation-deployless':
                errorCallback({
                    level: 'major',
                    message: 'Estimating gas limits from the RPC timed out. Retrying...',
                    error: new Error('Estimation.sol deployless timeout')
                });
                break;
            case 'estimation-bundler':
                errorCallback({
                    level: 'major',
                    message: 'Estimating gas limits from the bundler timed out. Retrying...',
                    error: new Error('Budler gas limit estimation timeout')
                });
                break;
            case 'estimation-eoa':
                errorCallback({
                    level: 'major',
                    message: 'Estimating gas limits for Basic Account from the RPC timed out. Retrying...',
                    error: new Error('Budler gas limit estimation timeout')
                });
                break;
            default:
                break;
        }
        result = await estimateWithRetries(fetchRequests, timeoutType, errorCallback, timeoutInMill, incremented);
    }
    else {
        // if one of the calls returns an error, return it
        const error = Array.isArray(result) ? result.find((res) => res instanceof Error) : null;
        if (error)
            return error;
    }
    // success outcome
    return result;
}
//# sourceMappingURL=estimateWithRetries.js.map