// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";


contract Token is
    ERC20Upgradeable,
    OwnableUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    // --- Storage ---
    address public marketing;
    address public dogPark;
    address public dev;
    address public charity;

    uint256 public tokenPrice;

    uint256 public constant MAX_TX_AMOUNT    = 5_000_000  * 10 ** 18; // 1% of supply
    uint256 public constant MAX_WALLET_AMOUNT = 10_000_000 * 10 ** 18; // 2% of supply
    uint256 public constant TOTAL_SUPPLY     = 500_000_000 * 10 ** 18;

    mapping(address => bool) public isExcludedFromFee;
    mapping(address => bool) public blacklisted;

    bool private _inTaxTransfer;
    bool private _locked;

    // Reflection
    uint256 public rewardPerToken;
    mapping(address => uint256) public rewardDebt;
    mapping(address => bool) public isExcludedFromReflection;
    mapping(address => bool) private _settling;

    modifier nonReentrant() {
        require(!_locked, "Reentrant call");
        _locked = true;
        _;
        _locked = false;
    }

    // Reserve slots for future storage variables without colliding
    // with existing layout. Reduce this number by 1 for each new variable added.
    uint256[46] private __gap;

    //events
    event TokensPurchased(address indexed buyer, uint256 amount, uint256 cost);
    event TaxDeducted(address indexed from, uint256 reflection, uint256 liquidity, uint256 marketingTax);
    event TokenPriceUpdated(uint256 oldPrice, uint256 newPrice);
    event Blacklisted(address indexed account, bool status);

    // --- Reflection ---

    function balanceOf(address account) public view override returns (uint256) {
        uint256 base = super.balanceOf(account);
        if (isExcludedFromReflection[account]) return base;
        return base + (rewardPerToken - rewardDebt[account]) * base / 1e18;
    }

    function _settleReward(address account) internal {
        if (isExcludedFromReflection[account] || _settling[account]) return;
        _settling[account] = true;
        uint256 base = super.balanceOf(account);
        uint256 pending = (rewardPerToken - rewardDebt[account]) * base / 1e18;
        if (pending > 0) _mint(account, pending);
        rewardDebt[account] = rewardPerToken;
        _settling[account] = false;
    }

    function _distributeReflection(uint256 amount) internal {
        uint256 supply = totalSupply();
        if (supply > 0) rewardPerToken += amount * 1e18 / supply;
    }

    //initialize state
    function initialize(
        address _marketing,
        address _dogPark,
        address _dev,
        address _charity,
        uint256 _tokenPrice
    ) external initializer {
        require(_marketing != address(0));
        require(_dogPark   != address(0));
        require(_dev       != address(0));
        require(_charity   != address(0));
        require(_tokenPrice > 0);

        __ERC20_init("Bark-A-Lot", "$BARK");
        __Ownable_init(msg.sender);
        __Pausable_init();
        marketing = _marketing;
        dogPark   = _dogPark;
        dev       = _dev;
        charity   = _charity;
        tokenPrice = _tokenPrice;

        // Exclude system addresses from fees
        isExcludedFromFee[address(0)]  = true; // minting must not be taxed
        isExcludedFromFee[msg.sender]  = true;
        isExcludedFromFee[_marketing]  = true;
        isExcludedFromFee[_dogPark]    = true;
        isExcludedFromFee[_dev]        = true;
        isExcludedFromFee[_charity]    = true;
        isExcludedFromFee[address(this)] = true;

        // Exclude system addresses from reflection rewards
        isExcludedFromReflection[address(0)]    = true; // burn address earns nothing
        isExcludedFromReflection[msg.sender]    = true;
        isExcludedFromReflection[_marketing]    = true;
        isExcludedFromReflection[_dogPark]      = true;
        isExcludedFromReflection[_dev]          = true;
        isExcludedFromReflection[_charity]      = true;
        isExcludedFromReflection[address(this)] = true;

        // Mint per tokenomics (Requirements.md)
        _mint(_marketing,    TOTAL_SUPPLY * 20 / 100); // 20% marketing
        _mint(_dogPark,      TOTAL_SUPPLY * 10 / 100); // 10% dog park
        _mint(_dev,          TOTAL_SUPPLY *  5 / 100); // 5%  dev
        _mint(_charity,      TOTAL_SUPPLY *  5 / 100); // 5%  charity
        _mint(address(this), TOTAL_SUPPLY * 60 / 100); // 60% public launch
    }

    //allows upgrades
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // Onwner sets new token price
    function setTokenPrice(uint256 newPrice) external onlyOwner {
        emit TokenPriceUpdated(tokenPrice, newPrice);
        tokenPrice = newPrice;
    }

    function setBlacklist(address account, bool status) external onlyOwner {
        blacklisted[account] = status;
        emit Blacklisted(account, status);
    }

    function setExcludedFromFee(address account, bool excluded) external onlyOwner {
        isExcludedFromFee[account] = excluded;
    }

    function setExcludedFromReflection(address account, bool excluded) external onlyOwner {
        isExcludedFromReflection[account] = excluded;
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function withdrawETH() external onlyOwner nonReentrant {
        (bool ok, ) = owner().call{value: address(this).balance}("");
        require(ok, "ETH transfer failed");
    }

    //buy tokens
    function buyToken(uint256 _amount) external payable whenNotPaused nonReentrant {
        uint256 cost = _amount * tokenPrice;
        require(msg.value >= cost, "Not enough ETH sent");

        uint256 tokenAmount = _amount * 10 ** decimals();
        require(balanceOf(address(this)) >= tokenAmount, "Not enough tokens");
        require(tokenAmount <= MAX_TX_AMOUNT, "Exceeds max tx");
        require(balanceOf(msg.sender) + tokenAmount <= MAX_WALLET_AMOUNT, "Exceeds max wallet");

        _transfer(address(this), msg.sender, tokenAmount);

        if (msg.value > cost) {
            payable(msg.sender).transfer(msg.value - cost);
        }

        emit TokensPurchased(msg.sender, _amount, cost);
    }

    //helper for transaction tax
    function _applyTax(address from, address to, uint256 amount) internal returns (uint256) {
        if (_inTaxTransfer || isExcludedFromFee[from] || isExcludedFromFee[to]) {
            return amount;
        }

        uint256 reflection   = amount / 100; // 1%
        uint256 liquidity    = amount / 100; // 1%
        uint256 marketingTax = amount / 100; // 1%
        uint256 totalTax     = reflection + liquidity + marketingTax;

        _inTaxTransfer = true;
        super._update(from, address(0), reflection);
        _distributeReflection(reflection);
        super._update(from, address(this), liquidity);
        super._update(from, marketing, marketingTax);
        _inTaxTransfer = false;

        emit TaxDeducted(from, reflection, liquidity, marketingTax);
        return amount - totalTax;
    }

    //Override _transfer to have transaction tax
    function _update(address from, address to, uint256 amount) internal override whenNotPaused {
        _settleReward(from);
        _settleReward(to);

        require(!blacklisted[from] && !blacklisted[to], "Blacklisted");

        if (!_inTaxTransfer && !isExcludedFromFee[from] && !isExcludedFromFee[to]) {
            require(amount <= MAX_TX_AMOUNT, "Exceeds max tx");
            require(balanceOf(to) + amount <= MAX_WALLET_AMOUNT, "Exceeds max wallet");
        }

        uint256 amountAfterTax = _applyTax(from, to, amount);
        super._update(from, to, amountAfterTax);
    }

    receive() external payable {}
}

contract TokenV2 is
    ERC20Upgradeable,
    OwnableUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    // state variables
    address public marketing;
    address public dogPark;
    address public dev;
    address public charity;

    uint256 public tokenPrice;

    uint256 public constant MAX_TX_AMOUNT    = 5_000_000  * 10 ** 18; // 1% of supply
    uint256 public constant MAX_WALLET_AMOUNT = 10_000_000 * 10 ** 18; // 2% of supply
    uint256 public constant TOTAL_SUPPLY     = 500_000_000 * 10 ** 18;

    mapping(address => bool) public isExcludedFromFee;
    mapping(address => bool) public blacklisted;

    bool private _inTaxTransfer;
    bool private _locked;

    // Reflection
    uint256 public rewardPerToken;
    mapping(address => uint256) public rewardDebt;
    mapping(address => bool) public isExcludedFromReflection;
    mapping(address => bool) private _settling;

    modifier nonReentrant() {
        require(!_locked, "Reentrant call");
        _locked = true;
        _;
        _locked = false;
    }
    //new state variables for V2
    uint256 public maxTxAmount;
    uint256 public maxWalletAmount;

    // Reduced to 44 because we added 2 new state
    uint256[44] private __gap;

    //events
    event TokensPurchased(address indexed buyer, uint256 amount, uint256 cost);
    event TaxDeducted(address indexed from, uint256 reflection, uint256 liquidity, uint256 marketingTax);
    event TokenPriceUpdated(uint256 oldPrice, uint256 newPrice);
    event Blacklisted(address indexed account, bool status);

    // --- Reflection ---

    function balanceOf(address account) public view override returns (uint256) {
        uint256 base = super.balanceOf(account);
        if (isExcludedFromReflection[account]) return base;
        return base + (rewardPerToken - rewardDebt[account]) * base / 1e18;
    }

    function _settleReward(address account) internal {
        if (isExcludedFromReflection[account] || _settling[account]) return;
        _settling[account] = true;
        uint256 base = super.balanceOf(account);
        uint256 pending = (rewardPerToken - rewardDebt[account]) * base / 1e18;
        if (pending > 0) _mint(account, pending);
        rewardDebt[account] = rewardPerToken;
        _settling[account] = false;
    }

    function _distributeReflection(uint256 amount) internal {
        uint256 supply = totalSupply();
        if (supply > 0) rewardPerToken += amount * 1e18 / supply;
    }


    //allows upgrades
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // Onwner sets new token price
    function setTokenPrice(uint256 newPrice) external onlyOwner {
        emit TokenPriceUpdated(tokenPrice, newPrice);
        tokenPrice = newPrice;
    }

    
    function setBlacklist(address account, bool status) external onlyOwner {
        blacklisted[account] = status;
        emit Blacklisted(account, status);
    }

    function setExcludedFromFee(address account, bool excluded) external onlyOwner {
        isExcludedFromFee[account] = excluded;
    }

    function setExcludedFromReflection(address account, bool excluded) external onlyOwner {
        isExcludedFromReflection[account] = excluded;
    }

    //functions to set new transaction and wallet limit
    function setTransactionLimit(uint256 amount) external onlyOwner{
        maxTxAmount = amount;
    }

    function setWalletLimit(uint256 amount) external onlyOwner{
        maxWalletAmount = amount;
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function withdrawETH() external onlyOwner nonReentrant {
        (bool ok, ) = owner().call{value: address(this).balance}("");
        require(ok, "ETH transfer failed");
    }

    //buy tokens
    function buyToken(uint256 _amount) external payable whenNotPaused nonReentrant {
        uint256 cost = _amount * tokenPrice;
        require(msg.value >= cost, "Not enough ETH sent");

        uint256 tokenAmount = _amount * 10 ** decimals();
        require(balanceOf(address(this)) >= tokenAmount, "Not enough tokens");
        require(tokenAmount <= MAX_TX_AMOUNT, "Exceeds max tx");
        require(balanceOf(msg.sender) + tokenAmount <= MAX_WALLET_AMOUNT, "Exceeds max wallet");

        _transfer(address(this), msg.sender, tokenAmount);

        if (msg.value > cost) {
            payable(msg.sender).transfer(msg.value - cost);
        }

        emit TokensPurchased(msg.sender, _amount, cost);
    }

    //helper for transaction tax
    function _applyTax(address from, address to, uint256 amount) internal returns (uint256) {
        if (_inTaxTransfer || isExcludedFromFee[from] || isExcludedFromFee[to]) {
            return amount;
        }

        uint256 reflection   = amount / 100; // 1%
        uint256 liquidity    = amount / 100; // 1%
        uint256 marketingTax = amount / 100; // 1%
        uint256 totalTax     = reflection + liquidity + marketingTax;

        _inTaxTransfer = true;
        super._update(from, address(0), reflection);
        _distributeReflection(reflection);
        super._update(from, address(this), liquidity);
        super._update(from, marketing, marketingTax);
        _inTaxTransfer = false;

        emit TaxDeducted(from, reflection, liquidity, marketingTax);
        return amount - totalTax;
    }

    //Override _transfer to have transaction tax
    function _update(address from, address to, uint256 amount) internal override whenNotPaused {
        _settleReward(from);
        _settleReward(to);

        require(!blacklisted[from] && !blacklisted[to], "Blacklisted");

        if (!_inTaxTransfer && !isExcludedFromFee[from] && !isExcludedFromFee[to]) {
            require(amount <= MAX_TX_AMOUNT, "Exceeds max tx");
            require(balanceOf(to) + amount <= MAX_WALLET_AMOUNT, "Exceeds max wallet");
        }

        uint256 amountAfterTax = _applyTax(from, to, amount);
        super._update(from, to, amountAfterTax);
    }

    receive() external payable {}
}

