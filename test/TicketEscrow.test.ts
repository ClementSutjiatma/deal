import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { keccak256, toHex } from "viem";

describe("TicketEscrow", function () {
  async function deployFixture() {
    const [owner, buyer, seller, other] = await hre.ethers.getSigners();

    // Deploy mock USDC
    const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);

    // Deploy escrow
    const TicketEscrow = await hre.ethers.getContractFactory("TicketEscrow");
    const escrow = await TicketEscrow.deploy(
      await usdc.getAddress(),
      owner.address
    );

    // Mint USDC to buyer
    const amount = 400_000_000n; // $400 USDC (6 decimals)
    await usdc.mint(buyer.address, amount);
    await usdc.connect(buyer).approve(await escrow.getAddress(), amount);

    const dealId = keccak256(toHex("test-deal-uuid"));
    const transferDeadline = 7200n; // 2 hours
    const confirmDeadline = 14400n; // 4 hours
    const feeBps = 250n; // 2.5%

    return {
      escrow,
      usdc,
      owner,
      buyer,
      seller,
      other,
      amount,
      dealId,
      transferDeadline,
      confirmDeadline,
      feeBps,
    };
  }

  describe("deposit", function () {
    it("should create a deal and transfer USDC to escrow", async function () {
      const { escrow, usdc, buyer, seller, amount, dealId, transferDeadline, confirmDeadline, feeBps } =
        await deployFixture();

      await expect(
        escrow
          .connect(buyer)
          .deposit(dealId, seller.address, amount, feeBps, transferDeadline, confirmDeadline)
      )
        .to.emit(escrow, "DealFunded")
        .withArgs(dealId, buyer.address, seller.address, amount);

      expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(amount);
    });

    it("should revert if deal already exists", async function () {
      const { escrow, buyer, seller, amount, dealId, transferDeadline, confirmDeadline, feeBps } =
        await deployFixture();

      await escrow
        .connect(buyer)
        .deposit(dealId, seller.address, amount, feeBps, transferDeadline, confirmDeadline);

      await expect(
        escrow
          .connect(buyer)
          .deposit(dealId, seller.address, amount, feeBps, transferDeadline, confirmDeadline)
      ).to.be.revertedWith("Deal already exists");
    });

    it("should revert if buyer is seller", async function () {
      const { escrow, buyer, amount, dealId, transferDeadline, confirmDeadline, feeBps } =
        await deployFixture();

      await expect(
        escrow
          .connect(buyer)
          .deposit(dealId, buyer.address, amount, feeBps, transferDeadline, confirmDeadline)
      ).to.be.revertedWith("Buyer cannot be seller");
    });
  });

  describe("markTransferred", function () {
    it("should update deal status to Transferred", async function () {
      const { escrow, buyer, seller, amount, dealId, transferDeadline, confirmDeadline, feeBps } =
        await deployFixture();

      await escrow
        .connect(buyer)
        .deposit(dealId, seller.address, amount, feeBps, transferDeadline, confirmDeadline);

      await expect(escrow.connect(seller).markTransferred(dealId))
        .to.emit(escrow, "DealTransferred")
        .withArgs(dealId);
    });

    it("should revert if not seller", async function () {
      const { escrow, buyer, seller, amount, dealId, transferDeadline, confirmDeadline, feeBps } =
        await deployFixture();

      await escrow
        .connect(buyer)
        .deposit(dealId, seller.address, amount, feeBps, transferDeadline, confirmDeadline);

      await expect(
        escrow.connect(buyer).markTransferred(dealId)
      ).to.be.revertedWith("Not seller");
    });

    it("should revert if transfer deadline passed", async function () {
      const { escrow, buyer, seller, amount, dealId, transferDeadline, confirmDeadline, feeBps } =
        await deployFixture();

      await escrow
        .connect(buyer)
        .deposit(dealId, seller.address, amount, feeBps, transferDeadline, confirmDeadline);

      await time.increase(7201);

      await expect(
        escrow.connect(seller).markTransferred(dealId)
      ).to.be.revertedWith("Transfer deadline passed");
    });
  });

  describe("confirm", function () {
    it("should release funds to seller minus fee", async function () {
      const { escrow, usdc, buyer, seller, owner, amount, dealId, transferDeadline, confirmDeadline, feeBps } =
        await deployFixture();

      await escrow
        .connect(buyer)
        .deposit(dealId, seller.address, amount, feeBps, transferDeadline, confirmDeadline);
      await escrow.connect(seller).markTransferred(dealId);

      const sellerBefore = await usdc.balanceOf(seller.address);
      const platformBefore = await usdc.balanceOf(owner.address);

      await escrow.connect(buyer).confirm(dealId);

      const fee = (amount * feeBps) / 10000n;
      const sellerAmount = amount - fee;

      expect(await usdc.balanceOf(seller.address)).to.equal(
        sellerBefore + sellerAmount
      );
      expect(await usdc.balanceOf(owner.address)).to.equal(
        platformBefore + fee
      );
    });
  });

  describe("refund", function () {
    it("should refund buyer after transfer deadline", async function () {
      const { escrow, usdc, buyer, seller, amount, dealId, transferDeadline, confirmDeadline, feeBps } =
        await deployFixture();

      await escrow
        .connect(buyer)
        .deposit(dealId, seller.address, amount, feeBps, transferDeadline, confirmDeadline);

      await time.increase(7201);

      const buyerBefore = await usdc.balanceOf(buyer.address);

      await expect(escrow.connect(buyer).refund(dealId))
        .to.emit(escrow, "DealRefunded")
        .withArgs(dealId, amount);

      expect(await usdc.balanceOf(buyer.address)).to.equal(
        buyerBefore + amount
      );
    });

    it("should revert if transfer deadline not passed", async function () {
      const { escrow, buyer, seller, amount, dealId, transferDeadline, confirmDeadline, feeBps } =
        await deployFixture();

      await escrow
        .connect(buyer)
        .deposit(dealId, seller.address, amount, feeBps, transferDeadline, confirmDeadline);

      await expect(
        escrow.connect(buyer).refund(dealId)
      ).to.be.revertedWith("Transfer deadline not passed");
    });
  });

  describe("autoRelease", function () {
    it("should release funds after confirm deadline", async function () {
      const { escrow, usdc, buyer, seller, owner, amount, dealId, transferDeadline, confirmDeadline, feeBps } =
        await deployFixture();

      await escrow
        .connect(buyer)
        .deposit(dealId, seller.address, amount, feeBps, transferDeadline, confirmDeadline);
      await escrow.connect(seller).markTransferred(dealId);

      await time.increase(14401);

      await expect(escrow.autoRelease(dealId)).to.emit(escrow, "DealReleased");
    });
  });

  describe("dispute + resolveDispute", function () {
    it("should allow buyer to dispute and owner to resolve in buyer favor", async function () {
      const { escrow, usdc, buyer, seller, owner, amount, dealId, transferDeadline, confirmDeadline, feeBps } =
        await deployFixture();

      await escrow
        .connect(buyer)
        .deposit(dealId, seller.address, amount, feeBps, transferDeadline, confirmDeadline);
      await escrow.connect(seller).markTransferred(dealId);

      await expect(escrow.connect(buyer).dispute(dealId))
        .to.emit(escrow, "DealDisputed")
        .withArgs(dealId);

      const buyerBefore = await usdc.balanceOf(buyer.address);

      await expect(escrow.connect(owner).resolveDispute(dealId, true))
        .to.emit(escrow, "DisputeResolved")
        .withArgs(dealId, buyer.address, true);

      expect(await usdc.balanceOf(buyer.address)).to.equal(
        buyerBefore + amount
      );
    });

    it("should allow resolve in seller favor", async function () {
      const { escrow, usdc, buyer, seller, owner, amount, dealId, transferDeadline, confirmDeadline, feeBps } =
        await deployFixture();

      await escrow
        .connect(buyer)
        .deposit(dealId, seller.address, amount, feeBps, transferDeadline, confirmDeadline);
      await escrow.connect(seller).markTransferred(dealId);
      await escrow.connect(buyer).dispute(dealId);

      await escrow.connect(owner).resolveDispute(dealId, false);

      const fee = (amount * feeBps) / 10000n;
      expect(await usdc.balanceOf(seller.address)).to.equal(amount - fee);
    });

    it("should revert if non-owner tries to resolve", async function () {
      const { escrow, buyer, seller, amount, dealId, transferDeadline, confirmDeadline, feeBps } =
        await deployFixture();

      await escrow
        .connect(buyer)
        .deposit(dealId, seller.address, amount, feeBps, transferDeadline, confirmDeadline);
      await escrow.connect(seller).markTransferred(dealId);
      await escrow.connect(buyer).dispute(dealId);

      await expect(
        escrow.connect(buyer).resolveDispute(dealId, true)
      ).to.be.reverted;
    });

    it("dispute should prevent autoRelease", async function () {
      const { escrow, buyer, seller, amount, dealId, transferDeadline, confirmDeadline, feeBps } =
        await deployFixture();

      await escrow
        .connect(buyer)
        .deposit(dealId, seller.address, amount, feeBps, transferDeadline, confirmDeadline);
      await escrow.connect(seller).markTransferred(dealId);
      await escrow.connect(buyer).dispute(dealId);

      await time.increase(14401);

      await expect(
        escrow.autoRelease(dealId)
      ).to.be.revertedWith("Not transferred");
    });
  });
});
