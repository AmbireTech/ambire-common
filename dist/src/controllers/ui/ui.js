"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UiController = void 0;
const tslib_1 = require("tslib");
const events_1 = require("events");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
class UiController extends eventEmitter_1.default {
    uiEvent;
    views = [];
    window;
    notification;
    message;
    constructor({ eventEmitterRegistry, uiManager }) {
        super(eventEmitterRegistry);
        this.uiEvent = new events_1.EventEmitter();
        this.window = uiManager.window;
        this.notification = uiManager.notification;
        this.message = uiManager.message;
    }
    addView(view) {
        const existingPopup = this.views.find((v) => v.type === 'popup');
        // if a popup already exists, just update its id and stop here
        if (view.type === 'popup' && existingPopup) {
            existingPopup.id = view.id;
            this.emitUpdate();
            return;
        }
        // if the same view already exists, skip adding
        if (this.views.some((v) => v.id === view.id))
            return;
        this.views.push(view);
        this.uiEvent.emit('addView', view);
        this.emitUpdate();
    }
    updateView(viewId, updatedProps) {
        const view = this.views.find((v) => v.id === viewId);
        if (!view)
            return;
        // @ts-ignore
        const shouldUpdate = Object.entries(updatedProps).some(([key, value]) => view[key] !== value);
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
    removeView(viewId) {
        const view = this.views.find((v) => v.id === viewId);
        if (!view)
            return;
        this.views = this.views.filter((v) => v.id !== viewId);
        this.uiEvent.emit('removeView', view);
        this.emitUpdate();
    }
    navigateView(viewId, route, params) {
        const view = this.views.find((v) => v.id === viewId);
        if (!view || view.currentRoute === route)
            return;
        view.currentRoute = route;
        this.message.sendNavigateMessage(viewId, route, params);
        this.emitUpdate();
    }
    toJSON() {
        return {
            ...this,
            ...super.toJSON(),
            uiEvent: undefined,
            window: undefined,
            notification: undefined,
            message: undefined
        };
    }
}
exports.UiController = UiController;
//# sourceMappingURL=ui.js.map