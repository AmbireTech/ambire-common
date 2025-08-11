import { ControllerInterface } from './controller'

export type IActivityController = ControllerInterface<
  InstanceType<typeof import('../controllers/activity/activity').ActivityController>
>
