import { ControllerInterface } from './controller'

export type ITokenPricesController = ControllerInterface<
  InstanceType<typeof import('../controllers/tokenPrices/tokenPrices').TokenPricesController>
>
