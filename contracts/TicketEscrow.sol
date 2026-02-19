// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract TicketEscrow is Ownable {
    using SafeERC20 for IERC20;

    enum DealStatus { None, Funded, Transferred, Released, Refunded, Disputed }

    struct Deal {
        address buyer;
        address seller;
        uint256 amount;
        uint256 depositedAt;
        uint256 transferredAt;
        uint256 transferDeadline;
        uint256 confirmDeadline;
        DealStatus status;
    }

    IERC20 public immutable usdc;
    mapping(bytes32 => Deal) public deals;

    event DealFunded(bytes32 indexed dealId, address buyer, address seller, uint256 amount);
    event DealTransferred(bytes32 indexed dealId);
    event DealReleased(bytes32 indexed dealId, uint256 amount);
    event DealRefunded(bytes32 indexed dealId, uint256 amount);
    event DealDisputed(bytes32 indexed dealId);
    event DisputeResolved(bytes32 indexed dealId, address winner, bool favoredBuyer);

    constructor(address _usdc) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
    }

    function deposit(
        bytes32 dealId,
        address seller,
        uint256 amount,
        uint256 transferDeadline,
        uint256 confirmDeadline
    ) external {
        require(deals[dealId].status == DealStatus.None, "Deal already exists");
        require(amount > 0, "Amount must be positive");
        require(seller != address(0), "Invalid seller");
        require(seller != msg.sender, "Buyer cannot be seller");

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        deals[dealId] = Deal({
            buyer: msg.sender,
            seller: seller,
            amount: amount,
            depositedAt: block.timestamp,
            transferredAt: 0,
            transferDeadline: transferDeadline,
            confirmDeadline: confirmDeadline,
            status: DealStatus.Funded
        });

        emit DealFunded(dealId, msg.sender, seller, amount);
    }

    function markTransferred(bytes32 dealId) external {
        Deal storage deal = deals[dealId];
        require(deal.status == DealStatus.Funded, "Not funded");
        require(msg.sender == deal.seller, "Not seller");
        require(
            block.timestamp <= deal.depositedAt + deal.transferDeadline,
            "Transfer deadline passed"
        );

        deal.status = DealStatus.Transferred;
        deal.transferredAt = block.timestamp;

        emit DealTransferred(dealId);
    }

    function confirm(bytes32 dealId) external {
        Deal storage deal = deals[dealId];
        require(deal.status == DealStatus.Transferred, "Not transferred");
        require(msg.sender == deal.buyer, "Not buyer");

        _releaseFunds(dealId, deal);
    }

    function refund(bytes32 dealId) external {
        Deal storage deal = deals[dealId];
        require(deal.status == DealStatus.Funded, "Not funded");
        require(
            block.timestamp > deal.depositedAt + deal.transferDeadline,
            "Transfer deadline not passed"
        );

        deal.status = DealStatus.Refunded;
        usdc.safeTransfer(deal.buyer, deal.amount);

        emit DealRefunded(dealId, deal.amount);
    }

    function autoRelease(bytes32 dealId) external {
        Deal storage deal = deals[dealId];
        require(deal.status == DealStatus.Transferred, "Not transferred");
        require(
            block.timestamp > deal.transferredAt + deal.confirmDeadline,
            "Confirm deadline not passed"
        );

        _releaseFunds(dealId, deal);
    }

    function dispute(bytes32 dealId) external {
        Deal storage deal = deals[dealId];
        require(deal.status == DealStatus.Transferred, "Not transferred");
        require(msg.sender == deal.buyer, "Not buyer");
        require(
            block.timestamp <= deal.transferredAt + deal.confirmDeadline,
            "Confirm deadline passed"
        );

        deal.status = DealStatus.Disputed;

        emit DealDisputed(dealId);
    }

    function resolveDispute(bytes32 dealId, bool favorBuyer) external onlyOwner {
        Deal storage deal = deals[dealId];
        require(deal.status == DealStatus.Disputed, "Not disputed");

        if (favorBuyer) {
            deal.status = DealStatus.Refunded;
            usdc.safeTransfer(deal.buyer, deal.amount);
            emit DisputeResolved(dealId, deal.buyer, true);
            emit DealRefunded(dealId, deal.amount);
        } else {
            _releaseFunds(dealId, deal);
            emit DisputeResolved(dealId, deal.seller, false);
        }
    }

    function _releaseFunds(bytes32 dealId, Deal storage deal) internal {
        deal.status = DealStatus.Released;
        usdc.safeTransfer(deal.seller, deal.amount);

        emit DealReleased(dealId, deal.amount);
    }
}
