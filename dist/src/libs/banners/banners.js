"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFirstCashbackBanners = exports.getKeySyncBanner = exports.getAccountOpBanners = exports.getDappActionRequestsBanners = exports.getBridgeBanners = void 0;
const swapAndBridge_1 = require("../swapAndBridge/swapAndBridge");
const getBridgeActionText = (routeStatus, isBridgeTxn) => {
    if (isBridgeTxn) {
        return routeStatus === 'completed' ? 'Bridged' : 'Bridge';
    }
    return routeStatus === 'completed' ? 'Swapped' : 'Swap';
};
const getBridgeBannerText = (route, isBridgeTxn, networks) => {
    const steps = route.route?.steps || [];
    if (!steps[0])
        return ''; // should never happen
    const actionText = getBridgeActionText(route.routeStatus, isBridgeTxn);
    const fromAssetSymbol = steps[0].fromAsset.symbol;
    const toAssetSymbol = steps[steps.length - 1].toAsset.symbol;
    let assetsText = `${fromAssetSymbol} to ${toAssetSymbol}`;
    if (networks) {
        const fromAssetNetwork = networks.find((n) => Number(n.chainId) === steps[0].fromAsset.chainId);
        const toAssetNetwork = networks.find((n) => Number(n.chainId) === steps[steps.length - 1].toAsset.chainId);
        if (fromAssetNetwork && toAssetNetwork) {
            assetsText = `${fromAssetSymbol} (on ${fromAssetNetwork.name}) to ${toAssetSymbol} (on ${toAssetNetwork.name})`;
        }
    }
    return `${actionText} ${assetsText}`;
};
const getBridgeBanners = (activeRoutes, accountOpActions) => {
    const isBridgeTxn = (route) => !!route.route?.userTxs.some((t) => (0, swapAndBridge_1.getIsBridgeTxn)(t.userTxType));
    const isRouteTurnedIntoAccountOp = (route) => {
        return accountOpActions.some((action) => {
            return action.accountOp.calls.some((call) => call.fromUserRequestId === route.activeRouteId ||
                call.fromUserRequestId === `${route.activeRouteId}-revoke-approval` ||
                call.fromUserRequestId === `${route.activeRouteId}-approval`);
        });
    };
    const filteredRoutes = activeRoutes.filter(isBridgeTxn).filter((route) => {
        if (route.routeStatus !== 'ready' && route.routeStatus !== 'waiting-approval-to-resolve')
            return true;
        return !isRouteTurnedIntoAccountOp(route);
    });
    const inProgressRoutes = filteredRoutes.filter((r) => r.routeStatus === 'in-progress');
    const failedRoutes = filteredRoutes.filter((r) => r.routeStatus === 'failed');
    const completedRoutes = filteredRoutes.filter((r) => r.routeStatus === 'completed');
    const allRoutes = [...inProgressRoutes, ...failedRoutes, ...completedRoutes];
    let title = '';
    let text = '';
    let type;
    if (inProgressRoutes.length > 0) {
        type = 'info';
        title = `Bridge${allRoutes.length > 1 ? 's' : ''} in progress`;
        text = `You have ${allRoutes.length} pending bridge${allRoutes.length > 1 ? 's' : ''}`;
    }
    else if (failedRoutes.length > 0) {
        type = 'error';
        title = `Failed bridge${failedRoutes.length > 1 ? 's' : ''}`;
        text = `You have ${failedRoutes.length} failed bridge${failedRoutes.length > 1 ? 's' : ''}${completedRoutes.length > 1
            ? ` and ${completedRoutes.length} completed bridge${completedRoutes.length > 1 ? 's' : ''}`
            : ''}`;
    }
    else {
        type = 'success';
        title = `Bridge${completedRoutes.length > 1 ? 's' : ''} completed`;
        text = `You have ${completedRoutes.length} completed bridge${completedRoutes.length > 1 ? 's' : ''}.`;
    }
    const banners = [];
    if (allRoutes.length > 0) {
        banners.push({
            id: 'bridge-in-progress',
            type,
            category: 'bridge-in-progress',
            title,
            text,
            actions: [
                {
                    label: 'Close',
                    actionName: 'close-bridge',
                    meta: {
                        activeRouteIds: allRoutes.map((r) => r.activeRouteId),
                        isHideStyle: true
                    }
                },
                {
                    label: 'View',
                    actionName: 'view-bridge'
                }
            ]
        });
    }
    return banners;
};
exports.getBridgeBanners = getBridgeBanners;
const getDappActionRequestsBanners = (actions) => {
    const requests = actions.filter((a) => !['accountOp', 'benzin', 'swapAndBridge'].includes(a.type));
    if (!requests.length)
        return [];
    return [
        {
            id: 'dapp-requests-banner',
            type: 'info',
            title: `You have ${requests.length} pending app request${requests.length > 1 ? 's' : ''}`,
            text: '',
            actions: [
                {
                    label: 'Open',
                    actionName: 'open-pending-dapp-requests'
                }
            ]
        }
    ];
};
exports.getDappActionRequestsBanners = getDappActionRequestsBanners;
const getAccountOpBannerText = (activeSwapAndBridgeRoutesForSelectedAccount, chainId, nonSwapAndBridgeTxns, networks) => {
    const swapsAndBridges = [];
    const networkSwapAndBridgeRoutes = activeSwapAndBridgeRoutesForSelectedAccount.filter((route) => {
        return route.route && BigInt(route.route.fromChainId) === chainId;
    });
    if (networkSwapAndBridgeRoutes.length) {
        networkSwapAndBridgeRoutes.forEach((route) => {
            const isBridgeTxn = !!route.route?.userTxs.some((t) => (0, swapAndBridge_1.getIsBridgeTxn)(t.userTxType));
            const desc = getBridgeBannerText(route, isBridgeTxn, networks);
            swapsAndBridges.push(desc);
        });
        return `${swapsAndBridges.join(', ')} ${nonSwapAndBridgeTxns
            ? `and ${nonSwapAndBridgeTxns} other transaction${nonSwapAndBridgeTxns > 1 ? 's' : ''}`
            : ''}`;
    }
    return '';
};
const getAccountOpBanners = ({ accountOpActionsByNetwork, selectedAccount, accounts, networks, swapAndBridgeRoutesPendingSignature }) => {
    if (!accountOpActionsByNetwork)
        return [];
    const txnBanners = [];
    const account = accounts.find((acc) => acc.addr === selectedAccount);
    if (account?.creation) {
        Object.entries(accountOpActionsByNetwork).forEach(([netId, actions]) => {
            actions.forEach((action) => {
                const network = networks.filter((n) => n.chainId.toString() === netId)[0];
                const nonSwapAndBridgeTxns = action.accountOp.calls.reduce((prev, call) => {
                    const isSwapAndBridge = swapAndBridgeRoutesPendingSignature.some((route) => route.activeRouteId === call.fromUserRequestId);
                    if (isSwapAndBridge)
                        return prev;
                    return prev + 1;
                }, 0);
                const text = getAccountOpBannerText(swapAndBridgeRoutesPendingSignature, BigInt(network.chainId), nonSwapAndBridgeTxns, networks);
                txnBanners.push({
                    id: `${selectedAccount}-${netId}`,
                    type: 'info',
                    category: 'pending-to-be-signed-acc-op',
                    title: `Transaction waiting to be signed ${network.name ? `on ${network.name}` : ''}`,
                    text,
                    actions: [
                        {
                            label: 'Reject',
                            actionName: 'reject-accountOp',
                            meta: {
                                err: 'User rejected the transaction request.',
                                actionId: action.id,
                                shouldOpenNextAction: false
                            }
                        },
                        {
                            label: 'Open',
                            actionName: 'open-accountOp',
                            meta: { actionId: action.id }
                        }
                    ]
                });
            });
        });
    }
    else {
        Object.entries(accountOpActionsByNetwork).forEach(([netId, actions]) => {
            const network = networks.filter((n) => n.chainId.toString() === netId)[0];
            const nonSwapAndBridgeTxns = actions.reduce((prev, action) => {
                action.accountOp.calls.forEach((call) => {
                    const isSwapAndBridge = swapAndBridgeRoutesPendingSignature.some((route) => route.activeRouteId === call.fromUserRequestId);
                    if (isSwapAndBridge)
                        return prev;
                    return prev + 1;
                });
                return prev;
            }, 0);
            const text = getAccountOpBannerText(swapAndBridgeRoutesPendingSignature, BigInt(network.chainId), nonSwapAndBridgeTxns, networks);
            txnBanners.push({
                id: `${selectedAccount}-${netId}`,
                type: 'info',
                title: `${actions.length} transaction${actions.length > 1 ? 's' : ''} waiting to be signed ${network.name ? `on ${network.name}` : ''}`,
                text,
                actions: [
                    actions.length <= 1
                        ? {
                            label: 'Reject',
                            actionName: 'reject-accountOp',
                            meta: {
                                err: 'User rejected the transaction request.',
                                actionId: actions[0].id
                            }
                        }
                        : undefined,
                    {
                        label: 'Open',
                        actionName: 'open-accountOp',
                        meta: {
                            actionId: actions[0].id
                        }
                    }
                ].filter(Boolean)
            });
        });
    }
    return txnBanners;
};
exports.getAccountOpBanners = getAccountOpBanners;
const getKeySyncBanner = (addr, email, keys) => {
    const banner = {
        id: `keys-sync:${addr}:${email}`,
        accountAddr: addr,
        type: 'info',
        title: 'Sync Key Store keys',
        text: 'This account has no signing keys added therefore it is in a view-only mode. Make a request for keys sync from another device.',
        actions: [
            {
                label: 'Sync',
                actionName: 'sync-keys',
                meta: { email, keys }
            }
        ]
    };
    return banner;
};
exports.getKeySyncBanner = getKeySyncBanner;
const getFirstCashbackBanners = ({ selectedAccountAddr, cashbackStatusByAccount }) => {
    const banners = [];
    const shouldShowBanner = cashbackStatusByAccount[selectedAccountAddr] === 'unseen-cashback';
    if (shouldShowBanner) {
        banners.push({
            id: `${selectedAccountAddr}-first-cashback-banner-banner`,
            type: 'info',
            title: "You've got cashback!",
            text: 'You just received your first cashback from paying gas with Smart Account.',
            actions: [
                {
                    label: 'Open',
                    actionName: 'open-first-cashback-modal'
                }
            ]
        });
    }
    return banners;
};
exports.getFirstCashbackBanners = getFirstCashbackBanners;
//# sourceMappingURL=banners.js.map