pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract TheoremProverFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    struct Batch {
        uint256 id;
        bool isActive;
    }
    uint256 public currentBatchId;
    mapping(uint256 => Batch) public batches;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused(address account);
    event Unpaused(address account);
    event CooldownSecondsSet(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event TheoremSubmitted(address indexed provider, uint256 indexed batchId, bytes32 encryptedTheoremHash);
    event ProofSearchInitiated(uint256 indexed requestId, uint256 indexed batchId);
    event ProofSearchCompleted(uint256 indexed requestId, uint256 indexed batchId, bool hasProof, uint32 proofId);

    error NotOwner();
    error NotProvider();
    error PausedError();
    error CooldownActive();
    error BatchNotActive();
    error ReplayAttempt();
    error StateMismatch();
    error InvalidProof();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert PausedError();
        _;
    }

    modifier submissionCooldown(address submitter) {
        if (block.timestamp < lastSubmissionTime[submitter] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier decryptionRequestCooldown(address requester) {
        if (block.timestamp < lastDecryptionRequestTime[requester] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[msg.sender] = true;
        emit ProviderAdded(msg.sender);
        currentBatchId = 1;
        _openBatch(currentBatchId);
        cooldownSeconds = 60; // Default 1 minute cooldown
    }

    function transferOwnership(address newOwner) public onlyOwner {
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    function addProvider(address provider) public onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) public onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function pause() public onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() public onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) public onlyOwner {
        uint256 oldCooldownSeconds = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSecondsSet(oldCooldownSeconds, newCooldownSeconds);
    }

    function openNewBatch() public onlyOwner {
        currentBatchId++;
        _openBatch(currentBatchId);
    }

    function closeCurrentBatch() public onlyOwner {
        _closeBatch(currentBatchId);
    }

    function submitEncryptedTheorem(euint32 encryptedTheorem, uint32 theoremId) public onlyProvider whenNotPaused submissionCooldown(msg.sender) {
        _requireInitialized(encryptedTheorem);
        if (!batches[currentBatchId].isActive) revert BatchNotActive();

        lastSubmissionTime[msg.sender] = block.timestamp;
        bytes32 encryptedTheoremHash = keccak256(encryptedTheorem.toBytes32());
        emit TheoremSubmitted(msg.sender, currentBatchId, encryptedTheoremHash);

        _searchForProof(encryptedTheorem, theoremId);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayAttempt();

        // Rebuild ciphertexts array in the exact same order as during requestDecryption
        // For this contract, it's always one euint32 (proofId) and one ebool (hasProof)
        euint32 proofId_e = FHE.asEuint32(0); // Placeholder, actual ciphertexts should be fetched from storage if needed
        ebool hasProof_e = FHE.asEbool(false); // Placeholder

        bytes32[] memory cts = new bytes32[](2);
        cts[0] = proofId_e.toBytes32();
        cts[1] = hasProof_e.toBytes32();

        bytes32 currentHash = _hashCiphertexts(cts);
        if (currentHash != decryptionContexts[requestId].stateHash) revert StateMismatch();

        if (!FHE.checkSignatures(requestId, cleartexts, proof)) revert InvalidProof();

        // Decode cleartexts in the same order: proofId (uint32), hasProof (bool)
        uint32 proofId = abi.decode(cleartexts, (uint32));
        bool hasProof = abi.decode(cleartexts, (uint32, bool))[1];

        decryptionContexts[requestId].processed = true;
        emit ProofSearchCompleted(requestId, decryptionContexts[requestId].batchId, hasProof, proofId);
    }

    function _openBatch(uint256 batchId) internal {
        batches[batchId] = Batch({ id: batchId, isActive: true });
        emit BatchOpened(batchId);
    }

    function _closeBatch(uint256 batchId) internal {
        batches[batchId].isActive = false;
        emit BatchClosed(batchId);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 value) internal {
        if (!value.isInitialized()) {
            value.init();
        }
    }

    function _requireInitialized(euint32 value) internal pure {
        if (!value.isInitialized()) revert("FHE value not initialized");
    }

    function _requireInitialized(ebool value) internal pure {
        if (!value.isInitialized()) revert("FHE value not initialized");
    }

    function _searchForProof(euint32 encryptedTheorem, uint32 theoremId) internal {
        _initIfNeeded(encryptedTheorem);

        // Simulate FHE computation for proof search.
        // In a real scenario, this would be a complex encrypted logic.
        // For this example, we'll just "find" a proof or counterexample based on theoremId.
        ebool hasProof_e = FHE.asEbool(theoremId % 2 == 0); // Example logic
        euint32 proofId_e = FHE.asEuint32(theoremId + 1000); // Example logic

        _initIfNeeded(hasProof_e);
        _initIfNeeded(proofId_e);

        bytes32[] memory cts = new bytes32[](2);
        cts[0] = proofId_e.toBytes32();
        cts[1] = hasProof_e.toBytes32();

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({
            batchId: currentBatchId,
            stateHash: stateHash,
            processed: false
        });
        lastDecryptionRequestTime[tx.origin] = block.timestamp; // Cooldown for the user initiating the request

        emit ProofSearchInitiated(requestId, currentBatchId);
    }
}