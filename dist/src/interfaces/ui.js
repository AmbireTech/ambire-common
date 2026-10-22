"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSidePanelView = exports.isExtensionOverlayView = exports.REQUEST_VIEW_TYPE = void 0;
/** The view type of the window that exists solely to display the current user request. */
exports.REQUEST_VIEW_TYPE = 'request-window';
const isExtensionOverlayView = (view) => view.type === 'popup' || view.type === 'side-panel';
exports.isExtensionOverlayView = isExtensionOverlayView;
const isSidePanelView = (view) => view.type === 'side-panel';
exports.isSidePanelView = isSidePanelView;
//# sourceMappingURL=ui.js.map