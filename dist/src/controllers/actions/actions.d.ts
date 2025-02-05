import { Account } from '../../interfaces/account';
import { AccountOpAction, Action, BenzinAction, DappRequestAction, SignMessageAction, SwitchAccountAction } from '../../interfaces/actions';
import { NotificationManager } from '../../interfaces/notification';
import { WindowManager, WindowProps } from '../../interfaces/window';
import EventEmitter from '../eventEmitter/eventEmitter';
import { SelectedAccountController } from '../selectedAccount/selectedAccount';
export type { SwitchAccountAction, Action, AccountOpAction, SignMessageAction, BenzinAction, DappRequestAction };
export type ActionPosition = 'first' | 'last';
export type ActionExecutionType = 'queue' | 'queue-but-open-action-window' | 'open-action-window';
/**
 * The ActionsController is responsible for storing the converted userRequests
 * from the MainController into actions. After adding an action an action-window will be opened with the first action form actionsQueue
 * For most userRequests, there is a corresponding action in the actionsQueue
 * containing the details of the userRequest needed for displaying it to the user.
 * However, some userRequests can be batched together, resulting in a single action created for multiple requests.
 *
 * After being opened, the action-window will remain visible to the user until all actions are resolved or rejected,
 * or until the user forcefully closes the window using the system close icon (X).
 * All pending/unresolved actions can be accessed later from the banners on the Dashboard screen.
 */
export declare class ActionsController extends EventEmitter {
    #private;
    actionWindow: {
        windowProps: WindowProps;
        openWindowPromise?: Promise<WindowProps>;
        focusWindowPromise?: Promise<void>;
        loaded: boolean;
        pendingMessage: {
            message: string;
            options?: {
                timeout?: number;
                type?: 'error' | 'success' | 'info' | 'warning';
                sticky?: boolean;
            };
        } | null;
    };
    actionsQueue: Action[];
    currentAction: Action | null;
    get visibleActionsQueue(): Action[];
    constructor({ selectedAccount, windowManager, notificationManager, onActionWindowClose }: {
        selectedAccount: SelectedAccountController;
        windowManager: WindowManager;
        notificationManager: NotificationManager;
        onActionWindowClose: () => void;
    });
    addOrUpdateAction(newAction: Action, position?: ActionPosition, executionType?: ActionExecutionType): void;
    removeAction(actionId: Action['id'], shouldOpenNextAction?: boolean): void;
    setCurrentActionById(actionId: Action['id']): void;
    setCurrentActionByIndex(actionIndex: number): void;
    sendNewActionMessage(newAction: Action, type: 'queued' | 'updated'): void;
    openActionWindow(): Promise<void>;
    focusActionWindow(): Promise<void>;
    closeActionWindow(): void;
    setWindowLoaded(): void;
    removeAccountData(address: Account['addr']): void;
    get banners(): import("../../interfaces/banner").Banner[];
    toJSON(): this & {
        visibleActionsQueue: Action[];
        banners: import("../../interfaces/banner").Banner[];
        emittedErrors: import("../eventEmitter/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=actions.d.ts.map