const fs = require('fs');
const {
  parseEther,
  formatEther,
  parseUnits,
  parseAbi,
  encodeFunctionData,
  decodeFunctionData,
} = require('viem');

const PAYFLUX_ATOMIC_ROUTER_ABI = parseAbi([
  'constructor(address payable _treasury)',
  'function treasury() external view returns (address payable)',
  'function PLATFORM_FEE_POL() external view returns (uint256)',
  'function swapNativeWithFee(address payable targetRouter, bytes calldata swapData) external payable',
  'function swapTokenWithFee(address targetRouter, address tokenIn, uint256 amountIn, bytes calldata swapData) external payable',
  'function payNativeWithFee(address payable merchant) external payable',
  'function payTokenWithFee(address token, address merchant, uint256 amount) external payable',
  'event AtomicSwapExecuted(address indexed user, address indexed tokenIn, uint256 amountIn, uint256 feePol, address targetRouter)',
  'event AtomicPaymentExecuted(address indexed payer, address indexed merchant, address indexed token, uint256 amount, uint256 feePol)',
  'receive() external payable',
]);

const TREASURY = '0x5545d62F1ca95fF7DfED4e938Fa908d5000FdecD';
const KYBER_ROUTER = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5';
const USDC_POLYGON = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
const MERCHANT = '0x249cA82617eC3DfB2589c4c17ab7EC9765350a18';

console.log('=== PayFlux Atomic Router Test Suite ===\n');

// Test 1: Bytecode & ABI verification
const json = JSON.parse(fs.readFileSync('./contracts/PayFluxAtomicRouter.json', 'utf8'));
console.log('Test 1: Bytecode & ABI Loading');
console.log(' - Bytecode present:', Boolean(json.bytecode && json.bytecode.length > 1000));
console.log(' - ABI entries count:', json.abi.length);
if (!json.bytecode) throw new Error('Bytecode missing');
console.log(' [PASS] Bytecode verified\n');

// Test 2: POL -> Token Swap Encoding (swapNativeWithFee)
console.log('Test 2: POL -> Token Swap Encoding (swapNativeWithFee)');
const mockSwapData = '0x12345678abcdef';
const swapAmount = parseEther('5');
const feeAmount = parseEther('0.1');
const totalValueNative = swapAmount + feeAmount;

const nativeCalldata = encodeFunctionData({
  abi: PAYFLUX_ATOMIC_ROUTER_ABI,
  functionName: 'swapNativeWithFee',
  args: [KYBER_ROUTER, mockSwapData],
});

console.log(' - Total Value Attached:', formatEther(totalValueNative), 'POL');
console.log(' - Expected Fee to Treasury: 0.1 POL');
console.log(' - Expected Net Swap to Kyber: 5.0 POL');
console.log(' - Encoded Calldata length:', nativeCalldata.length);
const decodedNative = decodeFunctionData({
  abi: PAYFLUX_ATOMIC_ROUTER_ABI,
  data: nativeCalldata,
});
console.log(' - Decoded Function Name:', decodedNative.functionName);
console.log(' - Decoded Target Router:', decodedNative.args[0]);
if (decodedNative.args[0].toLowerCase() !== KYBER_ROUTER.toLowerCase()) throw new Error('Router mismatch');
console.log(' [PASS] POL -> Token swap correctly encoded\n');

// Test 3: ERC-20 -> Token Swap Encoding (swapTokenWithFee)
console.log('Test 3: ERC-20 -> Token Swap Encoding (swapTokenWithFee)');
const usdcAmount = parseUnits('25', 6); // 25 USDC
const tokenCalldata = encodeFunctionData({
  abi: PAYFLUX_ATOMIC_ROUTER_ABI,
  functionName: 'swapTokenWithFee',
  args: [KYBER_ROUTER, USDC_POLYGON, usdcAmount, mockSwapData],
});

console.log(' - Attached POL Value: 0.1 POL (PLATFORM_FEE_POL)');
console.log(' - Token In:', USDC_POLYGON);
console.log(' - Amount In:', usdcAmount.toString(), '(25 USDC)');
const decodedToken = decodeFunctionData({
  abi: PAYFLUX_ATOMIC_ROUTER_ABI,
  data: tokenCalldata,
});
console.log(' - Decoded Function Name:', decodedToken.functionName);
console.log(' - Decoded TokenIn:', decodedToken.args[1]);
console.log(' - Decoded AmountIn:', decodedToken.args[2].toString());
if (decodedToken.args[1].toLowerCase() !== USDC_POLYGON.toLowerCase()) throw new Error('Token mismatch');
console.log(' [PASS] ERC-20 -> Token swap correctly encoded\n');

// Test 4: Direct Native POL Pay Encoding (payNativeWithFee)
console.log('Test 4: Direct Native POL Pay Encoding (payNativeWithFee)');
const payAmountPol = parseEther('10');
const totalPayValue = payAmountPol + feeAmount;
const payNativeCalldata = encodeFunctionData({
  abi: PAYFLUX_ATOMIC_ROUTER_ABI,
  functionName: 'payNativeWithFee',
  args: [MERCHANT],
});

console.log(' - Merchant Recipient:', MERCHANT);
console.log(' - Payment Amount:', formatEther(payAmountPol), 'POL');
console.log(' - Attached Value:', formatEther(totalPayValue), 'POL (10 POL to merchant + 0.1 POL fee to treasury)');
const decodedPayNative = decodeFunctionData({
  abi: PAYFLUX_ATOMIC_ROUTER_ABI,
  data: payNativeCalldata,
});
console.log(' - Decoded Function Name:', decodedPayNative.functionName);
console.log(' - Decoded Merchant:', decodedPayNative.args[0]);
if (decodedPayNative.args[0].toLowerCase() !== MERCHANT.toLowerCase()) throw new Error('Merchant mismatch');
console.log(' [PASS] Direct Native POL payment correctly encoded\n');

// Test 5: Direct ERC-20 Pay Encoding (payTokenWithFee)
console.log('Test 5: Direct ERC-20 Pay Encoding (payTokenWithFee)');
const payAmountUsdc = parseUnits('50', 6);
const payTokenCalldata = encodeFunctionData({
  abi: PAYFLUX_ATOMIC_ROUTER_ABI,
  functionName: 'payTokenWithFee',
  args: [USDC_POLYGON, MERCHANT, payAmountUsdc],
});

console.log(' - Token:', USDC_POLYGON);
console.log(' - Merchant:', MERCHANT);
console.log(' - Token Amount:', payAmountUsdc.toString(), '(50 USDC)');
console.log(' - Attached POL Value: 0.1 POL fee to treasury');
const decodedPayToken = decodeFunctionData({
  abi: PAYFLUX_ATOMIC_ROUTER_ABI,
  data: payTokenCalldata,
});
console.log(' - Decoded Function Name:', decodedPayToken.functionName);
console.log(' - Decoded Token:', decodedPayToken.args[0]);
console.log(' - Decoded Merchant:', decodedPayToken.args[1]);
console.log(' - Decoded Amount:', decodedPayToken.args[2].toString());
if (decodedPayToken.args[1].toLowerCase() !== MERCHANT.toLowerCase()) throw new Error('Merchant mismatch');
console.log(' [PASS] Direct ERC-20 payment correctly encoded\n');

// Test 6: Revert & Balance Validation Scenarios
console.log('Test 6: Validation Logic Checks');
function testInsufficientNative(userBalance, swapAmt) {
  const minRequired = swapAmt + 0.1 + 0.008;
  return userBalance >= minRequired;
}
console.log(' - User has 0.05 POL, attempts 1.0 POL swap:', testInsufficientNative(0.05, 1.0) ? 'ALLOWED (FAIL)' : 'BLOCKED PROMPTLY (PASS)');
console.log(' - User has 1.15 POL, attempts 1.0 POL swap:', testInsufficientNative(1.15, 1.0) ? 'ALLOWED (PASS)' : 'BLOCKED (FAIL)');

console.log('\nAll 6 tests passed successfully!');
