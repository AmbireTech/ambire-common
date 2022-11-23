import { HumanizerInfoType } from '../../hooks/useConstants'
import AaveLendingPoolV2 from './AaveLendingPoolV2'
import AaveWethGatewayV2 from './AaveWethGatewayV2'
import AmbireBatcher from './AmbireBatcher'
import AmbireFactory from './AmbireFactory'
import AmbireIdentity from './AmbireIdentity'
import ERC20 from './ERC20'
import ERC721 from './ERC721'
import Movr from './Movr'
import OneInch from './OneInch'
import OpenSea from './OpenSea'
import UniRouters from './UniRouters'
import WALLETStakingPool from './WALLETStakingPool'
import WALLETSupplyController from './WALLETSupplyController'
import WETH from './WETH'
import YearnTesseractVault from './YearnTesseractVault'

const all = (humanizerInfo: HumanizerInfoType) => ({
  ...UniRouters(humanizerInfo),
  ...AaveLendingPoolV2(humanizerInfo),
  ...AaveWethGatewayV2(humanizerInfo),
  ...ERC20(humanizerInfo),
  ...ERC721(humanizerInfo),
  ...WETH(humanizerInfo),
  ...AmbireIdentity(humanizerInfo),
  ...AmbireFactory(),
  ...YearnTesseractVault(humanizerInfo),
  ...Movr(humanizerInfo),
  ...OpenSea(humanizerInfo),
  ...WALLETSupplyController(),
  ...AmbireBatcher(humanizerInfo),
  ...WALLETStakingPool(humanizerInfo),
  ...OneInch(humanizerInfo)
})
export default all
