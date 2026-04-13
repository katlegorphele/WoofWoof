# Token.sol — Bark-A-Lot ($BARK)

## What is Token.sol?
Token.sol is the main smart contract for the $BARK meme coin. It is an ERC20 token built on Ethereum with the following features:
- Token buying directly from the contract
- 3% transaction tax split between reflection, liquidity, and marketing
- Reflection rewards for all holders (passive income just for holding)
- Blacklisting to block bad actors
- Fee exemptions for operational wallets
- Pause/unpause for emergencies
- Upgradeable via UUPS proxy pattern

---

## Token Distribution (500,000,000 $BARK Total Supply)
| Wallet     | Allocation |
|------------|------------|
| Marketing  | 20% (100,000,000) |
| Dog Park   | 10% (50,000,000)  |
| Dev        | 5%  (25,000,000)  |
| Charity    | 5%  (25,000,000)  |
| Public     | 60% (300,000,000) |

---

## Transaction Tax (3% on every transfer)
| Tax        | Amount | Goes To |
|------------|--------|---------|
| Reflection | 1%     | Distributed to all holders proportionally |
| Liquidity  | 1%     | Held by the contract |
| Marketing  | 1%     | Marketing wallet |

---

## Functions

### `initialize()`
The constructor equivalent for upgradeable contracts. Runs once on deployment.
- Sets the marketing, dogPark, dev, and charity wallet addresses
- Sets the initial token price
- Mints the total supply and distributes it to the wallets above
- Sets up OpenZeppelin modules (ERC20, Ownable, Pausable)
- Automatically excludes the owner and contract address from fees so admin operations (e.g. `withdrawTokens`) are not subject to tax or transfer limits

### `buyToken(uint256 _amount)`
Allows anyone to buy tokens directly from the contract by sending ETH.
- Buyer specifies how many tokens they want
- Contract checks they sent enough ETH
- Contract checks the token amount does not exceed max transaction or max wallet limits
- Transfers tokens to the buyer
- Refunds any excess ETH if the buyer overpaid
- Emits a `TokensPurchased` event

### `_applyTax(address from, address to, uint256 amount)`
Internal helper that deducts the 3% tax before every transfer.
- Skips tax if `from` or `to` is the zero address (mint/burn operations)
- Skips tax if the sender or receiver is excluded from fees
- Splits the tax: 1% reflection, 1% liquidity, 1% marketing
- Calls `_distributeReflection` to spread the reflection tax to all holders
- Sends liquidity tax to the contract
- Sends marketing tax to the marketing wallet
- Returns the amount after tax so the recipient gets the correct amount
- Emits a `TaxDeducted` event

### `_update(address from, address to, uint256 amount)`
Overrides the ERC20 internal transfer hook. Runs before every token movement.
- Skips pause and blacklist checks during mint/burn (when `from` or `to` is the zero address) — allows `initialize` to mint the total supply before the contract is fully set up
- Blocks blacklisted addresses from sending or receiving on normal transfers
- Settles pending reflection rewards for sender and receiver before balances change (skipped for zero address)
- Enforces max transaction and max wallet limits (skipped for mint/burn and fee-excluded addresses)
- Calls `_applyTax` to deduct the 3% tax (skipped for mint/burn)
- Completes the transfer with the post-tax amount

### `setTokenPrice(uint256 newPrice)`
Owner only. Updates the price of the token in ETH (wei).
- Emits a `TokenPriceUpdated` event with the old and new price

### `setBlacklist(address account, bool status)`
Owner only. Adds or removes an address from the blacklist.
- Blacklisted addresses cannot send or receive tokens
- Emits a `Blacklisted` event

### `setExcludedFromFee(address account, bool excluded)`
Owner only. Excludes or includes an address from paying the 3% transaction tax.
- Used for operational wallets that should not be taxed

### `pause()` / `unpause()`
Owner only. Freezes or unfreezes all token transfers.
- Useful in emergencies to stop all activity on the contract

### `withdrawETH()`
Owner only. Withdraws all ETH held by the contract to the owner's wallet.
- Protected by `nonReentrant` to prevent reentrancy attacks

### `withdrawTokens()`
Owner only. Withdraws all $BARK tokens held by the contract to the owner's wallet.
- Protected by `nonReentrant` to prevent reentrancy attacks
- Works correctly because the contract address is excluded from fees and transfer limits at deployment

### `_authorizeUpgrade()`
Internal. Required by the UUPS upgrade pattern.
- Only the owner can authorize a contract upgrade

---

## How It All Works — Full Flow

### Deployment
```
Owner deploys contract
    → initialize() runs
        → Total supply minted and distributed to wallets
        → 60% held by contract for public sale
        → Token price set
        → Owner and contract address excluded from fees and transfer limits
```

### Buying Tokens
```
Buyer calls buyToken(1000)
    → Contract checks buyer sent enough ETH
    → Contract checks 1000 tokens does not exceed limits
    → _transfer is called internally
        → _update fires
            → checks buyer is not blacklisted
            → _settleReward runs for contract and buyer (reflection settled)
            → _applyTax runs
                → 1% reflection distributed to all holders via rewardPerToken
                → 1% liquidity sent to contract
                → 1% marketing sent to marketing wallet
            → buyer receives 970 tokens (after 3% tax)
    → excess ETH refunded if overpaid
    → TokensPurchased event emitted
```

### Reflection Rewards
```
Every transaction collects 1% reflection tax
    → rewardPerToken increases globally
    → every holder's balance automatically grows proportionally
    → next time a holder transacts, _settleReward mints their pending rewards to their wallet
```

### Emergency
```
Owner calls pause()
    → all transfers blocked
    → buyToken blocked
Owner calls unpause()
    → everything resumes
```

---

## TokenV2 — Upgrade

### What changed in V2?
TokenV2 is an upgraded version of the original Token contract deployed via the UUPS proxy pattern. The proxy address stays the same, all existing state (balances, ETH, owner, token price) is preserved, and only the implementation logic is replaced.

Two new state variables were added to give the owner runtime control over transaction and wallet limits, which were previously hardcoded as constants.

### New State Variables
| Variable         | Type      | Description |
|------------------|-----------|-------------|
| `maxTxAmount`    | uint256   | Maximum tokens allowed in a single transaction. Replaces the hardcoded `MAX_TX_AMOUNT` constant. |
| `maxWalletAmount`| uint256   | Maximum tokens a single wallet can hold. Replaces the hardcoded `MAX_WALLET_AMOUNT` constant. |

### Storage Layout
To safely add new variables without corrupting existing storage, the `__gap` array in V1 was sized at `uint256[46]`. In V2, two slots were consumed by the new variables, so `__gap` was reduced to `uint256[44]`. This keeps the total storage footprint identical and prevents slot collisions.

### New Functions

#### `setTransactionLimit(uint256 amount)`
Owner only. Updates the maximum number of tokens allowed in a single transfer.
- Writes to `maxTxAmount`
- Allows the owner to tighten or loosen transaction limits after deployment without needing another upgrade

#### `setWalletLimit(uint256 amount)`
Owner only. Updates the maximum number of tokens a single wallet can hold.
- Writes to `maxWalletAmount`
- Allows the owner to adjust wallet caps after deployment without needing another upgrade

### How the Upgrade Works
```
Owner runs upgradeProxy()
    → New TokenV2 implementation is deployed to a new address
    → Proxy's implementation slot is updated to point to TokenV2
    → All existing state in the proxy is untouched:
        → Token balances preserved
        → ETH balance preserved
        → Owner preserved
        → Token price preserved
    → Contract is now running TokenV2 logic at the same proxy address
```

### Why No Re-initialization?
V2 does not need to call parent initializers (`__ERC20_init`, `__Ownable_init`, etc.) again because they were already called during the original V1 deployment. Calling them again would reset state like the token name and owner. Since `maxTxAmount` and `maxWalletAmount` default to `0` on upgrade, the owner should call `setTransactionLimit` and `setWalletLimit` after upgrading to set the desired values.
