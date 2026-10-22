import { EventEmitter as UiEventEmitter } from 'events';
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { FocusWindowParams, IUiController, NavigateOptions, OpenWindowOptions, UiManager, View, WindowId, WindowProps } from '../../interfaces/ui';
import EventEmitter from '../eventEmitter/eventEmitter';
/**
 * The surface that shows a request: the panel when it is open (nothing to open, focus or close
 * there), a dedicated request window otherwise. Consumers only open, focus and close.
 */
type RequestViewManager = {
    open: (options?: OpenWindowOptions) => Promise<WindowProps>;
    focus: (windowProps: WindowProps, params?: FocusWindowParams) => Promise<WindowProps>;
    close: (winId: WindowId) => Promise<void>;
};
export declare class UiController extends EventEmitter implements IUiController {
    #private;
    uiEvent: UiEventEmitter;
    views: View[];
    window: UiManager['window'];
    panel: UiManager['panel'];
    notification: UiManager['notification'];
    message: UiManager['message'];
    dispatchDappTabFocus?: UiManager['dispatchDappTabFocus'];
    requestView: RequestViewManager;
    constructor({ eventEmitterRegistry, uiManager }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        uiManager: UiManager;
    });
    addView(view: View): void;
    updateView(viewId: string, updatedProps: Pick<View, 'currentRoute' | 'isReady' | 'searchParams'>): void;
    emitViewFocus(viewId: string): void;
    removeView(viewId: string): void;
    /**
     * Navigates the application to a route in a view, if it is not already there.
     */
    navigateView(viewId: string, route: string, options?: NavigateOptions): void;
    /**
     * Sends a view to the route its state calls for, if it has not been navigated already.
     * Examples:
     * - Sending to keystore unlock if locked
     * - Moving between request windows when switching requests
     */
    syncViewRoute(viewId: string, options?: Pick<NavigateOptions, 'isInitialNavigation'>): Promise<void>;
    /** Syncs the route of every view, or of every view of one type. */
    syncViewRoutes(filterByType?: View['type']): Promise<void>;
    toJSON(): this & {
        uiEvent: any;
        window: any;
        panel: any;
        notification: any;
        message: any;
        dispatchDappTabFocus: any;
        requestView: any;
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
export {};
//# sourceMappingURL=ui.d.ts.map