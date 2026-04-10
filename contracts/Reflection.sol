// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

abstract contract Reflection is ERC20Upgradeable {
    uint256 public rewardPerToken;
    mapping(address => uint256) public rewardDebt;
    mapping(address => bool) public isExcluded;
    mapping(address => bool) private _settling;

    function _reflectionBalance(address account) internal view returns (uint256) {
        uint256 base = super.balanceOf(account);
        if (isExcluded[account]) return base;
        return base + (rewardPerToken - rewardDebt[account]) * base / 1e18;
    }

    function balanceOf(address account) public view override returns (uint256) {
        return _reflectionBalance(account);
    }

    function _settleReward(address account) internal {
        if (isExcluded[account] || _settling[account]) return;
        _settling[account] = true;
        uint256 base = super.balanceOf(account);
        uint256 pending = (rewardPerToken - rewardDebt[account]) * base / 1e18;
        if (pending > 0) _mint(account, pending);
        rewardDebt[account] = rewardPerToken;
        _settling[account] = false;
    }

    function _distributeReflection(uint256 reflectionAmount) internal {
        uint256 supply = totalSupply();
        if (supply > 0) rewardPerToken += reflectionAmount * 1e18 / supply;
    }
}

