"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDefiPositionsOnDisabledNetworksForTheSelectedAccount = exports.defiPositionsOnDisabledNetworksBannerId = exports.getEnsExpiryBanner = exports.ensExpiryBannerId = exports.getKeySyncBanner = exports.getAccountOpBanners = exports.getDappUserRequestsBanners = exports.getSafeMessageRequestBanners = exports.getIntentBanners = exports.getCurrentAccountBanners = void 0;
exports.getScamDetectedText = getScamDetectedText;
const addresses_1 = require("../../consts/addresses");
const ensDomains_1 = require("../../services/ensDomains/ensDomains");
const swapAndBridge_1 = require("../swapAndBridge/swapAndBridge");
const getCurrentAccountBanners = (banners, selectedAccount) => banners.filter((banner) => {
    if (!banner.meta?.accountAddr)
        return true;
    return banner.meta.accountAddr === selectedAccount;
});
exports.getCurrentAccountBanners = getCurrentAccountBanners;
const getIntentBanners = (activeRoutes, callsUserRequests, accountAddr) => {
    const isRouteTurnedIntoAccountOp = (route) => {
        return callsUserRequests.some((req) => {
            return req.signAccountOp.accountOp.calls.some((call) => call.id === route.activeRouteId ||
                call.id === `${route.activeRouteId}-revoke-approval` ||
                call.id === `${route.activeRouteId}-approval`);
        });
    };
    const filteredRoutes = activeRoutes.filter((route) => {
        if (!route.route || !(0, swapAndBridge_1.getIsIntentRoute)(route.route))
            return false;
        if (route.routeStatus !== 'ready' && route.routeStatus !== 'waiting-approval-to-resolve')
            return true;
        return !isRouteTurnedIntoAccountOp(route);
    });
    const inProgressRoutes = filteredRoutes.filter((r) => r.routeStatus === 'in-progress');
    const failedRoutes = filteredRoutes.filter((r) => r.routeStatus === 'failed');
    const completedRoutes = filteredRoutes.filter((r) => r.routeStatus === 'completed');
    const refundedRoutes = filteredRoutes.filter((r) => r.routeStatus === 'refunded');
    const allRoutes = [...inProgressRoutes, ...failedRoutes, ...completedRoutes, ...refundedRoutes];
    const onlyBridges = filteredRoutes.every((route) => route.route && (0, swapAndBridge_1.getIsBridgeRoute)(route.route));
    const onlySwaps = filteredRoutes.every((route) => route.route && !(0, swapAndBridge_1.getIsBridgeRoute)(route.route));
    const actionWordUppercase = onlyBridges ? 'Bridge' : onlySwaps ? 'Swap' : 'Transaction';
    const actionWordLower = actionWordUppercase.toLowerCase();
    let title = '';
    let text = '';
    let type;
    if (inProgressRoutes.length > 0) {
        type = 'info';
        title = `${actionWordUppercase}${inProgressRoutes.length > 1 ? 's' : ''} in progress`;
        text = `You have ${inProgressRoutes.length} pending ${actionWordLower}${inProgressRoutes.length > 1 ? 's' : ''}`;
    }
    else if (failedRoutes.length > 0) {
        type = 'error';
        title = `Failed ${actionWordLower}${failedRoutes.length > 1 ? 's' : ''}`;
        text = `You have ${failedRoutes.length} failed ${actionWordLower}${failedRoutes.length > 1 ? 's' : ''}${completedRoutes.length > 1
            ? ` and ${completedRoutes.length} completed ${actionWordLower}${completedRoutes.length > 1 ? 's' : ''}`
            : ''}${refundedRoutes.length > 1
            ? ` and ${refundedRoutes.length} refunded ${actionWordLower}${refundedRoutes.length > 1 ? 's' : ''}`
            : ''}`;
    }
    else if (refundedRoutes.length > 0) {
        type = 'warning';
        title = `Refunded ${actionWordLower}${refundedRoutes.length > 1 ? 's' : ''}`;
        text = `You have ${refundedRoutes.length} refunded ${actionWordLower}${refundedRoutes.length > 1 ? 's' : ''}${completedRoutes.length > 1
            ? ` and ${completedRoutes.length} completed ${actionWordLower}${completedRoutes.length > 1 ? 's' : ''}`
            : ''}`;
    }
    else {
        type = 'success';
        title = `${actionWordUppercase}${completedRoutes.length > 1 ? 's' : ''} completed`;
        text = `You have ${completedRoutes.length} completed ${actionWordLower}${completedRoutes.length > 1 ? 's' : ''}.`;
    }
    const banners = [];
    if (allRoutes.length > 0) {
        banners.push({
            id: 'bridge-in-progress',
            type,
            category: 'bridge-in-progress',
            title,
            text,
            meta: {
                accountAddr
            },
            actions: [
                {
                    actionName: 'view-bridge',
                    label: 'View'
                }
            ],
            dismissAction: {
                label: 'Dismiss',
                actionName: 'close-bridge',
                meta: {
                    activeRouteIds: allRoutes.map((r) => r.activeRouteId),
                    isHideStyle: true
                }
            }
        });
    }
    return banners;
};
exports.getIntentBanners = getIntentBanners;
const getSafeMessageRequestBanners = (account, userRequests) => {
    if (!account.safeCreation)
        return [];
    const requests = userRequests.filter((r) => ['message', 'typedMessage', 'siwe'].includes(r.kind));
    if (!requests.length)
        return [];
    return [
        {
            id: 'safe-message-request-banner',
            type: 'info',
            title: `Pending signature request${requests.length > 1 ? 's' : ''}`,
            text: '',
            meta: {
                accountAddr: account.addr
            },
            actions: [
                {
                    actionName: 'open-pending-dapp-requests',
                    label: 'Open'
                }
            ]
        }
    ];
};
exports.getSafeMessageRequestBanners = getSafeMessageRequestBanners;
const getDappUserRequestsBanners = (account, userRequests) => {
    if (!!account.safeCreation)
        return [];
    const requests = userRequests.filter((r) => !['calls', 'benzin', 'swapAndBridge', 'transfer'].includes(r.kind));
    if (!requests.length)
        return [];
    return [
        {
            id: 'dapp-requests-banner',
            type: 'info',
            title: `You have ${requests.length} pending app request${requests.length > 1 ? 's' : ''}`,
            text: '',
            meta: {
                accountAddr: account.addr
            },
            actions: [
                {
                    actionName: 'open-pending-dapp-requests',
                    label: 'Open'
                }
            ]
        }
    ];
};
exports.getDappUserRequestsBanners = getDappUserRequestsBanners;
const getSafeBanner = ({ requests, network, selectedAccount }) => {
    // count the requests for Safe accounts instead of the calls
    const requestCount = requests.length;
    const firstReq = requests[0];
    if (requestCount === 0 || !firstReq)
        return null;
    return {
        id: `${selectedAccount.addr}-${network.chainId.toString()}`,
        type: 'info',
        category: 'pending-to-be-signed-acc-op',
        // the network is rendered by the UI on a second row, below the title
        title: requestCount === 1 ? 'Pending transaction' : `${requestCount} Pending transactions`,
        meta: { chainId: network.chainId, accountAddr: selectedAccount.addr },
        actions: [
            {
                actionName: 'open-accountOp',
                meta: { requestId: firstReq.id },
                label: 'Open'
            }
        ],
        dismissAction: requestCount === 1
            ? {
                label: 'Reject',
                actionName: 'reject-accountOp',
                meta: {
                    err: 'User rejected the transaction request.',
                    requestId: firstReq.id,
                    shouldOpenNextAction: false
                }
            }
            : undefined
    };
};
const getAccountOpBanners = ({ callsUserRequestsByNetwork, selectedAccount, networks }) => {
    if (!callsUserRequestsByNetwork)
        return [];
    const txnBanners = [];
    Object.entries(callsUserRequestsByNetwork).forEach(([netId, requests]) => {
        // push all safe request for 1 network in a single banner
        if (!!selectedAccount.safeCreation) {
            const network = networks.find((n) => n.chainId.toString() === netId);
            if (!network)
                return;
            // we're displaying dashboard banners only for requests that
            // aren't in a signing phase
            const notSignedRequests = requests.filter((r) => (r.signAccountOp.accountOp.signed || []).length === 0);
            if (!notSignedRequests.length)
                return;
            const safeBanner = getSafeBanner({
                requests: notSignedRequests,
                network,
                selectedAccount
            });
            if (safeBanner)
                txnBanners.push(safeBanner);
            return;
        }
        requests.forEach((request) => {
            const network = networks.filter((n) => n.chainId.toString() === netId)[0];
            const callCount = request.signAccountOp.accountOp.calls.length;
            txnBanners.push({
                id: `${selectedAccount.addr}-${netId}`,
                type: 'info',
                category: 'pending-to-be-signed-acc-op',
                // the network is rendered by the UI on a second row, below the title
                title: callCount === 1 ? 'Pending transaction' : `${callCount} Pending transactions`,
                text: '',
                meta: { chainId: network.chainId, accountAddr: selectedAccount.addr },
                actions: [
                    {
                        actionName: 'open-accountOp',
                        meta: { requestId: request.id },
                        label: 'Open'
                    }
                ],
                dismissAction: {
                    label: 'Reject',
                    actionName: 'reject-accountOp',
                    meta: {
                        err: 'User rejected the transaction request.',
                        requestId: request.id,
                        shouldOpenNextAction: false
                    }
                }
            });
        });
    });
    return txnBanners;
};
exports.getAccountOpBanners = getAccountOpBanners;
const getKeySyncBanner = (addr, email, keys) => {
    const banner = {
        id: `keys-sync:${addr}:${email}`,
        meta: {
            accountAddr: addr
        },
        type: 'info',
        title: 'Sync Key Store keys',
        text: 'This account has no signing keys added therefore it is in a view-only mode. Make a request for keys sync from another device.',
        actions: [
            {
                actionName: 'sync-keys',
                meta: { email, keys },
                label: 'Sync'
            }
        ]
    };
    return banner;
};
exports.getKeySyncBanner = getKeySyncBanner;
exports.ensExpiryBannerId = 'ens-expiry-banner';
/**
 * Banner warning that the selected account's own ENS name is expiring soon or is in the grace period.
 * Escalates from a warning to an error once the name has expired.
 */
const getEnsExpiryBanner = ({ accountAddr, ens, expiresAt, gracePeriodEndsAt }) => {
    const now = Date.now();
    if (now < expiresAt - ensDomains_1.ENS_EXPIRY_WARN_WINDOW_IN_MS)
        return null;
    if (now > gracePeriodEndsAt)
        return null;
    const hasExpired = now > expiresAt;
    const type = hasExpired ? 'error' : 'warning';
    return {
        id: exports.ensExpiryBannerId,
        type,
        title: hasExpired
            ? `Your ENS name ${ens} has expired`
            : `Your ENS name ${ens} is expiring soon`,
        text: hasExpired
            ? 'It is in the grace period. Renew it now - once released, the name can be taken over and funds others send to it could reach someone else.'
            : 'Renew it to keep ownership. Expired names can be taken over, and funds others send to the name could reach someone else.',
        actions: [
            {
                actionName: 'open-external-url',
                meta: {
                    url: `https://app.ens.domains/${ens}?referrer=${addresses_1.FEE_COLLECTOR}`
                },
                label: 'Renew'
            }
        ],
        dismissAction: {
            actionName: 'dismiss-ens-expiry-banner',
            label: 'Dismiss'
        },
        meta: {
            accountAddr
        }
    };
};
exports.getEnsExpiryBanner = getEnsExpiryBanner;
exports.defiPositionsOnDisabledNetworksBannerId = 'defi-positions-on-disabled-networks-banner';
const getDefiPositionsOnDisabledNetworksForTheSelectedAccount = ({ defiPositionsCountOnDisabledNetworks, networks, accountAddr }) => {
    const banners = [];
    const disabledNetworks = networks.filter((n) => n.disabled);
    if (!disabledNetworks.length)
        return [];
    const disabledNetworksWithDefiPos = new Set();
    let totalCount = 0;
    Object.entries(defiPositionsCountOnDisabledNetworks).forEach(([chainId, count]) => {
        totalCount += count;
        if (count > 0) {
            const network = disabledNetworks.find((n) => n.chainId.toString() === chainId);
            if (network) {
                disabledNetworksWithDefiPos.add(network);
            }
        }
    });
    if (!disabledNetworksWithDefiPos.size)
        return [];
    const disabledNetworksWithDefiPosArray = [...disabledNetworksWithDefiPos];
    const formatNetworkNames = (names) => {
        if (names.length === 1)
            return names[0];
        if (names.length === 2)
            return `${names[0]} and ${names[1]}`;
        return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
    };
    const formattedNetworkNames = formatNetworkNames(disabledNetworksWithDefiPosArray.map((n) => n.name));
    banners.push({
        id: exports.defiPositionsOnDisabledNetworksBannerId,
        type: 'info',
        title: `DeFi ${totalCount === 1 ? 'position' : 'positions'} available on ${formattedNetworkNames}`,
        text: `Ambire API data providers report ${totalCount} more DeFi ${totalCount === 1 ? 'position' : 'positions'}. Enable ${disabledNetworksWithDefiPosArray.length > 1 ? 'these networks' : 'this network'} to include ${totalCount === 1 ? 'it' : 'them'}?`,
        actions: [
            {
                actionName: 'enable-networks',
                meta: { networkChainIds: disabledNetworksWithDefiPosArray.map((n) => n.chainId) },
                label: totalCount === 1 ? `Enable ${formattedNetworkNames}` : 'Enable All'
            }
        ],
        dismissAction: {
            label: 'Dismiss',
            actionName: 'dismiss-defi-positions-banner'
        },
        meta: {
            accountAddr
        }
    });
    return banners;
};
exports.getDefiPositionsOnDisabledNetworksForTheSelectedAccount = getDefiPositionsOnDisabledNetworksForTheSelectedAccount;
function getScamDetectedText(blacklistedItems) {
    const blacklistedItemsCount = blacklistedItems.length;
    const hasScamAddress = blacklistedItems.some((i) => i.type === 'address');
    const hasScamToken = blacklistedItems.some((i) => i.type === 'token');
    const isSingle = blacklistedItemsCount === 1;
    let label = '';
    if (hasScamAddress && hasScamToken) {
        label = blacklistedItemsCount === 2 ? 'address or token' : 'addresses or tokens';
    }
    else if (hasScamAddress) {
        label = isSingle ? 'address' : 'addresses';
    }
    else if (hasScamToken) {
        label = isSingle ? 'token' : 'tokens';
    }
    const prefix = isSingle
        ? `The destination ${label}`
        : `${blacklistedItemsCount} of the destination ${label}`;
    return `${prefix} in this transaction ${isSingle ? 'was' : 'were'} flagged as dangerous. Proceed at your own risk.`;
}
//# sourceMappingURL=banners.js.map