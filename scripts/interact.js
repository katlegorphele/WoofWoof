const { ethers, upgrades } = require("hardhat");

const fmt = (val) => Number(ethers.formatUnits(val, 18)).toFixed(8);

function parseTax(receipt, token) {
    return receipt.logs
        .map(log => { try { return token.interface.parseLog(log); } catch { return null; } })
        .find(e => e && e.name === "TaxDeducted");
}

async function printTax(receipt, token) {
    const tax = parseTax(receipt, token);
    if (tax) {
        console.log(
            `  tax  ->  reflection: ${fmt(tax.args.reflection)} | liquidity: ${fmt(tax.args.liquidity)} | marketing: ${fmt(tax.args.marketingTax)}`
        );
    }
}

async function main() {
    const [deployer, marketing, dogPark, dev, charity, buyer1, buyer2, buyer3] = await ethers.getSigners();
    const TOKEN_PRICE = ethers.parseUnits("0.0001", "ether");

    // ─────────────────────────────────────────────
    // LAUNCH
    // ─────────────────────────────────────────────
    console.log("\n--- LAUNCH ---");

    const Token = await ethers.getContractFactory("Token");
    const token = await upgrades.deployProxy(
        Token,
        [marketing.address, dogPark.address, dev.address, charity.address, TOKEN_PRICE],
        { initializer: "initialize", kind: "uups" }
    );
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();

    console.log("Proxy deployed      :", tokenAddress);
    console.log("Implementation      :", await upgrades.erc1967.getImplementationAddress(tokenAddress));
    console.log("Token price         : 0.0001 ETH per $BARK");

    console.log("\nInitial distribution:");
    console.log("  marketing  :", fmt(await token.balanceOf(marketing.address)), "$BARK (20%)");
    console.log("  dogPark    :", fmt(await token.balanceOf(dogPark.address)),   "$BARK (10%)");
    console.log("  dev        :", fmt(await token.balanceOf(dev.address)),        "$BARK  (5%)");
    console.log("  charity    :", fmt(await token.balanceOf(charity.address)),    "$BARK  (5%)");
    console.log("  public pool:", fmt(await token.balanceOf(tokenAddress)),       "$BARK (60%)");
    console.log("  total supply:", fmt(await token.totalSupply()), "$BARK");
    console.log("  rewardPerToken:", fmt(await token.rewardPerToken()), "(nothing earned yet)");

    // ─────────────────────────────────────────────
    // FIRST BUY INS
    // ─────────────────────────────────────────────
    console.log("\n--- FIRST BUY INS ---");

    // Buyer1 buys 1,000,000 tokens
    console.log("\nBuyer1 buys 1,000,000 $BARK");
    let tx = await token.connect(buyer1).buyToken(1_000_000n, { value: 1_000_000n * TOKEN_PRICE });
    let receipt = await tx.wait();
    await printTax(receipt, token);
    console.log("  buyer1 balance  :", fmt(await token.balanceOf(buyer1.address)), "$BARK");
    console.log("  rewardPerToken  :", fmt(await token.rewardPerToken()));

    // Buyer2 buys 2,000,000 tokens
    console.log("\nBuyer2 buys 2,000,000 $BARK");
    tx = await token.connect(buyer2).buyToken(2_000_000n, { value: 2_000_000n * TOKEN_PRICE });
    receipt = await tx.wait();
    await printTax(receipt, token);
    console.log("  buyer1 balance  :", fmt(await token.balanceOf(buyer1.address)), "$BARK");
    console.log("  buyer2 balance  :", fmt(await token.balanceOf(buyer2.address)), "$BARK");
    console.log("  rewardPerToken  :", fmt(await token.rewardPerToken()));

    // Buyer3 buys 500,000 tokens
    console.log("\nBuyer3 buys 500,000 $BARK");
    tx = await token.connect(buyer3).buyToken(500_000n, { value: 500_000n * TOKEN_PRICE });
    receipt = await tx.wait();
    await printTax(receipt, token);
    console.log("  buyer1 balance  :", fmt(await token.balanceOf(buyer1.address)), "$BARK");
    console.log("  buyer2 balance  :", fmt(await token.balanceOf(buyer2.address)), "$BARK");
    console.log("  buyer3 balance  :", fmt(await token.balanceOf(buyer3.address)), "$BARK");
    console.log("  rewardPerToken  :", fmt(await token.rewardPerToken()));

    // ─────────────────────────────────────────────
    // COMMUNITY TRADES
    // ─────────────────────────────────────────────
    console.log("\n--- COMMUNITY TRADES ---");

    console.log("\nBuyer1 transfers 200,000 $BARK to Buyer2");
    tx = await token.connect(buyer1).transfer(buyer2.address, ethers.parseUnits("200000", 18));
    receipt = await tx.wait();
    await printTax(receipt, token);
    console.log("  buyer1 balance  :", fmt(await token.balanceOf(buyer1.address)), "$BARK");
    console.log("  buyer2 balance  :", fmt(await token.balanceOf(buyer2.address)), "$BARK");
    console.log("  buyer3 balance  :", fmt(await token.balanceOf(buyer3.address)), "$BARK  <- grew without transacting");
    console.log("  rewardPerToken  :", fmt(await token.rewardPerToken()));

    console.log("\nBuyer2 transfers 100,000 $BARK to Buyer1");
    tx = await token.connect(buyer2).transfer(buyer1.address, ethers.parseUnits("100000", 18));
    receipt = await tx.wait();
    await printTax(receipt, token);
    console.log("  buyer1 balance  :", fmt(await token.balanceOf(buyer1.address)), "$BARK");
    console.log("  buyer2 balance  :", fmt(await token.balanceOf(buyer2.address)), "$BARK");
    console.log("  buyer3 balance  :", fmt(await token.balanceOf(buyer3.address)), "$BARK  <- grew again");
    console.log("  rewardPerToken  :", fmt(await token.rewardPerToken()));

    // // ─────────────────────────────────────────────
    // // REFLECTION
    // // ─────────────────────────────────────────────
    console.log("\n--- REFLECTION ---");
    console.log("Buyer3 has done nothing since buying. Watch their balance grow as others trade.");

    const buyer3Before = await token.balanceOf(buyer3.address);
    console.log("\n  buyer3 balance before:", fmt(buyer3Before), "$BARK");

    // Buyer1 and Buyer2 trade between themselves — Buyer3 does nothing
    console.log("  (Buyer1 and Buyer2 trade — Buyer3 sits still)");
    tx = await token.connect(buyer1).transfer(buyer2.address, ethers.parseUnits("150000", 18));
    await tx.wait();
    tx = await token.connect(buyer2).transfer(buyer1.address, ethers.parseUnits("80000", 18));
    await tx.wait();

    const buyer3After = await token.balanceOf(buyer3.address);
    const earned = buyer3After - buyer3Before;
    console.log("  buyer3 balance after :", fmt(buyer3After), "$BARK");
    console.log("  earned by just holding:", fmt(earned), "$BARK");

    // Now Buyer3 transacts — _settleReward fires and mints their pending rewards on-chain
    console.log("\nBuyer3 sends 10,000 $BARK to Buyer1 (triggers reward settlement)");
    tx = await token.connect(buyer3).transfer(buyer1.address, ethers.parseUnits("10000", 18));
    receipt = await tx.wait();
    await printTax(receipt, token);
    console.log("  buyer3 balance after settlement:", fmt(await token.balanceOf(buyer3.address)), "$BARK");
    console.log("  rewardPerToken               :", fmt(await token.rewardPerToken()));

    // // ─────────────────────────────────────────────
    // // OWNER CONTROLS
    // // ─────────────────────────────────────────────
    console.log("\n--- OWNER CONTROLS ---");

    // Update token price
    const newPrice = ethers.parseUnits("0.0002", "ether");
    tx = await token.connect(deployer).setTokenPrice(newPrice);
    await tx.wait();
    console.log("\nToken price updated to 0.0002 ETH per $BARK");

    // Pause and verify transfers are blocked
    await token.connect(deployer).pause();
    console.log("Contract paused");
    try {
        await token.connect(buyer1).transfer(buyer2.address, ethers.parseUnits("1", 18));
        console.log("  ERROR: transfer should have been blocked");
    } catch {
        console.log("  transfer blocked while paused (expected)");
    }

    // Unpause
    await token.connect(deployer).unpause();
    console.log("Contract unpaused");
    tx = await token.connect(buyer1).transfer(buyer2.address, ethers.parseUnits("1", 18));
    await tx.wait();
    console.log("  transfer succeeded after unpause");

    // Withdraw accumulated ETH
    const contractEthBefore = await ethers.provider.getBalance(tokenAddress);
    const ownerEthBefore = await ethers.provider.getBalance(deployer.address);
    tx = await token.connect(deployer).withdrawETH();
    await tx.wait();
    const ownerEthAfter = await ethers.provider.getBalance(deployer.address);
    console.log("\nETH withdrawal:");
    console.log("  contract had  :", ethers.formatEther(contractEthBefore), "ETH");
    console.log("  contract now  :", ethers.formatEther(await ethers.provider.getBalance(tokenAddress)), "ETH");
    console.log("  owner gained  :", ethers.formatEther(ownerEthAfter - ownerEthBefore), "ETH (approx, minus gas)");

    // ─────────────────────────────────────────────
    // FINAL STATE
    // ─────────────────────────────────────────────
    console.log("\n--- FINAL STATE ---");

    const totalSupply = await token.totalSupply();
    const rewardPerToken = await token.rewardPerToken();

    console.log("\nWallet balances:");
    console.log("  contract (public pool):", fmt(await token.balanceOf(tokenAddress)),       "$BARK");
    console.log("  marketing             :", fmt(await token.balanceOf(marketing.address)),  "$BARK");
    console.log("  dogPark               :", fmt(await token.balanceOf(dogPark.address)),    "$BARK");
    console.log("  dev                   :", fmt(await token.balanceOf(dev.address)),         "$BARK");
    console.log("  charity               :", fmt(await token.balanceOf(charity.address)),     "$BARK");
    console.log("  buyer1                :", fmt(await token.balanceOf(buyer1.address)),      "$BARK");
    console.log("  buyer2                :", fmt(await token.balanceOf(buyer2.address)),      "$BARK");
    console.log("  buyer3                :", fmt(await token.balanceOf(buyer3.address)),      "$BARK");

    console.log("\nProtocol stats:");
    console.log("  total supply   :", fmt(totalSupply), "$BARK (deflationary — burns exceed minted reflection)");
    console.log("  rewardPerToken :", fmt(rewardPerToken), "(cumulative reflection rate)");
    console.log("  contract ETH   :", ethers.formatEther(await ethers.provider.getBalance(tokenAddress)), "ETH");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
