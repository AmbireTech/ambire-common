// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.11;

contract Test {

    function burnGas() public view returns (uint) {
        uint start = gasleft();
        uint r = 0;
        for(uint i=0;i<100;i++){
            r=r+1;
        }
       return start - gasleft();
    }

	function simulate() public view returns (uint,uint) {
        uint start = gasleft();
        this.burnGas{gas: 100000}();
        uint consumed = this.burnGas{gas: 100000}();
        uint end = gasleft();
        return (start-end,consumed);
        // uint res = 0;
        // this.burnGas{gas:100}(1);
        // try this.burnGas(){
        //     return this.burnGas();
        // }catch{
        //     return 2;
        // }
        // return 1;
        // while (1==1) {
            // try this.burnGas{gas:gasToBurn}(res){
                // res = res + 2;
            // }catch {
                // return res;
    }
        // }
        // res = res -1;
        // return res;
    // }
}
