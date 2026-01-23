import { ControllerInterface } from './controller'

export type ISafeController = ControllerInterface<
  InstanceType<typeof import('../controllers/safe/safe').SafeController>
>
