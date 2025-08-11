import { ControllerInterface } from './controller'

export type IPhishingController = ControllerInterface<
  InstanceType<typeof import('../controllers/phishing/phishing').PhishingController>
>
