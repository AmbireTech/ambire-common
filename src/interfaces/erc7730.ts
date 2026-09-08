import { ControllerInterface } from './controller'

export type IErc7730Controller = ControllerInterface<
  InstanceType<typeof import('../controllers/erc7730/erc7730').Erc7730Controller>
>
