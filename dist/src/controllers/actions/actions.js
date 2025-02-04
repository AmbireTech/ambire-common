/* eslint-disable @typescript-eslint/no-floating-promises */
// eslint-disable-next-line import/no-cycle
import { messageOnNewAction } from '../../libs/actions/actions';
import { getDappActionRequestsBanners } from '../../libs/banners/banners';
import { ENTRY_POINT_AUTHORIZATION_REQUEST_ID } from '../../libs/userOperation/userOperation';
import EventEmitter from '../eventEmitter/eventEmitter';
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
export class ActionsController extends EventEmitter {
    #selectedAccount;
    #windowManager;
    #notificationManager;
    actionWindow = {
        windowProps: null,
        loaded: false,
        pendingMessage: null
    };
    actionsQueue = [];
    currentAction = null;
    #onActionWindowClose;
    get visibleActionsQueue() {
        return this.actionsQueue.filter((a) => {
            if (a.type === 'accountOp') {
                return a.accountOp.accountAddr === this.#selectedAccount.account?.addr;
            }
            if (a.type === 'signMessage') {
                return a.userRequest.meta.accountAddr === this.#selectedAccount.account?.addr;
            }
            if (a.type === 'benzin') {
                return a.userRequest.meta.accountAddr === this.#selectedAccount.account?.addr;
            }
            if (a.type === 'switchAccount') {
                return a.userRequest.meta.switchToAccountAddr !== this.#selectedAccount.account?.addr;
            }
            return true;
        });
    }
    constructor({ selectedAccount, windowManager, notificationManager, onActionWindowClose }) {
        super();
        this.#selectedAccount = selectedAccount;
        this.#windowManager = windowManager;
        this.#notificationManager = notificationManager;
        this.#onActionWindowClose = onActionWindowClose;
        this.#windowManager.event.on('windowRemoved', async (winId) => {
            if (winId === this.actionWindow.windowProps?.id ||
                (!this.visibleActionsQueue.length && this.currentAction && this.actionWindow.windowProps)) {
                this.actionWindow.windowProps = null;
                this.actionWindow.loaded = false;
                this.actionWindow.pendingMessage = null;
                this.currentAction = null;
                this.actionsQueue = this.actionsQueue.filter((a) => a.type === 'accountOp');
                if (this.visibleActionsQueue.length) {
                    await this.#notificationManager.create({
                        title: this.actionsQueue.length > 1
                            ? `${this.actionsQueue.length} transactions queued`
                            : 'Transaction queued',
                        message: 'Queued pending transactions are available on your Dashboard.'
                    });
                }
                this.#onActionWindowClose();
                this.emitUpdate();
            }
        });
        this.#windowManager.event.on('windowFocusChange', async (winId) => {
            if (this.actionWindow.windowProps) {
                if (this.actionWindow.windowProps.id === winId && !this.actionWindow.windowProps.focused) {
                    this.actionWindow.windowProps.focused = true;
                    this.emitUpdate();
                }
                else if (this.actionWindow.windowProps.id !== winId &&
                    this.actionWindow.windowProps.focused) {
                    this.actionWindow.windowProps.focused = false;
                    this.emitUpdate();
                }
            }
        });
    }
    addOrUpdateAction(newAction, position = 'last', executionType = 'open-action-window') {
        // remove the benzin action if a new actions is added
        this.actionsQueue = this.actionsQueue.filter((a) => a.type !== 'benzin');
        if (this.currentAction && this.currentAction.type === 'benzin') {
            this.currentAction = null;
        }
        const actionIndex = this.actionsQueue.findIndex((a) => a.id === newAction.id);
        if (actionIndex !== -1) {
            this.actionsQueue[actionIndex] = newAction;
            if (executionType !== 'queue') {
                let currentAction = null;
                if (executionType === 'open-action-window') {
                    this.sendNewActionMessage(newAction, 'updated');
                    currentAction = this.visibleActionsQueue.find((a) => a.id === newAction.id) || null;
                }
                else if (executionType === 'queue-but-open-action-window') {
                    this.sendNewActionMessage(newAction, 'queued');
                    currentAction = this.currentAction || this.visibleActionsQueue[0] || null;
                }
                this.#setCurrentAction(currentAction);
            }
            else {
                this.emitUpdate();
            }
            return;
        }
        if (position === 'first') {
            this.actionsQueue.unshift(newAction);
        }
        else {
            this.actionsQueue.push(newAction);
        }
        if (executionType !== 'queue') {
            let currentAction = null;
            if (executionType === 'open-action-window') {
                currentAction = this.visibleActionsQueue.find((a) => a.id === newAction.id) || null;
            }
            else if (executionType === 'queue-but-open-action-window') {
                this.sendNewActionMessage(newAction, 'queued');
                currentAction = this.currentAction || this.visibleActionsQueue[0] || null;
            }
            this.#setCurrentAction(currentAction);
        }
        else {
            this.emitUpdate();
        }
    }
    removeAction(actionId, shouldOpenNextAction = true) {
        this.actionsQueue = this.actionsQueue.filter((a) => a.id !== actionId);
        if (shouldOpenNextAction) {
            this.#setCurrentAction(this.visibleActionsQueue[0] || null);
        }
    }
    #setCurrentAction(nextAction) {
        if (nextAction && nextAction.id === this.currentAction?.id) {
            this.openActionWindow();
            this.emitUpdate();
            return;
        }
        this.currentAction = nextAction;
        if (!this.currentAction) {
            !!this.actionWindow.windowProps?.id &&
                this.#windowManager.remove(this.actionWindow.windowProps.id);
        }
        else {
            this.openActionWindow();
        }
        this.emitUpdate();
    }
    setCurrentActionById(actionId) {
        const action = this.visibleActionsQueue.find((a) => a.id.toString() === actionId.toString());
        if (!action) {
            const entryPointAction = this.visibleActionsQueue.find((a) => a.id.toString() === ENTRY_POINT_AUTHORIZATION_REQUEST_ID);
            if (entryPointAction)
                this.#setCurrentAction(entryPointAction);
            return;
        }
        this.#setCurrentAction(action);
    }
    setCurrentActionByIndex(actionIndex) {
        const action = this.visibleActionsQueue[actionIndex];
        if (!action) {
            const entryPointAction = this.visibleActionsQueue.find((a) => a.id.toString() === ENTRY_POINT_AUTHORIZATION_REQUEST_ID);
            if (entryPointAction)
                this.#setCurrentAction(entryPointAction);
            return;
        }
        this.#setCurrentAction(action);
    }
    sendNewActionMessage(newAction, type) {
        if (this.visibleActionsQueue.length > 1 && newAction.type !== 'benzin') {
            if (this.actionWindow.loaded) {
                const message = messageOnNewAction(newAction, type);
                if (message)
                    this.#windowManager.sendWindowToastMessage(message, { type: 'success' });
            }
            else {
                const message = messageOnNewAction(newAction, type);
                if (message)
                    this.actionWindow.pendingMessage = { message, options: { type: 'success' } };
            }
        }
    }
    async openActionWindow() {
        await this.actionWindow.focusWindowPromise;
        await this.actionWindow.openWindowPromise;
        if (this.actionWindow.windowProps) {
            this.focusActionWindow();
        }
        else {
            try {
                this.actionWindow.openWindowPromise = this.#windowManager.open().finally(() => {
                    this.actionWindow.openWindowPromise = undefined;
                });
                this.actionWindow.windowProps = await this.actionWindow.openWindowPromise;
                this.emitUpdate();
            }
            catch (err) {
                console.error('Error opening action window:', err);
            }
        }
    }
    async focusActionWindow() {
        await this.actionWindow.focusWindowPromise;
        await this.actionWindow.openWindowPromise;
        if (!this.visibleActionsQueue.length || !this.currentAction || !this.actionWindow.windowProps)
            return;
        try {
            this.actionWindow.focusWindowPromise = this.#windowManager
                .focus(this.actionWindow.windowProps)
                .finally(() => {
                this.actionWindow.focusWindowPromise = undefined;
            });
            this.emitUpdate();
        }
        catch (err) {
            console.error('Error focusing action window:', err);
        }
    }
    closeActionWindow() {
        if (!this.actionWindow.windowProps)
            return;
        this.#windowManager.remove(this.actionWindow.windowProps.id);
    }
    setWindowLoaded() {
        if (!this.actionWindow.windowProps)
            return;
        this.actionWindow.loaded = true;
        if (this.actionWindow.pendingMessage) {
            this.#windowManager.sendWindowToastMessage(this.actionWindow.pendingMessage.message, this.actionWindow.pendingMessage.options);
            this.actionWindow.pendingMessage = null;
        }
        this.emitUpdate();
    }
    removeAccountData(address) {
        this.actionsQueue = this.actionsQueue.filter((a) => {
            if (a.type === 'accountOp') {
                return a.accountOp.accountAddr !== address;
            }
            if (a.type === 'signMessage') {
                return a.userRequest.meta.accountAddr !== address;
            }
            if (a.type === 'benzin') {
                return a.userRequest.meta.accountAddr !== address;
            }
            if (a.type === 'switchAccount') {
                return a.userRequest.meta.switchToAccountAddr !== address;
            }
            return true;
        });
        this.emitUpdate();
    }
    get banners() {
        return getDappActionRequestsBanners(this.visibleActionsQueue);
    }
    toJSON() {
        return {
            ...this,
            ...super.toJSON(),
            visibleActionsQueue: this.visibleActionsQueue,
            banners: this.banners
        };
    }
}
//# sourceMappingURL=actions.js.map