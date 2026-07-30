import { ControllerInterface } from './controller'

export type IRailgunController = ControllerInterface<
  InstanceType<typeof import('../controllers/railgun/railgun').RailgunController>
>

export type RailgunSyncStatus = 'idle' | 'unlock-required' | 'initializing' | 'syncing' | 'ready'

export type RailgunShieldedBalance = {
  tokenAddress: string
  amount: bigint
}
