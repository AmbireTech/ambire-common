/**
 * Example usage to create an interface:
 *
 * export type IMyController = ControllerInterface<import('../controllers/my/my').MyController>
 */

type PublicKeys<T> = {
  [K in keyof T]: K extends `#${string}` ? never : K
}[keyof T]

export type ControllerInterface<T> = Pick<T, PublicKeys<T>> &
  InstanceType<typeof import('../controllers/eventEmitter/eventEmitter').default>
