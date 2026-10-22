"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UiController = void 0;
const tslib_1 = require("tslib");
const events_1 = require("events");
const ui_1 = require("../../interfaces/ui");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
function areSearchParamsEqual(a, b) {
    if (a === b)
        return true;
    if (!a || !b)
        return !a && !b;
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length)
        return false;
    return aKeys.every((key) => a[key] === b[key]);
}
/** A route can carry search params (benzin), while a view reports its path alone. */
const getRoutePath = (route) => route.split('?')[0] ?? route;
class UiController extends eventEmitter_1.default {
    uiEvent;
    views = [];
    window;
    panel;
    notification;
    message;
    #resolveViewRoute;
    /**
     * Prevents race conditions with routing
     */
    #latestViewRouteSyncTokens = new Map();
    #viewRouteSyncTokenCounter = 0;
    dispatchDappTabFocus;
    requestView;
    constructor({ eventEmitterRegistry, uiManager }) {
        super(eventEmitterRegistry);
        this.uiEvent = new events_1.EventEmitter();
        this.window = uiManager.window;
        this.panel = uiManager.panel;
        this.notification = uiManager.notification;
        this.message = uiManager.message;
        this.#resolveViewRoute = uiManager.resolveViewRoute;
        this.dispatchDappTabFocus = uiManager.dispatchDappTabFocus;
        this.requestView = {
            open: async (options) => {
                // The base window is the app's window, so only a panel in that window can show the request
                if (this.panel?.isOpen(options?.baseWindowId))
                    return null;
                // The popup can't stay open next to a request window
                await this.window.remove('popup');
                return this.window.open(options);
            },
            focus: async (windowProps, params) => {
                await this.window.remove('popup');
                return this.window.focus(windowProps, params);
            },
            close: (winId) => this.window.remove(winId)
        };
    }
    addView(view) {
        // The popup and the side panel can be open at the same time, so each keeps its own view
        const existingOverlay = this.views.find((v) => (0, ui_1.isExtensionOverlayView)(v) && v.type === view.type);
        // if an overlay view of the same type already exists, just update its id and stop here
        if ((0, ui_1.isExtensionOverlayView)(view) && existingOverlay) {
            existingOverlay.id = view.id;
            delete existingOverlay.currentRoute;
            delete existingOverlay.pendingRoute;
            delete existingOverlay.searchParams;
            if (!existingOverlay.isReady)
                this.uiEvent.emit('addView', view);
            this.emitUpdate();
        }
        else {
            if (this.views.find((v) => v.id === view.id))
                return;
            this.views.push(view);
            this.uiEvent.emit('addView', view);
            this.emitUpdate();
        }
        // This navigates the new view to its initial route
        this.syncViewRoute(view.id, { isInitialNavigation: true });
    }
    updateView(viewId, updatedProps) {
        const view = this.views.find((v) => v.id === viewId);
        if (!view)
            return;
        if ('currentRoute' in updatedProps) {
            delete view.pendingRoute;
        }
        const shouldUpdate = Object.entries(updatedProps).some(([key, value]) => {
            // searchParams is a plain object rebuilt by the caller on every dispatch,
            // so a reference check always reports a change. Compare it by value.
            if (key === 'searchParams') {
                return !areSearchParamsEqual(view.searchParams, value);
            }
            return view[key] !== value;
        });
        if (!shouldUpdate)
            return;
        let previousRoute = view.previousRoute;
        if (updatedProps.currentRoute && updatedProps.currentRoute !== view.currentRoute) {
            previousRoute = view.currentRoute;
        }
        Object.assign(view, updatedProps);
        if (previousRoute) {
            view.previousRoute = previousRoute;
        }
        this.uiEvent.emit('updateView', view);
        this.emitUpdate();
    }
    emitViewFocus(viewId) {
        const view = this.views.find((v) => v.id === viewId);
        if (!view)
            return;
        this.uiEvent.emit('viewFocus', view);
    }
    removeView(viewId) {
        const view = this.views.find((v) => v.id === viewId);
        if (!view)
            return;
        this.views = this.views.filter((v) => v.id !== viewId);
        this.#latestViewRouteSyncTokens.delete(viewId);
        this.uiEvent.emit('removeView', view);
        this.emitUpdate();
    }
    /**
     * Navigates the application to a route in a view, if it is not already there.
     */
    navigateView(viewId, route, options) {
        const view = this.views.find((v) => v.id === viewId);
        if (!view)
            return;
        const routePath = getRoutePath(route);
        if (view.currentRoute === routePath || view.pendingRoute === routePath)
            return;
        view.pendingRoute = routePath;
        this.message.sendNavigateMessage(viewId, route, options);
        this.emitUpdate();
    }
    /**
     * Sends a view to the route its state calls for, if it has not been navigated already.
     * Examples:
     * - Sending to keystore unlock if locked
     * - Moving between request windows when switching requests
     */
    async syncViewRoute(viewId, options) {
        try {
            const view = this.views.find((v) => v.id === viewId);
            if (!view)
                return;
            this.#viewRouteSyncTokenCounter += 1;
            const syncToken = this.#viewRouteSyncTokenCounter;
            this.#latestViewRouteSyncTokens.set(viewId, syncToken);
            const route = await this.#resolveViewRoute(view);
            // A newer sync of the same view started while we were resolving, so its answer wins.
            if (this.#latestViewRouteSyncTokens.get(viewId) !== syncToken)
                return;
            if (!route)
                return;
            this.navigateView(viewId, route, {
                replace: true,
                isInitialNavigation: options?.isInitialNavigation
            });
        }
        catch (e) {
            this.emitError({
                level: 'silent',
                message: 'Error: ui.syncViewRoute() failed.',
                error: e
            });
        }
    }
    /** Syncs the route of every view, or of every view of one type. */
    async syncViewRoutes(filterByType) {
        const views = filterByType ? this.views.filter((v) => v.type === filterByType) : this.views;
        await Promise.all(views.map((v) => this.syncViewRoute(v.id)));
    }
    toJSON() {
        return {
            ...this,
            ...super.toJSON(),
            uiEvent: undefined,
            window: undefined,
            panel: undefined,
            notification: undefined,
            message: undefined,
            dispatchDappTabFocus: undefined,
            requestView: undefined
        };
    }
}
exports.UiController = UiController;
//# sourceMappingURL=ui.js.map