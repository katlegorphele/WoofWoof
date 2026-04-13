const { ethers, upgrades } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const marketing = process.env.MARKETING_ADDRESS;
  const dogPark = process.env.DOG_PARK_ADDRESS;
  const dev = process.env.DEV_ADDRESS;
  const charity = process.env.CHARITY_ADDRESS;

  console.log("Deployer:", deployer.address);
  console.log("Buyer:   ", buyer.address);

  // const TOKEN_PRICE = ethers.parseUnits("0.0001", "ether"); // 0.0001 ETH per token
  // const Token = await ethers.getContractFactory("Token");
  // const token = await upgrades.deployProxy(
  //   Token,
  //   [marketing.address, dogPark.address, dev.address, charity.address, TOKEN_PRICE],
  //   { initializer: "initialize", kind: "uups" }
  // );

  // await token.waitForDeployment();
  // const tokenAddress = await token.getAddress();

  // console.log("\nProxy deployed to:      ", tokenAddress);
  // console.log("Implementation deployed:", await upgrades.erc1967.getImplementationAddress(tokenAddress));

  // // buy tokens
  // const AMOUNT = 10n; // buy 10 tokens
  // const cost = AMOUNT * TOKEN_PRICE;

  // console.log("\n--- Buying tokens ---");
  // console.log("Buyer balance before:", ethers.formatUnits(await token.balanceOf(buyer.address), 18), "$BARK");

  // const tx = await token.connect(buyer).buyToken(AMOUNT, { value: cost });
  // await tx.wait();

  // console.log("Buyer balance after: ", ethers.formatUnits(await token.balanceOf(buyer.address), 18), "$BARK");
  // console.log("Contract ETH balance:", ethers.formatEther(await ethers.provider.getBalance(tokenAddress)), "ETH");

  console.log("Upgrading to TokenV2......");
  const tokenAddress = "0xD2B05FecDB2E9D83926E3d6d3b11700A2baB6FF5"; // replace with actual proxy address
  const TokenV2 = await ethers.getContractFactory("TokenV2");
  const tokenV2 = await upgrades.upgradeProxy(tokenAddress, TokenV2);
  await tokenV2.initializeV2();
  await tokenV2.waitForDeployment();
  const tokenV2Address = await tokenV2.getAddress();
  console.log("Proxy address still: ", tokenV2Address);

  const newImplementation = await upgrades.erc1967.getImplementationAddress(tokenAddress);
  console.log("New implementation address: ", newImplementation);

  console.log("Checking if state of contract is reserved.....");
  console.log("Buyer balance after: ", ethers.formatUnits(await tokenV2.balanceOf(deployer.address), 18), "$BARK");
  console.log("Contract ETH balance:", ethers.formatEther(await ethers.provider.getBalance(tokenAddress)), "ETH");

  
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
