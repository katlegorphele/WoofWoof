# Reflection.sol

## What is Reflection.sol?
Reflection.sol is a separate abstract contract inherited by Token.sol. Its sole job is to handle **reflection rewards** — a mechanism that automatically distributes a share of every transaction tax to all token holders proportionally, just for holding $BARK.

It is `abstract` meaning it cannot be deployed on its own. It only works when inherited by another contract like Token.sol.

---

## The Core Idea
Instead of sending small amounts of tokens to every holder on every transaction (which would be extremely expensive in gas), reflection uses a **global tracker** called `rewardPerToken`.

Every time a reflection tax is collected:
- `rewardPerToken` increases globally by a small amount
- Every holder's balance automatically grows based on how many tokens they hold
- No transfers happen — balances just grow mathematically
- When a holder next transacts, their pending rewards are minted to their wallet

---

## State Variables

| Variable | What it does |
|----------|-------------|
| `rewardPerToken` | Global tracker that increases every time reflection tax is collected |
| `rewardDebt` | Tracks the value of `rewardPerToken` at the last time each address was settled — used to calculate pending rewards |
| `isExcluded` | Marks addresses that should NOT earn reflection rewards (operational wallets) |
| `_settling` | Per-address reentrancy guard — prevents `_settleReward` from recursing into itself when `_mint` triggers `_update` |

---

## Functions

### `_reflectionBalance(address account)`
Internal view function. Calculates the true balance of an address including unclaimed reflection rewards.
- Gets the raw on-chain token balance
- If the address is excluded, returns the raw balance as-is
- Otherwise adds the pending unclaimed rewards on top of the raw balance
- Formula: `base + (rewardPerToken - rewardDebt[account]) * base / 1e18`

### `balanceOf(address account)`
Overrides ERC20's `balanceOf`. Returns the true balance including pending reflection rewards.
- Calls `_reflectionBalance` internally
- This means when anyone checks a holder's balance, they see their tokens + unclaimed rewards automatically

### `_settleReward(address account)`
Internal function. Calculates and mints pending reflection rewards to an address.
- Skips excluded addresses
- Skips if already settling for this address (reentrancy guard via `_settling`)
- Calculates how many tokens are owed since the last settlement
- Mints those tokens directly to the holder's wallet
- Updates `rewardDebt` to the current `rewardPerToken` so they start fresh
- Called in Token.sol's `_update` before every transfer to settle rewards before balances change

**Why the reentrancy guard is needed:** `_settleReward` calls `_mint`, which triggers `_update`, which calls `_settleReward` again for the same account. Without the `_settling` flag this would recurse infinitely and cause a stack overflow revert.

### `_distributeReflection(uint256 reflectionAmount)`
Internal function. Increases `rewardPerToken` when reflection tax is collected.
- Takes the reflection tax amount
- Divides it proportionally across the total supply
- Increases `rewardPerToken` globally
- All non-excluded holders automatically earn more just from this one update
- Called in Token.sol's `_applyTax` every time a transaction tax is deducted

---

## How It All Works — Full Flow

### When a transaction happens
```
Someone transfers 1000 BARK
    → Token.sol _applyTax collects 10 BARK (1%) as reflection tax
        → _distributeReflection(10) is called
            → rewardPerToken increases by 10 / totalSupply
            → every non-excluded holder's pending rewards grow automatically
```

### When a holder checks their balance
```
Holder calls balanceOf(myWallet)
    → balanceOf calls _reflectionBalance
        → gets raw on-chain balance (e.g. 50,000 BARK)
        → calculates pending rewards: (rewardPerToken - rewardDebt[myWallet]) * 50,000 / 1e18
        → returns 50,000 + pending rewards
```

### When a holder next transacts
```
Holder sends or receives tokens
    → Token.sol _update calls _settleReward(holder)
        → pending rewards calculated
        → rewards minted directly to holder's wallet
        → rewardDebt updated to current rewardPerToken
        → holder now starts accumulating fresh rewards from this point
```

### Example with numbers
```
Total supply: 500,000,000 BARK
Holder A owns: 5,000,000 BARK (1% of supply)
Someone transfers 1,000,000 BARK → 10,000 BARK collected as reflection tax

rewardPerToken increases by: 10,000 / 500,000,000 = 0.00002 per token

Holder A's pending reward: 0.00002 * 5,000,000 = 100 BARK earned automatically
```

---

## Why is rewardDebt needed?
Without `rewardDebt`, every holder would claim rewards from the very beginning of the contract, even rewards collected before they owned any tokens. `rewardDebt` acts as a starting point — it records the value of `rewardPerToken` when a holder last settled, so they only earn rewards from that point forward.

```
Holder buys tokens when rewardPerToken = 500
    → rewardDebt[holder] = 500
Later rewardPerToken grows to 600
    → pending = (600 - 500) * balance / 1e18
    → holder only earns rewards collected after they bought in
```
