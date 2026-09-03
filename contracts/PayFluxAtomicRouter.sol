// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @dev Standard minimal ERC-20 interface for balance checks, transfers, and approvals.
 */
interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/**
 * @title SafeERC20
 * @dev Wrappers around ERC20 operations that throw on failure (handling non-standard tokens like USDT on Polygon).
 */
library SafeERC20 {
    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(token.transfer.selector, to, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "SafeERC20: transfer failed");
    }

    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(token.transferFrom.selector, from, to, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "SafeERC20: transferFrom failed");
    }

    function safeApprove(IERC20 token, address spender, uint256 value) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(token.approve.selector, spender, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "SafeERC20: approve failed");
    }
}

/**
 * @title PayFluxAtomicRouter
 * @notice Atomically executes KyberSwap/QuickSwap DEX trades or merchant payments and delivers 
 *         exactly 0.1 POL platform fee directly to the PayFlux Treasury wallet in ONE transaction.
 * @dev Strictly non-custodial. Zero persistent fund storage. Reverts completely on any failure.
 */
contract PayFluxAtomicRouter {
    using SafeERC20 for IERC20;

    // Official PayFlux Treasury: 0x5545d62F1ca95fF7DfED4e938Fa908d5000FdecD
    address payable public immutable treasury;

    // Exactly 0.1 POL platform fee (100,000,000,000,000,000 wei)
    uint256 public constant PLATFORM_FEE_POL = 0.1 ether;

    uint256 private _status;

    event AtomicSwapExecuted(
        address indexed user,
        address indexed tokenIn,
        uint256 amountIn,
        uint256 feePol,
        address targetRouter
    );

    event AtomicPaymentExecuted(
        address indexed payer,
        address indexed merchant,
        address indexed token,
        uint256 amount,
        uint256 feePol
    );

    modifier nonReentrant() {
        require(_status != 2, "PayFlux: Reentrancy guard violation");
        _status = 2;
        _;
        _status = 1;
    }

    constructor(address payable _treasury) {
        require(_treasury != address(0), "PayFlux: Treasury zero address");
        treasury = _treasury;
        _status = 1;
    }

    /**
     * @notice Atomic swap or converted payment for native POL input.
     * @param targetRouter The DEX router (e.g. KyberSwap MetaAggregationRouterV2 on Polygon).
     * @param swapData The encoded swap calldata.
     * @dev User attaches value: swapAmount + 0.1 POL.
     */
    function swapNativeWithFee(
        address payable targetRouter,
        bytes calldata swapData
    ) external payable nonReentrant {
        require(targetRouter != address(0), "PayFlux: Invalid target router");
        require(msg.value > PLATFORM_FEE_POL, "PayFlux: Insufficient POL sent for fee and swap");
        uint256 swapAmount = msg.value - PLATFORM_FEE_POL;

        // 1. Transfer exactly 0.1 POL fee to PayFlux Treasury
        (bool feeSuccess, ) = treasury.call{value: PLATFORM_FEE_POL}("");
        require(feeSuccess, "PayFlux: Fee transfer to treasury failed");

        // 2. Execute swap on target router with the remaining POL
        (bool swapSuccess, bytes memory returnData) = targetRouter.call{value: swapAmount}(swapData);
        if (!swapSuccess) {
            _bubbleRevert(returnData);
        }

        // 3. Refund any positive slippage native POL back to user
        uint256 leftover = address(this).balance;
        if (leftover > 0) {
            (bool refundSuccess, ) = msg.sender.call{value: leftover}("");
            require(refundSuccess, "PayFlux: POL refund failed");
        }

        emit AtomicSwapExecuted(msg.sender, address(0), swapAmount, PLATFORM_FEE_POL, targetRouter);
    }

    /**
     * @notice Atomic swap or converted payment for ERC-20 input.
     * @param targetRouter The DEX router (e.g. KyberSwap MetaAggregationRouterV2 on Polygon).
     * @param tokenIn The input token address.
     * @param amountIn The token amount to swap.
     * @param swapData The encoded swap calldata.
     * @dev User attaches value: exactly 0.1 POL (fee).
     */
    function swapTokenWithFee(
        address targetRouter,
        address tokenIn,
        uint256 amountIn,
        bytes calldata swapData
    ) external payable nonReentrant {
        require(targetRouter != address(0), "PayFlux: Invalid target router");
        require(msg.value == PLATFORM_FEE_POL, "PayFlux: Attached value must be exactly 0.1 POL fee");
        require(tokenIn != address(0), "PayFlux: Invalid token address");
        require(amountIn > 0, "PayFlux: AmountIn must be greater than zero");

        // 1. Transfer exactly 0.1 POL fee to PayFlux Treasury
        (bool feeSuccess, ) = treasury.call{value: PLATFORM_FEE_POL}("");
        require(feeSuccess, "PayFlux: Fee transfer to treasury failed");

        // 2. Pull user's ERC-20 tokens into this router
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // 3. Approve target router (handle USDT 0-reset on Polygon)
        IERC20(tokenIn).safeApprove(targetRouter, 0);
        IERC20(tokenIn).safeApprove(targetRouter, amountIn);

        uint256 balanceBefore = address(this).balance;

        // 4. Execute swap on target router
        (bool swapSuccess, bytes memory returnData) = targetRouter.call(swapData);
        if (!swapSuccess) {
            _bubbleRevert(returnData);
        }

        // 5. Reset allowance to 0 for hygiene
        IERC20(tokenIn).safeApprove(targetRouter, 0);

        // 6. Refund any unspent input tokens to user (if partial fill occurs)
        uint256 tokenLeftover = IERC20(tokenIn).balanceOf(address(this));
        if (tokenLeftover > 0) {
            IERC20(tokenIn).safeTransfer(msg.sender, tokenLeftover);
        }

        // 7. If output POL was received by this router (e.g. ERC-20 -> POL unwrapped to sender), forward to user
        uint256 balanceAfter = address(this).balance;
        if (balanceAfter > balanceBefore) {
            (bool userPolSuccess, ) = msg.sender.call{value: balanceAfter - balanceBefore}("");
            require(userPolSuccess, "PayFlux: Output POL transfer failed");
        }

        emit AtomicSwapExecuted(msg.sender, tokenIn, amountIn, PLATFORM_FEE_POL, targetRouter);
    }

    /**
     * @notice Direct atomic payment for native POL (Customer pays POL, Merchant receives POL).
     * @param merchant The merchant wallet receiving the payment.
     * @dev User attaches value: payAmount + 0.1 POL.
     */
    function payNativeWithFee(
        address payable merchant
    ) external payable nonReentrant {
        require(merchant != address(0), "PayFlux: Merchant zero address");
        require(msg.value > PLATFORM_FEE_POL, "PayFlux: Insufficient POL sent for fee and payment");
        uint256 payAmount = msg.value - PLATFORM_FEE_POL;

        // 1. Transfer exactly 0.1 POL fee to PayFlux Treasury
        (bool feeSuccess, ) = treasury.call{value: PLATFORM_FEE_POL}("");
        require(feeSuccess, "PayFlux: Fee transfer to treasury failed");

        // 2. Transfer payment directly to merchant
        (bool paySuccess, ) = merchant.call{value: payAmount}("");
        require(paySuccess, "PayFlux: Payment to merchant failed");

        emit AtomicPaymentExecuted(msg.sender, merchant, address(0), payAmount, PLATFORM_FEE_POL);
    }

    /**
     * @notice Direct atomic payment for ERC-20 tokens (Customer pays ERC-20, Merchant receives ERC-20).
     * @param token The ERC-20 token address.
     * @param merchant The merchant wallet receiving the payment.
     * @param amount The token amount to transfer.
     * @dev User attaches value: exactly 0.1 POL (fee).
     */
    function payTokenWithFee(
        address token,
        address merchant,
        uint256 amount
    ) external payable nonReentrant {
        require(token != address(0), "PayFlux: Invalid token address");
        require(merchant != address(0), "PayFlux: Merchant zero address");
        require(amount > 0, "PayFlux: Payment amount must be greater than zero");
        require(msg.value == PLATFORM_FEE_POL, "PayFlux: Attached value must be exactly 0.1 POL fee");

        // 1. Transfer exactly 0.1 POL fee to PayFlux Treasury
        (bool feeSuccess, ) = treasury.call{value: PLATFORM_FEE_POL}("");
        require(feeSuccess, "PayFlux: Fee transfer to treasury failed");

        // 2. Transfer ERC-20 tokens directly from user to merchant
        IERC20(token).safeTransferFrom(msg.sender, merchant, amount);

        emit AtomicPaymentExecuted(msg.sender, merchant, token, amount, PLATFORM_FEE_POL);
    }

    function _bubbleRevert(bytes memory returnData) internal pure {
        if (returnData.length == 0) revert("PayFlux: Underlying call reverted");
        assembly {
            let returndata_size := mload(returnData)
            revert(add(32, returnData), returndata_size)
        }
    }

    receive() external payable {}
}
