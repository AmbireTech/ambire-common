import { ControllerInterface } from './controller'

export type IUiController = ControllerInterface<
  InstanceType<typeof import('../controllers/ui//ui').UiController>
>

export type View = { id: string; type: 'window' | 'tab' | 'popup'; currentRoute?: string }
