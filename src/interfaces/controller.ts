import { IEventEmitter } from './eventEmitter'

/**
 * Utility type for creating controller interfaces from class implementations.
 * This eliminates the need for manual interface synchronization.
 *
 * @template ControllerClass - The controller class implementation
 * @template PublicMembers - Union of public property/method names to expose
 */
export type ControllerInterface<
  ControllerClass,
  PublicMembers extends keyof ControllerClass
> = Pick<ControllerClass, PublicMembers> & IEventEmitter

/**
 * Example usage:
 *
 * export type IMyController = ControllerInterface<
 *   import('../controllers/my/my').MyController,
 *   'property1' | 'property2' | 'method1' | 'method2'
 * >
 */
