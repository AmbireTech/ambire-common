import { ControllerInterface } from './controller'

export type IDebugController = ControllerInterface<
  InstanceType<typeof import('../controllers/debug/debug').DebugController>
>
