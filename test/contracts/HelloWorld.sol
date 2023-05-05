contract HelloWorld {
	function helloWorld() external pure returns (string memory) {
		return "hello world";
	}

    function throwAssertErorr() external view returns (uint) {
        assert(1 > 1);
        return 1;
    }
}