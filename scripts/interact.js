const { ethers, upgrades } = require("hardhat");

// helper to format token balances
const fmt = (val) => ethers.formatUnits(val, 18);

async function printBalances(label, token, buyers, contractAddress, marketingAddress) {
    console.log(`\n========== ${label} ==========`);
    console.log(`Contract BARK : ${fmt(await token.balanceOf(contractAddress))} $BARK`);
    console.log(`Contract ETH  : ${ethers.formatEther(await ethers.provider.getBalance(contractAddress))} ETH`);
    console.log(`Marketing BARK: ${fmt(await token.balanceOf(marketingAddress))} $BARK`);
    for (let i = 0; i < buyers.length; i++) {
        console.log(`Buyer${i + 1} BARK   : ${fmt(await token.balanceOf(buyers[i].address))} $BARK`);
    }
}

async function main() {
    // --- Signers ---
    const [deployer, marketing, dogPark, dev, charity, buyer1, buyer2, buyer3] = await ethers.getSigners();

    console.log("Deployer  :", deployer.address);
    console.log("Marketing :", marketing.address);
    console.log("DogPark   :", dogPark.address);
    console.log("Dev       :", dev.address);
    console.log("Charity   :", charity.address);
    console.log("Buyer1    :", buyer1.address);
    console.log("Buyer2    :", buyer2.address);
    console.log("Buyer3    :", buyer3.address);

    // --- Deploy ---
    const TOKEN_PRICE = ethers.parseUnits("0.0001", "ether"); // 0.0001 ETH per token

    const Token = await ethers.getContractFactory("Token");
    const token = await upgrades.deployProxy(
        Token,
        [marketing.address, dogPark.address, dev.address, charity.address, TOKEN_PRICE],
        { initializer: "initialize", kind: "uups" }
    );
    await token.waitForDeployment();

    const tokenAddress = await token.getAddress();
    console.log("\nProxy deployed to      :", tokenAddress);
    console.log("Implementation deployed:", await upgrades.erc1967.getImplementationAddress(tokenAddress));

    const buyers = [buyer1, buyer2, buyer3];

    // --- Balances after deployment ---
    await printBalances("AFTER DEPLOYMENT", token, buyers, tokenAddress, marketing.address);

    // --- Buyer1 buys 100 tokens ---
    console.log("\n--- Buyer1 buying 100 tokens ---");
    const amount1 = 100n;
    const cost1 = amount1 * TOKEN_PRICE;
    let tx = await token.connect(buyer1).buyToken(amount1, { value: cost1 });
    let receipt = await tx.wait();
    console.log("Gas used:", receipt.gasUsed.toString());

    // log TaxDeducted event
    const taxEvent1 = receipt.logs
        .map(log => { try { return token.interface.parseLog(log); } catch { return null; } })
        .find(e => e && e.name === "TaxDeducted");
    if (taxEvent1) {
        console.log("Tax — Reflection:", fmt(taxEvent1.args.reflection), "| Liquidity:", fmt(taxEvent1.args.liquidity), "| Marketing:", fmt(taxEvent1.args.marketingTax));
    }

    await printBalances("AFTER BUYER1 BUYS 100 TOKENS", token, buyers, tokenAddress, marketing.address);

    // --- Buyer2 buys 200 tokens ---
    console.log("\n--- Buyer2 buying 200 tokens ---");
    const amount2 = 200n;
    const cost2 = amount2 * TOKEN_PRICE;
    tx = await token.connect(buyer2).buyToken(amount2, { value: cost2 });
    receipt = await tx.wait();
    console.log("Gas used:", receipt.gasUsed.toString());

    const taxEvent2 = receipt.logs
        .map(log => { try { return token.interface.parseLog(log); } catch { return null; } })
        .find(e => e && e.name === "TaxDeducted");
    if (taxEvent2) {
        console.log("Tax — Reflection:", fmt(taxEvent2.args.reflection), "| Liquidity:", fmt(taxEvent2.args.liquidity), "| Marketing:", fmt(taxEvent2.args.marketingTax));
    }

    await printBalances("AFTER BUYER2 BUYS 200 TOKENS", token, buyers, tokenAddress, marketing.address);

    // --- Buyer3 buys 500 tokens ---
    console.log("\n--- Buyer3 buying 500 tokens ---");
    const amount3 = 500n;
    const cost3 = amount3 * TOKEN_PRICE;
    tx = await token.connect(buyer3).buyToken(amount3, { value: cost3 });
    receipt = await tx.wait();
    console.log("Gas used:", receipt.gasUsed.toString());

    const taxEvent3 = receipt.logs
        .map(log => { try { return token.interface.parseLog(log); } catch { return null; } })
        .find(e => e && e.name === "TaxDeducted");
    if (taxEvent3) {
        console.log("Tax — Reflection:", fmt(taxEvent3.args.reflection), "| Liquidity:", fmt(taxEvent3.args.liquidity), "| Marketing:", fmt(taxEvent3.args.marketingTax));
    }

    await printBalances("AFTER BUYER3 BUYS 500 TOKENS", token, buyers, tokenAddress, marketing.address);

    // --- Buyer1 transfers 50 tokens to Buyer2 (tax applies) ---
    console.log("\n--- Buyer1 transfers 50 tokens to Buyer2 ---");
    const transferAmount = ethers.parseUnits("50", 18);
    tx = await token.connect(buyer1).transfer(buyer2.address, transferAmount);
    receipt = await tx.wait();
    console.log("Gas used:", receipt.gasUsed.toString());

    const taxEvent4 = receipt.logs
        .map(log => { try { return token.interface.parseLog(log); } catch { return null; } })
        .find(e => e && e.name === "TaxDeducted");
    if (taxEvent4) {
        console.log("Tax — Reflection:", fmt(taxEvent4.args.reflection), "| Liquidity:", fmt(taxEvent4.args.liquidity), "| Marketing:", fmt(taxEvent4.args.marketingTax));
    }

    await printBalances("AFTER BUYER1 TRANSFERS 50 TO BUYER2", token, buyers, tokenAddress, marketing.address);

    // --- Owner withdraws ETH ---
    console.log("\n--- Owner withdrawing ETH ---");
    const ownerEthBefore = await ethers.provider.getBalance(deployer.address);
    tx = await token.connect(deployer).withdrawETH();
    await tx.wait();
    const ownerEthAfter = await ethers.provider.getBalance(deployer.address);
    console.log("Owner ETH before:", ethers.formatEther(ownerEthBefore));
    console.log("Owner ETH after :", ethers.formatEther(ownerEthAfter));
    console.log("Contract ETH    :", ethers.formatEther(await ethers.provider.getBalance(tokenAddress)), "ETH");

    // --- Owner withdraws BARK tokens ---
    console.log("\n--- Owner withdrawing BARK tokens ---");
    const ownerBarkBefore = await token.balanceOf(deployer.address);
    tx = await token.connect(deployer).withdrawTokens();
    await tx.wait();
    const ownerBarkAfter = await token.balanceOf(deployer.address);
    console.log("Owner BARK before:", fmt(ownerBarkBefore), "$BARK");
    console.log("Owner BARK after :", fmt(ownerBarkAfter), "$BARK");

    await printBalances("FINAL STATE", token, buyers, tokenAddress, marketing.address);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
