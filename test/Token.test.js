const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

// ─── helpers ──────────────────────────────────────────────────────────────────

const T = (n) => ethers.parseUnits(String(n), 18); // token units → wei
const TOKEN_PRICE = ethers.parseUnits("0.0001", "ether");

function parseTax(receipt, token) {
    return receipt.logs
        .map((log) => { try { return token.interface.parseLog(log); } catch { return null; } })
        .find((e) => e && e.name === "TaxDeducted");
}

// ─── shared fixture ───────────────────────────────────────────────────────────

async function deployFixture() {
    const [deployer, marketing, dogPark, dev, charity, buyer1, buyer2, buyer3, other] =
        await ethers.getSigners();

    const Token = await ethers.getContractFactory("Token");
    const token = await upgrades.deployProxy(
        Token,
        [marketing.address, dogPark.address, dev.address, charity.address, TOKEN_PRICE],
        { initializer: "initialize", kind: "uups" }
    );
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();

    return { token, tokenAddress, deployer, marketing, dogPark, dev, charity, buyer1, buyer2, buyer3, other };
}

// ─── fixture with buyers already holding tokens ───────────────────────────────

async function deployWithBuyersFixture() {
    const base = await deployFixture();
    const { token, buyer1, buyer2, buyer3 } = base;

    await token.connect(buyer1).buyToken(1_000_000n, { value: 1_000_000n * TOKEN_PRICE });
    await token.connect(buyer2).buyToken(2_000_000n, { value: 2_000_000n * TOKEN_PRICE });
    await token.connect(buyer3).buyToken(500_000n,   { value:   500_000n * TOKEN_PRICE });

    return base;
}

// ═════════════════════════════════════════════════════════════════════════════
describe("Token", () => {
// ═════════════════════════════════════════════════════════════════════════════

    // ── Deployment ────────────────────────────────────────────────────────────
    describe("Deployment", () => {
        it("sets name and symbol", async () => {
            const { token } = await loadFixture(deployFixture);
            expect(await token.name()).to.equal("Bark-A-Lot");
            expect(await token.symbol()).to.equal("$BARK");
        });

        it("mints correct initial distribution", async () => {
            const { token, tokenAddress, marketing, dogPark, dev, charity } =
                await loadFixture(deployFixture);

            const TOTAL = await token.totalSupply();
            expect(await token.balanceOf(marketing.address)).to.equal(TOTAL * 20n / 100n);
            expect(await token.balanceOf(dogPark.address)).to.equal(TOTAL * 10n / 100n);
            expect(await token.balanceOf(dev.address)).to.equal(TOTAL *  5n / 100n);
            expect(await token.balanceOf(charity.address)).to.equal(TOTAL *  5n / 100n);
            expect(await token.balanceOf(tokenAddress)).to.equal(TOTAL * 60n / 100n);
        });

        it("total supply is 500 million", async () => {
            const { token } = await loadFixture(deployFixture);
            expect(await token.totalSupply()).to.equal(T(500_000_000));
        });

        it("sets token price", async () => {
            const { token } = await loadFixture(deployFixture);
            expect(await token.tokenPrice()).to.equal(TOKEN_PRICE);
        });

        it("excludes system addresses from fees", async () => {
            const { token, deployer, marketing, dogPark, dev, charity, tokenAddress } =
                await loadFixture(deployFixture);

            for (const addr of [deployer.address, marketing.address, dogPark.address,
                                 dev.address, charity.address, tokenAddress, ethers.ZeroAddress]) {
                expect(await token.isExcludedFromFee(addr)).to.be.true;
            }
        });

        it("excludes system addresses from reflection", async () => {
            const { token, deployer, marketing, dogPark, dev, charity, tokenAddress } =
                await loadFixture(deployFixture);

            for (const addr of [deployer.address, marketing.address, dogPark.address,
                                 dev.address, charity.address, tokenAddress, ethers.ZeroAddress]) {
                expect(await token.isExcludedFromReflection(addr)).to.be.true;
            }
        });

        it("rewardPerToken starts at zero", async () => {
            const { token } = await loadFixture(deployFixture);
            expect(await token.rewardPerToken()).to.equal(0n);
        });

        it("reverts if a wallet address is zero", async () => {
            const Token = await ethers.getContractFactory("Token");
            const [, , , , , , , , other] = await ethers.getSigners();
            await expect(
                upgrades.deployProxy(
                    Token,
                    [ethers.ZeroAddress, other.address, other.address, other.address, TOKEN_PRICE],
                    { initializer: "initialize", kind: "uups" }
                )
            ).to.be.reverted;
        });
    });

    // ── Buying tokens ─────────────────────────────────────────────────────────
    describe("Buying", () => {
        it("buyer receives the correct token amount", async () => {
            const { token, buyer1 } = await loadFixture(deployFixture);
            await token.connect(buyer1).buyToken(1000n, { value: 1000n * TOKEN_PRICE });
            expect(await token.balanceOf(buyer1.address)).to.equal(T(1000));
        });

        it("emits TokensPurchased with correct args", async () => {
            const { token, buyer1 } = await loadFixture(deployFixture);
            await expect(
                token.connect(buyer1).buyToken(1000n, { value: 1000n * TOKEN_PRICE })
            )
                .to.emit(token, "TokensPurchased")
                .withArgs(buyer1.address, 1000n, 1000n * TOKEN_PRICE);
        });

        it("no tax is applied on buy (contract is fee-excluded sender)", async () => {
            const { token, buyer1 } = await loadFixture(deployFixture);
            const tx = await token.connect(buyer1).buyToken(1000n, { value: 1000n * TOKEN_PRICE });
            const receipt = await tx.wait();
            const tax = parseTax(receipt, token);
            // No TaxDeducted event should be emitted on a buy
            expect(tax).to.be.undefined;
        });

        it("rewardPerToken stays zero after buys (buys are fee-free)", async () => {
            const { token, buyer1, buyer2 } = await loadFixture(deployFixture);
            await token.connect(buyer1).buyToken(1_000_000n, { value: 1_000_000n * TOKEN_PRICE });
            await token.connect(buyer2).buyToken(2_000_000n, { value: 2_000_000n * TOKEN_PRICE });
            expect(await token.rewardPerToken()).to.equal(0n);
        });

        it("reverts if ETH sent is less than cost", async () => {
            const { token, buyer1 } = await loadFixture(deployFixture);
            const insufficient = 999n * TOKEN_PRICE; // 1 wei short for 1000 tokens
            await expect(
                token.connect(buyer1).buyToken(1000n, { value: insufficient })
            ).to.be.revertedWith("Not enough ETH sent");
        });

        it("reverts if amount exceeds MAX_TX_AMOUNT", async () => {
            const { token, buyer1 } = await loadFixture(deployFixture);
            const over = 5_000_001n;
            await expect(
                token.connect(buyer1).buyToken(over, { value: over * TOKEN_PRICE })
            ).to.be.revertedWith("Exceeds max tx");
        });

        it("reverts if buyer would exceed MAX_WALLET_AMOUNT", async () => {
            const { token, buyer1 } = await loadFixture(deployFixture);
            // Fill buyer1 to exactly MAX_WALLET (10M) via two 5M buys
            await token.connect(buyer1).buyToken(5_000_000n, { value: 5_000_000n * TOKEN_PRICE });
            await token.connect(buyer1).buyToken(5_000_000n, { value: 5_000_000n * TOKEN_PRICE });
            // Any additional purchase now breaches MAX_WALLET_AMOUNT
            await expect(
                token.connect(buyer1).buyToken(1n, { value: 1n * TOKEN_PRICE })
            ).to.be.revertedWith("Exceeds max wallet");
        });

        it("refunds excess ETH sent", async () => {
            const { token, buyer1 } = await loadFixture(deployFixture);
            const cost = 1000n * TOKEN_PRICE;
            const excess = ethers.parseUnits("1", "ether");
            const balBefore = await ethers.provider.getBalance(buyer1.address);

            const tx = await token.connect(buyer1).buyToken(1000n, { value: cost + excess });
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;

            const balAfter = await ethers.provider.getBalance(buyer1.address);
            // net cost = cost + gas (excess was returned)
            expect(balBefore - balAfter).to.be.closeTo(cost + gasUsed, ethers.parseUnits("0.001", "ether"));
        });

        it("contract accumulates ETH from purchases", async () => {
            const { token, tokenAddress, buyer1, buyer2 } = await loadFixture(deployFixture);
            await token.connect(buyer1).buyToken(1_000_000n, { value: 1_000_000n * TOKEN_PRICE });
            await token.connect(buyer2).buyToken(2_000_000n, { value: 2_000_000n * TOKEN_PRICE });
            const contractEth = await ethers.provider.getBalance(tokenAddress);
            expect(contractEth).to.equal(3_000_000n * TOKEN_PRICE);
        });
    });

    // ── Tax mechanics ─────────────────────────────────────────────────────────
    describe("Tax on transfers", () => {
        it("recipient receives amount minus 3% tax", async () => {
            const { token, buyer1, buyer2 } = await loadFixture(deployWithBuyersFixture);
            const sendAmount = T(200_000);

            const buyer2Before = await token.balanceOf(buyer2.address);
            await token.connect(buyer1).transfer(buyer2.address, sendAmount);
            const buyer2After = await token.balanceOf(buyer2.address);

            // 3% deducted — buyer2 gains 97% of the sent amount (plus any virtual reflection)
            const expectedNet = sendAmount * 97n / 100n;
            expect(buyer2After - buyer2Before).to.be.gte(expectedNet);
        });

        it("emits TaxDeducted with 1% each for reflection, liquidity, marketing", async () => {
            const { token, buyer1, buyer2 } = await loadFixture(deployWithBuyersFixture);
            const sendAmount = T(200_000);
            const onePercent = sendAmount / 100n;

            await expect(token.connect(buyer1).transfer(buyer2.address, sendAmount))
                .to.emit(token, "TaxDeducted")
                .withArgs(buyer1.address, onePercent, onePercent, onePercent);
        });

        it("liquidity tax accumulates in the contract", async () => {
            const { token, tokenAddress, buyer1, buyer2 } = await loadFixture(deployWithBuyersFixture);
            const contractBefore = await token.balanceOf(tokenAddress);

            const sendAmount = T(200_000);
            await token.connect(buyer1).transfer(buyer2.address, sendAmount);

            const contractAfter = await token.balanceOf(tokenAddress);
            const expectedLiquidity = sendAmount / 100n;
            expect(contractAfter - contractBefore).to.equal(expectedLiquidity);
        });

        it("marketing tax goes to the marketing wallet", async () => {
            const { token, marketing, buyer1, buyer2 } = await loadFixture(deployWithBuyersFixture);
            const marketingBefore = await token.balanceOf(marketing.address);

            const sendAmount = T(200_000);
            await token.connect(buyer1).transfer(buyer2.address, sendAmount);

            const marketingAfter = await token.balanceOf(marketing.address);
            const expectedMarketing = sendAmount / 100n;
            expect(marketingAfter - marketingBefore).to.equal(expectedMarketing);
        });

        it("no tax when sender is excluded from fee", async () => {
            const { token, deployer, buyer1 } = await loadFixture(deployWithBuyersFixture);
            // deployer is excluded from fee — direct transfer should have no tax
            // first give deployer some tokens
            await token.connect(buyer1).transfer(deployer.address, T(1000));

            // deployer sends back — excluded, so no tax
            const sendAmount = T(500);
            const tx = await token.connect(deployer).transfer(buyer1.address, sendAmount);
            const receipt = await tx.wait();

            expect(parseTax(receipt, token)).to.be.undefined;
        });

        it("no tax when recipient is excluded from fee", async () => {
            const { token, deployer, buyer1 } = await loadFixture(deployWithBuyersFixture);
            const sendAmount = T(1000);
            const tx = await token.connect(buyer1).transfer(deployer.address, sendAmount);
            const receipt = await tx.wait();
            expect(parseTax(receipt, token)).to.be.undefined;
        });

        it("reverts if transfer amount exceeds MAX_TX_AMOUNT for non-excluded", async () => {
            // buyer1 has 1M from the fixture; richBuyer is a fresh signer with no tokens yet
            const { token, buyer1 } = await loadFixture(deployWithBuyersFixture);
            const [,,,,,,,,, richBuyer] = await ethers.getSigners();

            // Fund richBuyer with 6M via two buys (each is ≤ MAX_TX of 5M)
            await token.connect(richBuyer).buyToken(3_000_000n, { value: 3_000_000n * TOKEN_PRICE });
            await token.connect(richBuyer).buyToken(3_000_000n, { value: 3_000_000n * TOKEN_PRICE });

            // Send 5_000_001 to buyer1 (non-excluded) — should revert on MAX_TX_AMOUNT
            // buyer1 would only reach 6,000,001 tokens so MAX_WALLET is not the trigger
            await expect(
                token.connect(richBuyer).transfer(buyer1.address, T(5_000_001))
            ).to.be.revertedWith("Exceeds max tx");
        });
    });

    // ── Reflection ────────────────────────────────────────────────────────────
    describe("Reflection", () => {
        it("rewardPerToken increases after a taxed transfer", async () => {
            const { token, buyer1, buyer2 } = await loadFixture(deployWithBuyersFixture);
            const rptBefore = await token.rewardPerToken();

            await token.connect(buyer1).transfer(buyer2.address, T(200_000));

            expect(await token.rewardPerToken()).to.be.gt(rptBefore);
        });

        it("rewardPerToken increases after each successive taxed transfer", async () => {
            const { token, buyer1, buyer2 } = await loadFixture(deployWithBuyersFixture);

            await token.connect(buyer1).transfer(buyer2.address, T(200_000));
            const rpt1 = await token.rewardPerToken();

            await token.connect(buyer2).transfer(buyer1.address, T(100_000));
            const rpt2 = await token.rewardPerToken();

            expect(rpt2).to.be.gt(rpt1);
        });

        it("balanceOf shows pending reflection for a passive holder", async () => {
            const { token, buyer1, buyer2, buyer3 } = await loadFixture(deployWithBuyersFixture);
            const buyer3Initial = await token.balanceOf(buyer3.address);

            // buyer1 and buyer2 trade — buyer3 does nothing
            await token.connect(buyer1).transfer(buyer2.address, T(200_000));

            const buyer3After = await token.balanceOf(buyer3.address);
            // balanceOf includes virtual pending reflection — should be higher than initial
            expect(buyer3After).to.be.gt(buyer3Initial);
        });

        it("passive holder earns more as others trade", async () => {
            const { token, buyer1, buyer2, buyer3 } = await loadFixture(deployWithBuyersFixture);

            await token.connect(buyer1).transfer(buyer2.address, T(200_000));
            const afterFirst = await token.balanceOf(buyer3.address);

            await token.connect(buyer2).transfer(buyer1.address, T(100_000));
            const afterSecond = await token.balanceOf(buyer3.address);

            expect(afterSecond).to.be.gt(afterFirst);
        });

        it("settlement mints pending rewards to holder when they transact", async () => {
            const { token, buyer1, buyer2, buyer3 } = await loadFixture(deployWithBuyersFixture);
            const buyer3Start = await token.balanceOf(buyer3.address);

            // generate reflection for buyer3
            await token.connect(buyer1).transfer(buyer2.address, T(200_000));
            await token.connect(buyer2).transfer(buyer1.address, T(100_000));

            const buyer3BeforeSettle = await token.balanceOf(buyer3.address);
            expect(buyer3BeforeSettle).to.be.gt(buyer3Start);

            // buyer3 transacts — _settleReward fires, pending gets minted on-chain
            await token.connect(buyer3).transfer(buyer1.address, T(1000));

            // reflection burns tokens from senders; excluded holders dilute rewardPerToken so
            // total minted to buyers < total burned — net effect is totalSupply decreases
            expect(await token.totalSupply()).to.be.lt(T(500_000_000));
        });

        it("excluded address earns no reflection", async () => {
            const { token, buyer1, buyer2, marketing } = await loadFixture(deployWithBuyersFixture);
            const marketingBefore = await token.balanceOf(marketing.address);

            await token.connect(buyer1).transfer(buyer2.address, T(200_000));

            // marketing is excluded from reflection — balance only changes from the 1% marketing tax
            const marketingAfter = await token.balanceOf(marketing.address);
            const expectedIncrease = T(200_000) / 100n; // exactly 1% marketing tax, no reflection
            expect(marketingAfter - marketingBefore).to.equal(expectedIncrease);
        });

        it("rewardDebt is updated after settlement so holder is not paid twice", async () => {
            const { token, buyer1, buyer2, buyer3 } = await loadFixture(deployWithBuyersFixture);

            // generate reflection
            await token.connect(buyer1).transfer(buyer2.address, T(200_000));

            // snapshot rewardPerToken before buyer3 transacts
            const rptBeforeSettle = await token.rewardPerToken();

            // buyer3 settles by transacting — _settleReward runs at the START of _update,
            // stamping rewardDebt to rptBeforeSettle, then buyer3's own transfer adds more reflection
            await token.connect(buyer3).transfer(buyer1.address, T(1000));

            // rewardDebt is the snapshot taken at settlement time, not the post-transfer value
            expect(await token.rewardDebt(buyer3.address)).to.equal(rptBeforeSettle);
        });
    });

    // ── Pause ─────────────────────────────────────────────────────────────────
    describe("Pause", () => {
        it("owner can pause the contract", async () => {
            const { token, deployer } = await loadFixture(deployFixture);
            await token.connect(deployer).pause();
            expect(await token.paused()).to.be.true;
        });

        it("owner can unpause the contract", async () => {
            const { token, deployer } = await loadFixture(deployFixture);
            await token.connect(deployer).pause();
            await token.connect(deployer).unpause();
            expect(await token.paused()).to.be.false;
        });

        it("non-owner cannot pause", async () => {
            const { token, buyer1 } = await loadFixture(deployFixture);
            await expect(token.connect(buyer1).pause())
                .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
        });

        it("transfers revert with EnforcedPause while paused", async () => {
            const { token, deployer, buyer1, buyer2 } = await loadFixture(deployWithBuyersFixture);
            await token.connect(deployer).pause();

            await expect(
                token.connect(buyer1).transfer(buyer2.address, T(100))
            ).to.be.revertedWithCustomError(token, "EnforcedPause");
        });

        it("transfers succeed after unpause", async () => {
            const { token, deployer, buyer1, buyer2 } = await loadFixture(deployWithBuyersFixture);
            await token.connect(deployer).pause();
            await token.connect(deployer).unpause();

            await expect(
                token.connect(buyer1).transfer(buyer2.address, T(100))
            ).to.not.be.reverted;
        });

        it("buyToken reverts while paused", async () => {
            const { token, deployer, buyer1 } = await loadFixture(deployFixture);
            await token.connect(deployer).pause();

            await expect(
                token.connect(buyer1).buyToken(1000n, { value: 1000n * TOKEN_PRICE })
            ).to.be.revertedWithCustomError(token, "EnforcedPause");
        });
    });

    // ── Blacklist ─────────────────────────────────────────────────────────────
    describe("Blacklist", () => {
        it("owner can blacklist an address", async () => {
            const { token, deployer, buyer1 } = await loadFixture(deployFixture);
            await token.connect(deployer).setBlacklist(buyer1.address, true);
            expect(await token.blacklisted(buyer1.address)).to.be.true;
        });

        it("emits Blacklisted event", async () => {
            const { token, deployer, buyer1 } = await loadFixture(deployFixture);
            await expect(token.connect(deployer).setBlacklist(buyer1.address, true))
                .to.emit(token, "Blacklisted")
                .withArgs(buyer1.address, true);
        });

        it("non-owner cannot blacklist", async () => {
            const { token, buyer1, buyer2 } = await loadFixture(deployFixture);
            await expect(token.connect(buyer1).setBlacklist(buyer2.address, true))
                .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
        });

        it("blacklisted sender cannot transfer", async () => {
            const { token, deployer, buyer1, buyer2 } = await loadFixture(deployWithBuyersFixture);
            await token.connect(deployer).setBlacklist(buyer1.address, true);

            await expect(
                token.connect(buyer1).transfer(buyer2.address, T(100))
            ).to.be.revertedWith("Blacklisted");
        });

        it("blacklisted recipient cannot receive", async () => {
            const { token, deployer, buyer1, buyer2 } = await loadFixture(deployWithBuyersFixture);
            await token.connect(deployer).setBlacklist(buyer2.address, true);

            await expect(
                token.connect(buyer1).transfer(buyer2.address, T(100))
            ).to.be.revertedWith("Blacklisted");
        });

        it("owner can remove from blacklist", async () => {
            const { token, deployer, buyer1, buyer2 } = await loadFixture(deployWithBuyersFixture);
            await token.connect(deployer).setBlacklist(buyer1.address, true);
            await token.connect(deployer).setBlacklist(buyer1.address, false);

            await expect(
                token.connect(buyer1).transfer(buyer2.address, T(100))
            ).to.not.be.reverted;
        });
    });

    // ── Owner controls ────────────────────────────────────────────────────────
    describe("Owner controls", () => {
        it("owner can update token price", async () => {
            const { token, deployer } = await loadFixture(deployFixture);
            const newPrice = ethers.parseUnits("0.0002", "ether");
            await token.connect(deployer).setTokenPrice(newPrice);
            expect(await token.tokenPrice()).to.equal(newPrice);
        });

        it("emits TokenPriceUpdated with old and new price", async () => {
            const { token, deployer } = await loadFixture(deployFixture);
            const newPrice = ethers.parseUnits("0.0002", "ether");
            await expect(token.connect(deployer).setTokenPrice(newPrice))
                .to.emit(token, "TokenPriceUpdated")
                .withArgs(TOKEN_PRICE, newPrice);
        });

        it("non-owner cannot update token price", async () => {
            const { token, buyer1 } = await loadFixture(deployFixture);
            await expect(
                token.connect(buyer1).setTokenPrice(ethers.parseUnits("0.0002", "ether"))
            ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
        });

        it("owner can exclude an address from fees", async () => {
            const { token, deployer, buyer1 } = await loadFixture(deployFixture);
            await token.connect(deployer).setExcludedFromFee(buyer1.address, true);
            expect(await token.isExcludedFromFee(buyer1.address)).to.be.true;
        });

        it("owner can exclude an address from reflection", async () => {
            const { token, deployer, buyer1 } = await loadFixture(deployFixture);
            await token.connect(deployer).setExcludedFromReflection(buyer1.address, true);
            expect(await token.isExcludedFromReflection(buyer1.address)).to.be.true;
        });

        it("owner can withdraw accumulated ETH", async () => {
            const { token, tokenAddress, deployer } =
                await loadFixture(deployWithBuyersFixture);

            const contractEth = await ethers.provider.getBalance(tokenAddress);
            expect(contractEth).to.be.gt(0n);

            const ownerBefore = await ethers.provider.getBalance(deployer.address);
            const tx = await token.connect(deployer).withdrawETH();
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            const ownerAfter = await ethers.provider.getBalance(deployer.address);

            expect(await ethers.provider.getBalance(tokenAddress)).to.equal(0n);
            expect(ownerAfter - ownerBefore + gasUsed).to.equal(contractEth);
        });

        it("non-owner cannot withdraw ETH", async () => {
            const { token, buyer1 } = await loadFixture(deployWithBuyersFixture);
            await expect(token.connect(buyer1).withdrawETH())
                .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
        });

        it("new price is enforced on the next buy", async () => {
            const { token, deployer, buyer1 } = await loadFixture(deployFixture);
            const newPrice = ethers.parseUnits("0.0002", "ether");
            await token.connect(deployer).setTokenPrice(newPrice);

            // old price ETH is now insufficient
            await expect(
                token.connect(buyer1).buyToken(1000n, { value: 1000n * TOKEN_PRICE })
            ).to.be.revertedWith("Not enough ETH sent");

            // new price works
            await expect(
                token.connect(buyer1).buyToken(1000n, { value: 1000n * newPrice })
            ).to.not.be.reverted;
        });
    });

    // ── Upgrade (UUPS) ────────────────────────────────────────────────────────
    describe("UUPS Upgrade", () => {
        it("only owner can upgrade the implementation", async () => {
            const { token, buyer1 } = await loadFixture(deployFixture);
            const TokenV2 = await ethers.getContractFactory("Token", buyer1);
            await expect(upgrades.upgradeProxy(await token.getAddress(), TokenV2))
                .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
        });

        it("owner can upgrade and state is preserved", async () => {
            const { token, tokenAddress, deployer, marketing } = await loadFixture(deployFixture);
            const supplyBefore = await token.totalSupply();
            const marketingBefore = await token.balanceOf(marketing.address);

            const TokenV2 = await ethers.getContractFactory("Token", deployer);
            const upgraded = await upgrades.upgradeProxy(tokenAddress, TokenV2);

            expect(await upgraded.totalSupply()).to.equal(supplyBefore);
            expect(await upgraded.balanceOf(marketing.address)).to.equal(marketingBefore);
        });
    });

// ═════════════════════════════════════════════════════════════════════════════
});
// ═════════════════════════════════════════════════════════════════════════════
