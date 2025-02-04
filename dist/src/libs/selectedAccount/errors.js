import { DeFiPositionsError } from '../defiPositions/types';
import { getNetworksWithFailedRPC } from '../networks/networks';
import { PORTFOLIO_LIB_ERROR_NAMES } from '../portfolio/portfolio';
const TEN_MINUTES = 10 * 60 * 1000;
export const getNetworksWithFailedRPCErrors = ({ providers, networks, networksWithAssets }) => {
    const errors = [];
    const networkIds = getNetworksWithFailedRPC({ providers }).filter((networkId) => (Object.keys(networksWithAssets).includes(networkId) &&
        networksWithAssets[networkId] === true) ||
        !Object.keys(networksWithAssets).includes(networkId));
    const networksData = networkIds.map((id) => networks.find((n) => n.id === id));
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
            id: `custom-rpcs-down-${n.id}`,
            networkIds: [n.id],
            type: 'error',
            title: `Failed to retrieve network data for ${n.name}. You can try selecting another RPC URL`,
            text: 'Affected features: visible assets, DeFi positions, sign message/transaction, ENS/UD domain resolving, add account.',
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
        networkIds: networksToGroupInSingleBanner.map((n) => n.id),
        type: 'error',
        title: `Failed to retrieve network data for ${networksToGroupInSingleBanner
            .map((n) => n.name)
            .join(', ')} (RPC malfunction)`,
        text: 'Affected features: visible assets, DeFi positions, sign message/transaction, ENS/UD domain resolving, add account.'
    });
    return errors;
};
const addPortfolioError = (errors, networkId, newError) => {
    const newErrors = [...errors];
    const existingError = newErrors.find((error) => error.id === newError);
    if (existingError) {
        existingError.networkIds.push(networkId);
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
            case PORTFOLIO_LIB_ERROR_NAMES.PriceFetchError:
                title = 'Failed to retrieve prices';
                text = 'Account balance and asset prices may be inaccurate.';
                type = 'warning';
                break;
            case PORTFOLIO_LIB_ERROR_NAMES.NoApiHintsError:
                title = 'Automatic asset discovery is temporarily unavailable';
                text =
                    'Your funds are safe, but your portfolio will be inaccurate. You can add assets manually or wait for the issue to be resolved.';
                break;
            case PORTFOLIO_LIB_ERROR_NAMES.StaleApiHintsError:
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
            networkIds: [networkId],
            type,
            title,
            text
        });
    }
    return newErrors;
};
export const getNetworksWithPortfolioErrorErrors = ({ networks, selectedAccountLatest, providers }) => {
    let errors = [];
    const portfolioLoading = Object.keys(selectedAccountLatest).some((network) => {
        const portfolioForNetwork = selectedAccountLatest[network];
        return portfolioForNetwork?.isLoading;
    });
    // Otherwise networks are appended to the banner one by one, which looks weird
    if (portfolioLoading)
        return [];
    if (!Object.keys(selectedAccountLatest).length)
        return [];
    Object.keys(selectedAccountLatest).forEach((network) => {
        const portfolioForNetwork = selectedAccountLatest[network];
        const criticalError = portfolioForNetwork?.criticalError;
        const lastSuccessfulUpdate = portfolioForNetwork?.result?.lastSuccessfulUpdate;
        // Don't display an error banner if the last successful update was less than 10 minutes ago
        if (typeof lastSuccessfulUpdate === 'number' && Date.now() - lastSuccessfulUpdate < TEN_MINUTES)
            return;
        if (!portfolioForNetwork || !network || portfolioForNetwork.isLoading)
            return;
        // Don't display an error banner if the RPC isn't working because an RPC error banner is already displayed.
        // In case of additional networks don't check the RPC as there isn't one
        if (criticalError &&
            (['gasTank', 'rewards'].includes(network) || providers[network]?.isWorking)) {
            errors = addPortfolioError(errors, network, 'portfolio-critical');
            return;
        }
        portfolioForNetwork?.errors.forEach((err) => {
            errors = addPortfolioError(errors, network, err.name);
        });
    });
    return errors.map(({ title, networkIds, ...rest }) => {
        const networkNames = networkIds.reduce((acc, id, index) => {
            let networkName = networks.find((n) => n.id === id)?.name;
            const isLast = index === networkIds.length - 1;
            const isOnly = networkIds.length === 1;
            if (id === 'gasTank')
                networkName = 'Gas Tank';
            else if (id === 'rewards')
                networkName = 'Rewards';
            if (!networkName)
                return acc;
            return `${acc}${networkName}${isLast || isOnly ? '' : ', '}`;
        }, '');
        return {
            ...rest,
            title: `${title} on ${networkNames}`,
            networkIds
        };
    });
};
export const getNetworksWithDeFiPositionsErrorErrors = ({ networks, currentAccountState, providers, networksWithPositions }) => {
    const isLoading = Object.keys(currentAccountState).some((networkId) => {
        const networkState = currentAccountState[networkId];
        return networkState.isLoading;
    });
    if (isLoading)
        return [];
    const networkNamesWithUnknownCriticalError = [];
    const networkNamesWithAssetPriceCriticalError = [];
    const providersWithErrors = {};
    Object.keys(currentAccountState).forEach((networkId) => {
        const providersWithPositions = networksWithPositions[networkId];
        // Ignore networks that don't have positions
        // but ensure that we have a successful response stored (the network key is present)
        if (providersWithPositions && !providersWithPositions.length)
            return;
        const networkState = currentAccountState[networkId];
        const network = networks.find((n) => n.id === networkId);
        const rpcProvider = providers[networkId];
        const lastSuccessfulUpdate = networkState.updatedAt;
        if (!network ||
            !networkState ||
            (typeof lastSuccessfulUpdate === 'number' &&
                Date.now() - lastSuccessfulUpdate < TEN_MINUTES) ||
            // Don't display an error banner if the RPC isn't working because an RPC error banner is already displayed.
            (typeof rpcProvider.isWorking === 'boolean' && !rpcProvider.isWorking))
            return;
        if (networkState.error) {
            if (networkState.error === DeFiPositionsError.AssetPriceError) {
                networkNamesWithAssetPriceCriticalError.push(network.name);
            }
            else if (networkState.error === DeFiPositionsError.CriticalError) {
                networkNamesWithUnknownCriticalError.push(network.name);
            }
        }
        const providerNamesWithErrors = networkState.providerErrors
            ?.filter(({ providerName }) => {
            // Display all errors if there hasn't been a successful update
            // for the network.
            if (!networksWithPositions[networkId])
                return true;
            // Exclude providers without positions
            return networksWithPositions[networkId].includes(providerName);
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
            networkIds: networkNames.map((n) => networks.find((network) => network.name === n)?.id),
            title: `Failed to retrieve DeFi positions for ${providerName} on ${networkNames.join(', ')}`
        };
    });
    const errors = providerErrors;
    if (networkNamesWithUnknownCriticalError.length) {
        errors.push({
            id: 'defi-critical',
            type: 'error',
            title: `Failed to retrieve DeFi positions on ${networkNamesWithUnknownCriticalError.join(', ')}`,
            networkIds: networkNamesWithUnknownCriticalError.map((n) => networks.find((network) => network.name === n)?.id)
        });
    }
    if (networkNamesWithAssetPriceCriticalError.length) {
        errors.push({
            id: 'defi-prices',
            type: 'warning',
            title: `Failed to retrieve asset prices for DeFi positions on ${networkNamesWithAssetPriceCriticalError.join(', ')}`,
            networkIds: networkNamesWithAssetPriceCriticalError.map((n) => networks.find((network) => network.name === n)?.id)
        });
    }
    return errors;
};
//# sourceMappingURL=errors.js.map