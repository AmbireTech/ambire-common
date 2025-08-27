import { ControllerInterface } from './controller'

export type IDefiPositionsController = ControllerInterface<
  InstanceType<typeof import('../controllers/defiPositions/defiPositions').DefiPositionsController>
>
