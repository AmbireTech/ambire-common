import { ErrorRef, IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter';
export default class EventEmitter {
    #private;
    id: string;
    statuses: Statuses<string>;
    /**
     *
     * @param registry - EventEmitterRegistryController instance to be used by this controller. Controllers
     * added to the registry will have their updates and errors propagated to the front-end.
     * @param registerImmediately - Most of the time we want to register the controller in the registry
     * immediately upon construction. However, there are some dynamic controllers (like SignAccountOpController)
     * that should be registered only after a condition is met (e.g. when the request is open)
     */
    constructor(registry?: IEventEmitterRegistryController, registerImmediately?: boolean);
    get name(): string;
    get onUpdateIds(): string[];
    get onErrorIds(): string[];
    get emittedErrors(): ErrorRef[];
    /**
     * Emits an update immediately, bypassing both background batching
     * (where updates on the same tick are debounced and batched for performance)
     * and React batching (where rapid state updates are merged).
     *
     * This ensures the state change is applied instantly at the React application level.
     * It is especially useful when multiple status flags change in quick succession.
     *
     * For example, if a flow updates a status from INITIAL -> LOADING -> SUCCESS -> INITIAL,
     * normal batching may skip intermediate states and only emit the first and last ones.
     */
    forceEmitUpdate(): Promise<void>;
    protected emitUpdate(): void;
    /**
     * Propagates updates from a child controller to its parent in a parent -> child setup,
     * ensuring child state updates reach the application without being lost due to batching.
     *
     * Used when a parent controller (e.g. swapAndBridgeController) subscribes to child updates:
     *
     *   this.#signAccountOpController.onUpdate((forceEmit) => {
     *     this.propagateUpdate(forceEmit)
     *   })
     *
     * Child controllers may update their status very quickly
     * (e.g. INITIAL -> LOADING -> SUCCESS -> INITIAL).
     * If the parent propagates these updates via `forceEmitUpdate()`,
     * the update is scheduled in a new tick and intermediate states may be lost.
     *
     * `propagateUpdate` forwards the update in the same tick while preserving the
     * `forceEmit` behavior, ensuring all states are correctly propagated.
     *
     * Notes:
     *  - If `forceEmit` is falsy, this behaves the same as calling `emitUpdate()`.
     *    For consistency and clarity, parent -> child setups should always use
     *    `propagateUpdate()` instead of mixing `emitUpdate()` and `propagateUpdate()`.
     *
     *  -  For all direct controller updates (i.e. when there is no child controller involved
     *     and the controller updates its own state), use `emitUpdate()` or `forceEmitUpdate()`.
     */
    protected propagateUpdate(forceEmit?: boolean): void;
    protected emitError(error: ErrorRef): void;
    protected withStatus(callName: string, fn: Function, allowConcurrentActions?: boolean, errorLevel?: ErrorRef['level']): Promise<void>;
    onUpdate(cb: (forceUpdate?: boolean) => void, id?: string): () => void;
    onError(cb: (error: ErrorRef) => void, id?: string): () => void;
    /**
     * Destroys the controller, unregistering it from the EventEmitterRegistry and
     * clearing all callbacks and errors.
     */
    destroy(): void;
    /**
     * Registers the controller into the EventEmitterRegistry (if set)
     * to propagate its updates and errors to the front-end.
     */
    registerInRegistry(): void;
    /**
     * Unregisters the controller from the EventEmitterRegistry (if set).
     * Used when controllers are destroyed or by dynamic controllers.
     */
    unregisterFromRegistry(): void;
    isInRegistry(): boolean;
    toJSON(): this & {
        name: string;
        emittedErrors: ErrorRef[];
    };
}
//# sourceMappingURL=eventEmitter.d.ts.map