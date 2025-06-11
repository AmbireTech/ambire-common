"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNetworksWithDeFiPositionsErrorErrors = exports.getNetworksWithPortfolioErrorErrors = exports.getNetworksWithFailedRPCErrors = void 0;
const types_1 = require("../defiPositions/types");
const networks_1 = require("../networks/networks");
const portfolio_1 = require("../portfolio/portfolio");
const TEN_MINUTES = 10 * 60 * 1000;
const getNetworksWithFailedRPCErrors = ({ providers, networks, networksWithAssets }) => {
    const errors = [];
    const chainIds = (0, networks_1.getNetworksWithFailedRPC)({ providers }).filter((chainId) => (Object.keys(networksWithAssets).includes(chainId) && networksWithAssets[chainId] === true) ||
        !Object.keys(networksWithAssets).includes(chainId));
    const networksData = chainIds.map((id) => networks.find((n) => n.chainId.toString() === id));
    const allFailed = networksData.length === networks.length;
    const networksWithMultipleRpcUrls = allFailed
        ? []
        : networksData.filter((n) => n?.rpcUrls?.length > 1);
    const networksToGroupInSingleBanner = allFailed
        ? networksData
        : networksData.filter((n) => n?.rpcUrls?.length <= 1);
    if (!networksData.length)
        return errors;
    networksWithMultipleRpcUrls.forEach((n) => {
        errors.push({
            id: `custom-rpcs-down-${n.chainId}`,
            networkNames: [n.name],
            type: 'error',
            title: `Failed to retrieve network data for ${n.name}. You can try selecting another RPC URL`,
            text: 'Affected features: visible assets, DeFi positions, sign message/transaction, ENS domain resolving, add account.',
            actions: [
                {
                    label: 'Select',
                    actionName: 'select-rpc-url',
                    meta: { network: n }
                }
            ]
        });
    });
    if (!networksToGroupInSingleBanner.length)
        return errors;
    errors.push({
        id: 'rpcs-down',
        networkNames: networksToGroupInSingleBanner.map((n) => n.name),
        type: 'error',
        title: `Failed to retrieve network data for ${networksToGroupInSingleBanner
            .map((n) => n.name)
            .join(', ')} (RPC malfunction)`,
        text: 'Affected features: visible assets, DeFi positions, sign message/transaction, ENS domain resolving, add account.'
    });
    return errors;
};
exports.getNetworksWithFailedRPCErrors = getNetworksWithFailedRPCErrors;
const addPortfolioError = (errors, networkName, newError) => {
    const newErrors = [...errors];
    const existingError = newErrors.find((error) => error.id === newError);
    if (existingError) {
        existingError.networkNames.push(networkName);
    }
    else {
        let title = '';
        let text = '';
        let type = 'error';
        switch (newError) {
            case 'portfolio-critical':
                title = 'Failed to retrieve the portfolio data';
                text = 'Account balance and visible assets may be inaccurate.';
                break;
            case 'loading-too-long':
                title = 'Loading is taking longer than expected';
                text = 'Account balance and visible assets may be inaccurate.';
                type = 'warning';
                break;
            case portfolio_1.PORTFOLIO_LIB_ERROR_NAMES.PriceFetchError:
                title = 'Failed to retrieve prices';
                text = 'Account balance and asset prices may be inaccurate.';
                type = 'warning';
                break;
            case portfolio_1.PORTFOLIO_LIB_ERROR_NAMES.NoApiHintsError:
                title = 'Automatic asset discovery is temporarily unavailable';
                text =
                    'Your funds are safe, but your portfolio will be inaccurate. You can add assets manually or wait for the issue to be resolved.';
                break;
            case portfolio_1.PORTFOLIO_LIB_ERROR_NAMES.StaleApiHintsError:
                title = 'Automatic asset discovery is temporarily unavailable';
                text =
                    'New assets may not be visible in your portfolio. You can add assets manually or wait for the issue to be resolved.';
                type = 'warning';
                break;
            default:
                break;
        }
        if (!title)
            return newErrors;
        newErrors.push({
            id: newError,
            networkNames: [networkName],
            type,
            title,
            text
        });
    }
    return newErrors;
};
const getNetworksWithPortfolioErrorErrors = ({ networks, selectedAccountLatest, providers, isAllReady }) => {
    let errors = [];
    if (!Object.keys(selectedAccountLatest).length)
        return [];
    Object.keys(selectedAccountLatest).forEach((chainId) => {
        const portfolioForNetwork = selectedAccountLatest[chainId];
        const criticalError = portfolioForNetwork?.criticalError;
        const lastSuccessfulUpdate = portfolioForNetwork?.result?.lastSuccessfulUpdate;
        let networkName = networks.find((n) => n.chainId.toString() === chainId)?.name;
        if (chainId === 'gasTank')
            networkName = 'Gas Tank';
        else if (chainId === 'rewards')
            networkName = 'Rewards';
        if (!networkName) {
            console.error('Network name not found for network in getNetworksWithPortfolioErrorErrors', chainId);
            return;
        }
        if (portfolioForNetwork?.isLoading) {
            // Add an error if the network is preventing the portfolio from going ready
            // Otherwise skip the network
            if (!isAllReady)
                errors = addPortfolioError(errors, networkName, 'loading-too-long');
            return;
        }
        // Don't display an error banner if the last successful update was less than 10 minutes ago
        if (typeof lastSuccessfulUpdate === 'number' && Date.now() - lastSuccessfulUpdate < TEN_MINUTES)
            return;
        if (!portfolioForNetwork || !chainId || portfolioForNetwork.isLoading)
            return;
        // Don't display an error banner if the RPC isn't working because an RPC error banner is already displayed.
        // In case of additional networks don't check the RPC as there isn't one
        if (criticalError &&
            (['gasTank', 'rewards'].includes(chainId) || providers[chainId]?.isWorking)) {
            errors = addPortfolioError(errors, networkName, 'portfolio-critical');
            return;
        }
        portfolioForNetwork?.errors.forEach((err) => {
            errors = addPortfolioError(errors, networkName, err.name);
        });
    });
    return errors.map(({ title, networkNames, ...rest }) => {
        const networkNamesString = networkNames.reduce((acc, name, index) => {
            const isLast = index === networkNames.length - 1;
            const isOnly = networkNames.length === 1;
            return `${acc}${name}${isLast || isOnly ? '' : ', '}`;
        }, '');
        return {
            ...rest,
            title: `${title} on ${networkNamesString}`,
            networkNames
        };
    });
};
exports.getNetworksWithPortfolioErrorErrors = getNetworksWithPortfolioErrorErrors;
const getNetworksWithDeFiPositionsErrorErrors = ({ networks, currentAccountState, providers, networksWithPositions }) => {
    const isLoading = Object.keys(currentAccountState).some((chainId) => {
        const networkState = currentAccountState[chainId];
        return networkState.isLoading;
    });
    if (isLoading)
        return [];
    const networkNamesWithUnknownCriticalError = [];
    const networkNamesWithAssetPriceCriticalError = [];
    const providersWithErrors = {};
    Object.keys(currentAccountState).forEach((chainId) => {
        const providersWithPositions = networksWithPositions[chainId];
        // Ignore networks that don't have positions
        // but ensure that we have a successful response stored (the network key is present)
        if (providersWithPositions && !providersWithPositions.length)
            return;
        const networkState = currentAccountState[chainId];
        const network = networks.find((n) => n.chainId.toString() === chainId);
        const rpcProvider = providers[chainId];
        const lastSuccessfulUpdate = networkState.updatedAt;
        if (!network ||
            !networkState ||
            (typeof lastSuccessfulUpdate === 'number' &&
                Date.now() - lastSuccessfulUpdate < TEN_MINUTES) ||
            // Don't display an error banner if the RPC isn't working because an RPC error banner is already displayed.
            (typeof rpcProvider.isWorking === 'boolean' && !rpcProvider.isWorking))
            return;
        if (networkState.error) {
            if (networkState.error === types_1.DeFiPositionsError.AssetPriceError) {
                networkNamesWithAssetPriceCriticalError.push(network.name);
            }
            else if (networkState.error === types_1.DeFiPositionsError.CriticalError) {
                networkNamesWithUnknownCriticalError.push(network.name);
            }
        }
        const providerNamesWithErrors = networkState.providerErrors
            ?.filter(({ providerName }) => {
            // Display all errors if there hasn't been a successful update
            // for the network.
            if (!networksWithPositions[chainId])
                return true;
            // Exclude providers without positions
            return networksWithPositions[chainId].includes(providerName);
        })
            .map((e) => e.providerName) || [];
        if (providerNamesWithErrors.length) {
            providerNamesWithErrors.forEach((providerName) => {
                if (!providersWithErrors[providerName])
                    providersWithErrors[providerName] = [];
                providersWithErrors[providerName].push(network.name);
            });
        }
    });
    const providerErrors = Object.entries(providersWithErrors).map(([providerName, networkNames]) => {
        return {
            id: `${providerName}-defi-positions-error`,
            type: 'error',
            networkNames,
            title: `Failed to retrieve DeFi positions for ${providerName} on ${networkNames.join(', ')}`
        };
    });
    const errors = providerErrors;
    if (networkNamesWithUnknownCriticalError.length) {
        errors.push({
            id: 'defi-critical',
            type: 'error',
            title: `Failed to retrieve DeFi positions on ${networkNamesWithUnknownCriticalError.join(', ')}`,
            networkNames: networkNamesWithUnknownCriticalError
        });
    }
    if (networkNamesWithAssetPriceCriticalError.length) {
        errors.push({
            id: 'defi-prices',
            type: 'warning',
            title: `Failed to retrieve asset prices for DeFi positions on ${networkNamesWithAssetPriceCriticalError.join(', ')}`,
            networkNames: networkNamesWithAssetPriceCriticalError
        });
    }
    return errors;
};
exports.getNetworksWithDeFiPositionsErrorErrors = getNetworksWithDeFiPositionsErrorErrors;
//# sourceMappingURL=errors.js.map