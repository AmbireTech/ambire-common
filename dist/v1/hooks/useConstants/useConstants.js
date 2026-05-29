import { useCallback, useEffect, useState } from 'react';
import { fetchCaught } from '../../services/fetch';
const useConstants = ({ fetch, endpoint }) => {
    const [data, setData] = useState(null);
    const [adexToStakingTransfers, setAdexToStakingTransfers] = useState(null);
    const [hasError, setHasError] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const fetchConstants = useCallback(async () => {
        try {
            const response = await fetchCaught(fetch, `${endpoint}/result.json`).then((res) => res.body);
            if (!response)
                throw new Error('Failed to get the constants.');
            const { tokenList, humanizerInfo, customTokens } = response;
            setIsLoading(() => {
                setData({
                    tokenList,
                    humanizerInfo,
                    customTokens,
                    lastFetched: Date.now()
                });
                setHasError(false);
                return false;
            });
        }
        catch (e) {
            setHasError(true);
            setData(null);
            setIsLoading(false);
        }
    }, [fetch, endpoint]);
    useEffect(() => {
        fetchConstants();
    }, [fetchConstants]);
    const getAdexToStakingTransfersLogs = async () => {
        if (adexToStakingTransfers)
            return adexToStakingTransfers;
        try {
            const adexToStakingTransfersLogs = await fetchCaught(fetch, `${endpoint}/adexToStakingTransfers.json`).then((res) => res.body || null);
            setAdexToStakingTransfers(adexToStakingTransfersLogs);
            return adexToStakingTransfersLogs;
        }
        catch (e) {
            return null;
        }
    };
    return {
        constants: data,
        getAdexToStakingTransfersLogs,
        isLoading,
        retryFetch: fetchConstants,
        hasError
    };
};
export default useConstants;
//# sourceMappingURL=useConstants.js.map