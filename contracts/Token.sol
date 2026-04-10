//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract Token is ERC20 {
    //storage
    address public owner;
    address public marketing;
    address public dogPark;
    address public dev;
    address public charity;

    //percentage distribution
    uint256 public MARKET_PERC = 20;
    uint256 public DOGP_PERC = 10;
    uint256 public DEV_PERC = 5;
    uint256 public CHARITY_PERC = 5;
    uint256 public PUBLIC_PERC = 5;

    uint256 constant TOTAL_SUPPLY = 500000000 * 10 ** 18;
    uint256 public tokenPrice;


    //events
    event TokensPurchased(address indexed buyer, uint256 amount, uint256 cost);
    event TaxDeducted(address indexed from, uint256 reflection, uint256 liquidity, uint256 marketing);
    event TokenPriceUpdated(uint256 oldPrice, uint256 newPrice);




    constructor (
        address _marketing,
        address _dogPark,
        address _dev,
        address _charity,
        uint256 _tokenPrice
     ) ERC20 ("Bark-A-Lot", "$BARK"){
        require(_marketing != address(0));
        require(_dogPark != address(0));
        require(_dev != address(0));
        require(_charity != address(0));
        require(_tokenPrice > 0);
        
        owner = msg.sender;
        marketing = _marketing;
        dogPark = _dogPark;
        dev = _dev;
        charity = _charity;
        tokenPrice = _tokenPrice;

        _mint(marketing, TOTAL_SUPPLY * MARKET_PERC / 100);  
        _mint(dogPark,   TOTAL_SUPPLY * DOGP_PERC / 100);    
        _mint(dev,       TOTAL_SUPPLY * DEV_PERC / 100);     
        _mint(charity,   TOTAL_SUPPLY * CHARITY_PERC / 100); 
        _mint(address(this),     TOTAL_SUPPLY * PUBLIC_PERC / 100);           


        
    }

    modifier onlyOnwer(){
        require(msg.sender == owner, "Cannot call function");
        _;
    }

    function buyToken(uint256 _amount) external payable {
    uint256 cost = _amount * tokenPrice;
    require(msg.value >= cost, "Not enough ETH sent");
    require(balanceOf(address(this)) >= _amount * 10 ** decimals(), "Not enough tokens");
    _transfer(address(this), msg.sender, _amount * 10 ** decimals());
    
    // refund excess ETH if they overpaid
    if (msg.value > cost) {
        payable(msg.sender).transfer(msg.value - cost);
    }

    emit TokensPurchased(msg.sender, _amount, cost);
    }

    function deductTax(address sender, uint256 amount) internal returns (uint256) {
    uint256 reflection  = amount * 1 / 100;
    uint256 liquidity   = amount * 1 / 100;
    uint256 marketingTax = amount * 1 / 100;
    uint256 totalTax    = reflection + liquidity + marketingTax;

    _transfer(sender, address(this), liquidity);      
    _transfer(sender, marketing, marketingTax);  
          

    _burn(sender, reflection);   

    emit  TaxDeducted(sender, reflection, liquidity, marketingTax);                     

    return amount - totalTax;                          
    }

    function _beforeTokenTransfer(address from, address to, uint256 amount) internal override {
    if (from == address(0) || to == address(0)) {
        super._beforeTokenTransfer(from, to, amount);
        return;
    }
    uint256 amountAfterTax = deductTax(from, amount);
    super._beforeTokenTransfer(from, to, amountAfterTax);
    }

    function setTokenPrice(uint256 newTokenPrice) internal {
        tokenPrice = newTokenPrice;
        emit TokenPriceUpdated(tokenPrice, newTokenPrice);
    }







}