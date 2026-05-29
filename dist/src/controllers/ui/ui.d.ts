import { EventEmitter as UiEventEmitter } from 'events';
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { IUiController, UiManager, View } from '../../interfaces/ui';
import EventEmitter from '../eventEmitter/eventEmitter';
export declare class UiController extends EventEmitter implements IUiController {
    uiEvent: UiEventEmitter;
    views: View[];
    window: UiManager['window'];
    notification: UiManager['notification'];
    message: UiManager['message'];
    constructor({ eventEmitterRegistry, uiManager }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        uiManager: UiManager;
    });
    addView(view: View): void;
    updateView(viewId: string, updatedProps: Pick<View, 'currentRoute' | 'isReady' | 'searchParams'>): void;
    removeView(viewId: string): void;
    navigateView(viewId: string, route: string, params: {
        [key: string]: any;
    }): void;
    toJSON(): this & {
        uiEvent: any;
        window: any;
        notification: any;
        message: any;
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=ui.d.ts.map