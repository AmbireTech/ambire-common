import { getIsBridgeTxn, getQuoteRouteSteps } from '../swapAndBridge/swapAndBridge';
const getBridgeBannerTitle = (routeStatus) => {
    switch (routeStatus) {
        case 'completed':
            return 'Bridge request completed';
        case 'in-progress':
            return 'Bridge request in progress';
        default:
            return 'Bridge request awaiting signature';
    }
};
const getBridgeActionText = (routeStatus, isBridgeTxn) => {
    if (isBridgeTxn) {
        return routeStatus === 'completed' ? 'Bridged' : 'Bridge';
    }
    return routeStatus === 'completed' ? 'Swapped' : 'Swap';
};
const getBridgeBannerText = (route, isBridgeTxn, networks) => {
    const steps = getQuoteRouteSteps(route.route.userTxs);
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
    const stepsIndexText = `(step ${route.routeStatus === 'completed' ? route.route.totalUserTx : route.route.currentUserTxIndex + 1} of ${route.route.totalUserTx})`;
    return `${actionText} ${assetsText}${route.route.totalUserTx > 1 ? ` ${stepsIndexText}` : ''}`;
};
export const getBridgeBanners = (activeRoutes, accountOpActions, networks) => {
    const isBridgeTxn = (route) => route.route.userTxs.some((t) => getIsBridgeTxn(t.userTxType));
    const isRouteTurnedIntoAccountOp = (route) => {
        return accountOpActions.some((action) => {
            return action.accountOp.calls.some((call) => call.fromUserRequestId === route.activeRouteId ||
                call.fromUserRequestId === `${route.activeRouteId}-revoke-approval` ||
                call.fromUserRequestId === `${route.activeRouteId}-approval`);
        });
    };
    return activeRoutes
        .filter(isBridgeTxn)
        .filter((route) => {
        if (route.routeStatus === 'failed')
            return false;
        if (route.routeStatus !== 'ready')
            return true;
        // If the route is ready to be signed, we should display the banner only if it's not turned into an account op
        // because when it does get turned into an account op, there will be a different banner for that
        return !isRouteTurnedIntoAccountOp(route);
    })
        .map((r) => {
        const actions = [];
        if (r.routeStatus === 'in-progress' || r.routeStatus === 'waiting-approval-to-resolve') {
            actions.push({
                label: 'Details',
                actionName: 'open-swap-and-bridge-tab'
            });
        }
        if (r.routeStatus === 'completed') {
            actions.push({
                label: 'Close',
                actionName: 'close-bridge',
                meta: { activeRouteId: r.activeRouteId }
            });
        }
        if (r.routeStatus === 'ready') {
            const isNextTnxForBridging = r.route.currentUserTxIndex >= 1;
            actions.push({
                label: 'Reject',
                actionName: 'reject-bridge',
                meta: { activeRouteId: r.activeRouteId }
            }, {
                label: isNextTnxForBridging ? 'Proceed to Next Step' : 'Open',
                actionName: 'proceed-bridge',
                meta: { activeRouteId: r.activeRouteId }
            });
        }
        return {
            id: `bridge-${r.activeRouteId}`,
            type: r.routeStatus === 'completed' ? 'success' : 'info',
            category: `bridge-${r.routeStatus}`,
            title: getBridgeBannerTitle(r.routeStatus),
            text: getBridgeBannerText(r, true, networks),
            actions
        };
    });
};
export const getDappActionRequestsBanners = (actions) => {
    const requests = actions.filter((a) => !['accountOp', 'benzin'].includes(a.type));
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
const getAccountOpBannerText = (activeSwapAndBridgeRoutesForSelectedAccount, chainId, nonSwapAndBridgeTxns, networks) => {
    const swapsAndBridges = [];
    const networkSwapAndBridgeRoutes = activeSwapAndBridgeRoutesForSelectedAccount.filter((route) => {
        return BigInt(route.route.fromChainId) === chainId;
    });
    if (networkSwapAndBridgeRoutes.length) {
        networkSwapAndBridgeRoutes.forEach((route) => {
            const isBridgeTxn = route.route.userTxs.some((t) => getIsBridgeTxn(t.userTxType));
            const desc = getBridgeBannerText(route, isBridgeTxn, networks);
            swapsAndBridges.push(desc);
        });
        return `${swapsAndBridges.join(', ')} ${nonSwapAndBridgeTxns
            ? `and ${nonSwapAndBridgeTxns} other transaction${nonSwapAndBridgeTxns > 1 ? 's' : ''}`
            : ''}`;
    }
    return '';
};
export const getAccountOpBanners = ({ accountOpActionsByNetwork, selectedAccount, accounts, networks, swapAndBridgeRoutesPendingSignature }) => {
    if (!accountOpActionsByNetwork)
        return [];
    const txnBanners = [];
    const account = accounts.find((acc) => acc.addr === selectedAccount);
    if (account?.creation) {
        Object.entries(accountOpActionsByNetwork).forEach(([netId, actions]) => {
            actions.forEach((action) => {
                const network = networks.filter((n) => n.id === netId)[0];
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
            const network = networks.filter((n) => n.id === netId)[0];
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
export const getKeySyncBanner = (addr, email, keys) => {
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
//# sourceMappingURL=banners.js.map