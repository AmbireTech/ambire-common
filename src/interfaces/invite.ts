import { ControllerInterface } from './controller'

export type IInviteController = ControllerInterface<
  InstanceType<typeof import('../controllers/invite/invite').InviteController>
>
