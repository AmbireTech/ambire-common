import { ControllerInterface } from './controller'

export type IAppDataSyncController = ControllerInterface<
  InstanceType<typeof import('../controllers/appDataSync/appDataSync').AppDataSyncController>
>
