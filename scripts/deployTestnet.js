const { ethers, upgrades } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const marketing = process.env.MARKETING_ADDRESS;
  const dogPark = process.env.DOG_PARK_ADDRESS;
  const dev = process.env.DEV_ADDRESS;
  const charity = process.env.CHARITY_ADDRESS;
  const tokenPrice = process.env.TOKEN_PRICE_WEI;

  console.log("Deployer:", deployer.address);

  const TOKEN_PRICE = ethers.parseUnits(tokenPrice, "wei"); // 0.0001 ETH per token

  const Token = await ethers.getContractFactory("Token");

  const token = await upgrades.deployProxy(
    Token,
    [marketing, dogPark, dev, charity, tokenPrice],
    { initializer: "initialize", kind: "uups" }
  );

  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();

  console.log("\nProxy deployed to:      ", tokenAddress);
  console.log("Implementation deployed:", await upgrades.erc1967.getImplementationAddress(tokenAddress));

  // --- Buy tokens as buyer (signer index 5) ---
  const AMOUNT = 10n; // buy 10 tokens
  const cost = AMOUNT * TOKEN_PRICE;

  console.log("\n--- Buying tokens ---");
  console.log("Buyer balance before:", ethers.formatUnits(await token.balanceOf(buyer.address), 18), "$BARK");

  const tx = await token.connect(buyer).buyToken(AMOUNT, { value: cost });
  await tx.wait();

  console.log("Buyer balance after: ", ethers.formatUnits(await token.balanceOf(buyer.address), 18), "$BARK");
  console.log("Contract ETH balance:", ethers.formatEther(await ethers.provider.getBalance(tokenAddress)), "ETH");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
