// @TODO: DO NOT DEPLOY, NOT PROD READY, WE NEED A WHITELIST OF NEWPOOL OR HARDCODED NEWPOOL!!!!!         
import "./deployless/IERC20.sol";

interface IStakingPool {
        function balanceOf(address owner) external view returns (uint256);
        function shareValue() external view returns (uint256);
        function transfer(address to, uint256 amount) external returns (bool);
        function transferFrom(address from, address to, uint256 amount) external returns (bool);
        function enter(uint256 amount) external;
        function enterTo(address to, uint256 amount) external;
	function rageReceivedPromilles() external returns (uint256);
        function governance() external view returns (address);
	function setRageReceived(uint256) external;
	function rageLeave(uint256, bool) external;
	function WALLET() external returns (IERC20);
}

contract xWALLETMigratorGovt {
        function migrate(IStakingPool pool, uint shares, bool skipMint, IStakingPool newPool) external {
                pool.transferFrom(msg.sender, address(this), shares); 
                uint rageReceived = pool.rageReceivedPromilles();
                pool.setRageReceived(1000);
                pool.rageLeave(shares, skipMint);
                pool.setRageReceived(rageReceived);
                // if we happen to get extra tokens, user gets them
                IERC20 token = pool.WALLET();
                uint tokenAmount = token.balanceOf(address(this));
                token.approve(address(newPool), tokenAmount);
                newPool.enterTo(msg.sender, tokenAmount);
        }

        function call(IStakingPool pool, bytes calldata data) external {
                // @TODO hardcode
                require(msg.sender == 0xFDE6d7303868fD2046c15263C9268618092664d1, "governance");
                (bool success, bytes memory returnData) = address(pool).call{ value: 0 }(data);
                // @TODO forward error, returnData
        }       
}  
