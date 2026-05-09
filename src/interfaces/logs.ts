import { ControllerInterface } from './controller'

export type ILogsController = ControllerInterface<
  InstanceType<typeof import('../controllers/logs/logs').LogsController>
>
