"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const react_1 = require("react");
const fetch_1 = require("../../services/fetch");
const useConstants = ({ fetch, endpoint }) => {
    const [data, setData] = (0, react_1.useState)(null);
    const [adexToStakingTransfers, setAdexToStakingTransfers] = (0, react_1.useState)(null);
    const [hasError, setHasError] = (0, react_1.useState)(false);
    const [isLoading, setIsLoading] = (0, react_1.useState)(true);
    const fetchConstants = (0, react_1.useCallback)(async () => {
        try {
            const response = await (0, fetch_1.fetchCaught)(fetch, `${endpoint}/result.json`).then((res) => res.body);
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
    (0, react_1.useEffect)(() => {
        fetchConstants();
    }, [fetchConstants]);
    const getAdexToStakingTransfersLogs = async () => {
        if (adexToStakingTransfers)
            return adexToStakingTransfers;
        try {
            const adexToStakingTransfersLogs = await (0, fetch_1.fetchCaught)(fetch, `${endpoint}/adexToStakingTransfers.json`).then((res) => res.body || null);
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
exports.default = useConstants;
//# sourceMappingURL=useConstants.js.map