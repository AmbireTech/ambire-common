import { ControllerInterface } from './controller'

export type IFeatureFlagsController = ControllerInterface<
  InstanceType<typeof import('../controllers/featureFlags/featureFlags').FeatureFlagsController>
>
