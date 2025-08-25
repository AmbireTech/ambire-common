import { ControllerInterface } from './controller'

export type IPortfolioController = ControllerInterface<
  InstanceType<typeof import('../controllers/portfolio/portfolio').PortfolioController>
>
