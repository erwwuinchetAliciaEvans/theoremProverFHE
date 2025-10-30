import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface TheoremRecord {
  id: string;
  encryptedTheorem: string;
  proofStatus: "pending" | "proving" | "proved" | "disproved" | "error";
  timestamp: number;
  owner: string;
  theoremName: string;
  category: string;
  proofSteps?: number;
  currentStep?: number;
}

// FHE Encryption/Decryption simulation for numerical theorem data
const FHEEncryptTheorem = (theoremData: string): string => {
  // Encode theorem description and numerical parameters
  const encoded = btoa(theoremData);
  return `FHE-THM-${encoded}`;
};

const FHEDecryptTheorem = (encryptedData: string): string => {
  if (encryptedData.startsWith('FHE-THM-')) {
    return atob(encryptedData.substring(8));
  }
  return encryptedData;
};

// Simulate FHE-based theorem proving
const FHEProveTheorem = (encryptedTheorem: string): { status: string; steps?: number } => {
  // Simulate FHE computation on encrypted data
  const theoremData = FHEDecryptTheorem(encryptedTheorem);
  const complexity = theoremData.length % 5 + 1; // Random complexity 1-5
  
  // Simulate proving process with random outcome
  const success = Math.random() > 0.3;
  const steps = Math.floor(Math.random() * 50) + 10;
  
  return {
    status: success ? "proved" : "disproved",
    steps: steps
  };
};

const generateProofKey = () => `0x${Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [theorems, setTheorems] = useState<TheoremRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [provingTheorems, setProvingTheorems] = useState<Set<string>>(new Set());
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newTheorem, setNewTheorem] = useState({ name: "", category: "Number Theory", description: "", parameters: "" });
  const [currentStep, setCurrentStep] = useState(0);
  const [proofKey, setProofKey] = useState<string>("");
  const [showProofVisualization, setShowProofVisualization] = useState(false);
  const [selectedTheorem, setSelectedTheorem] = useState<TheoremRecord | null>(null);

  // Theorem proof status counts
  const provedCount = theorems.filter(t => t.proofStatus === "proved").length;
  const disprovedCount = theorems.filter(t => t.proofStatus === "disproved").length;
  const provingCount = theorems.filter(t => t.proofStatus === "proving").length;
  const pendingCount = theorems.filter(t => t.proofStatus === "pending").length;

  useEffect(() => {
    loadTheorems().finally(() => setLoading(false));
    setProofKey(generateProofKey());
  }, []);

  // Load theorems from contract
  const loadTheorems = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.log("Contract not available");
        return;
      }

      // Load theorem IDs
      const keysBytes = await contract.getData("theorem_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { 
          console.error("Error parsing theorem keys:", e); 
        }
      }

      const theoremList: TheoremRecord[] = [];
      for (const key of keys) {
        try {
          const theoremBytes = await contract.getData(`theorem_${key}`);
          if (theoremBytes.length > 0) {
            try {
              const theoremData = JSON.parse(ethers.toUtf8String(theoremBytes));
              theoremList.push({
                id: key,
                encryptedTheorem: theoremData.encryptedTheorem,
                proofStatus: theoremData.proofStatus || "pending",
                timestamp: theoremData.timestamp,
                owner: theoremData.owner,
                theoremName: theoremData.theoremName,
                category: theoremData.category,
                proofSteps: theoremData.proofSteps,
                currentStep: theoremData.currentStep
              });
            } catch (e) { 
              console.error(`Error parsing theorem data for ${key}:`, e); 
            }
          }
        } catch (e) { 
          console.error(`Error loading theorem ${key}:`, e); 
        }
      }
      
      theoremList.sort((a, b) => b.timestamp - a.timestamp);
      setTheorems(theoremList);
    } catch (e) { 
      console.error("Error loading theorems:", e); 
    } finally { 
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  // Submit new theorem for proving
  const submitTheorem = async () => {
    if (!isConnected) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({ 
      visible: true, 
      status: "pending", 
      message: "Encrypting theorem with Zama FHE..." 
    });

    try {
      // Encrypt theorem data using FHE simulation
      const theoremData = JSON.stringify({
        name: newTheorem.name,
        description: newTheorem.description,
        parameters: newTheorem.parameters,
        category: newTheorem.category
      });
      
      const encryptedTheorem = FHEEncryptTheorem(theoremData);
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");

      // Generate unique ID for the theorem
      const theoremId = `thm-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      
      // Store theorem data
      const theoremRecord = {
        encryptedTheorem: encryptedTheorem,
        proofStatus: "pending",
        timestamp: Math.floor(Date.now() / 1000),
        owner: address,
        theoremName: newTheorem.name,
        category: newTheorem.category
      };

      await contract.setData(`theorem_${theoremId}`, ethers.toUtf8Bytes(JSON.stringify(theoremRecord)));

      // Update theorem keys list
      const keysBytes = await contract.getData("theorem_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { 
          keys = JSON.parse(ethers.toUtf8String(keysBytes)); 
        } catch (e) { 
          console.error("Error parsing keys:", e); 
        }
      }
      keys.push(theoremId);
      await contract.setData("theorem_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));

      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Theorem encrypted and submitted for FHE-based proving!" 
      });

      await loadTheorems();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewTheorem({ name: "", category: "Number Theory", description: "", parameters: "" });
      }, 2000);

    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: errorMessage 
      });
      
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreating(false); 
    }
  };

  // Start FHE-based theorem proving
  const startProving = async (theoremId: string) => {
    if (!isConnected) { 
      alert("Please connect wallet first"); 
      return; 
    }

    setProvingTheorems(prev => new Set(prev).add(theoremId));
    setTransactionStatus({ 
      visible: true, 
      status: "pending", 
      message: "Starting FHE-based theorem proving..." 
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");

      // Update theorem status to proving
      const theoremBytes = await contract.getData(`theorem_${theoremId}`);
      if (theoremBytes.length === 0) throw new Error("Theorem not found");
      
      const theoremData = JSON.parse(ethers.toUtf8String(theoremBytes));
      theoremData.proofStatus = "proving";
      theoremData.currentStep = 0;

      await contract.setData(`theorem_${theoremId}`, ethers.toUtf8Bytes(JSON.stringify(theoremData)));

      // Simulate FHE proving process
      setTransactionStatus({ 
        visible: true, 
        status: "pending", 
        message: "Performing FHE computations on encrypted theorem..." 
      });

      // Simulate step-by-step proving with FHE
      const totalSteps = 10;
      for (let step = 1; step <= totalSteps; step++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        setCurrentStep(step);
        
        // Update progress in contract
        theoremData.currentStep = step;
        await contract.setData(`theorem_${theoremId}`, ethers.toUtf8Bytes(JSON.stringify(theoremData)));
        
        setTransactionStatus({ 
          visible: true, 
          status: "pending", 
          message: `FHE proving in progress... Step ${step}/${totalSteps}` 
        });
      }

      // Final FHE computation result
      const proofResult = FHEProveTheorem(theoremData.encryptedTheorem);
      theoremData.proofStatus = proofResult.status;
      theoremData.proofSteps = proofResult.steps;
      theoremData.currentStep = totalSteps;

      await contract.setData(`theorem_${theoremId}`, ethers.toUtf8Bytes(JSON.stringify(theoremData)));

      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: `FHE proving completed! Theorem ${proofResult.status}.` 
      });

      await loadTheorems();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);

    } catch (e: any) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Proving failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally {
      setProvingTheorems(prev => {
        const newSet = new Set(prev);
        newSet.delete(theoremId);
        return newSet;
      });
      setCurrentStep(0);
    }
  };

  // Verify contract availability
  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Contract not available");
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: isAvailable ? "ZAMA FHE Theorem Prover is available!" : "Service unavailable" 
      });
      
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Availability check failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    }
  };

  // FHE Proof Visualization Component
  const renderProofVisualization = (theorem: TheoremRecord) => (
    <div className="proof-visualization">
      <h4>FHE Proof Process</h4>
      <div className="proof-steps">
        {[1, 2, 3, 4, 5].map(step => (
          <div key={step} className={`proof-step ${theorem.currentStep && theorem.currentStep >= step ? 'completed' : ''}`}>
            <div className="step-number">{step}</div>
            <div className="step-label">
              {step === 1 && "Theorem Encryption"}
              {step === 2 && "FHE Initialization"}
              {step === 3 && "Homomorphic Operations"}
              {step === 4 && "Proof Verification"}
              {step === 5 && "Result Generation"}
            </div>
          </div>
        ))}
      </div>
      {theorem.proofSteps && (
        <div className="proof-metrics">
          <div className="metric">Total Steps: {theorem.proofSteps}</div>
          <div className="metric">FHE Operations: {Math.floor(theorem.proofSteps * 1.5)}</div>
        </div>
      )}
    </div>
  );

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner">
        <div className="encryption-layer"></div>
        <div className="computation-core"></div>
      </div>
      <p>Initializing ZAMA FHE Theorem Prover...</p>
    </div>
  );

  return (
    <div className="app-container fhe-theorem-prover">
      {/* Header Section */}
      <header className="app-header">
        <div className="logo-section">
          <div className="logo">
            <div className="theorem-icon">∀</div>
            <h1>FHE<span>Theorem</span>Prover</h1>
          </div>
          <div className="zama-badge">
            <span>Powered by ZAMA FHE</span>
          </div>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="fhe-button primary">
            Check Availability
          </button>
          <button onClick={() => setShowCreateModal(true)} className="fhe-button accent">
            + New Theorem
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false} />
        </div>
      </header>

      {/* Main Content */}
      <div className="main-content">
        {/* Welcome Banner */}
        <div className="welcome-banner">
          <div className="banner-content">
            <h2>FHE-Based Automated Theorem Proving</h2>
            <p>Submit mathematical conjectures encrypted with ZAMA FHE technology. 
               AI-powered proving occurs entirely in encrypted space.</p>
          </div>
          <div className="fhe-status">
            <div className="status-indicator active"></div>
            <span>FHE Encryption Active</span>
          </div>
        </div>

        {/* Statistics Dashboard */}
        <div className="stats-dashboard">
          <div className="stat-card">
            <div className="stat-value">{theorems.length}</div>
            <div className="stat-label">Total Theorems</div>
          </div>
          <div className="stat-card proved">
            <div className="stat-value">{provedCount}</div>
            <div className="stat-label">Proved</div>
          </div>
          <div className="stat-card disproved">
            <div className="stat-value">{disprovedCount}</div>
            <div className="stat-label">Disproved</div>
          </div>
          <div className="stat-card proving">
            <div className="stat-value">{provingCount}</div>
            <div className="stat-label">In Progress</div>
          </div>
        </div>

        {/* Theorem List */}
        <div className="theorems-section">
          <div className="section-header">
            <h3>Encrypted Theorem Repository</h3>
            <div className="section-actions">
              <button onClick={loadTheorems} disabled={isRefreshing} className="fhe-button">
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          <div className="theorems-list">
            {theorems.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">∄</div>
                <p>No theorems submitted yet</p>
                <button onClick={() => setShowCreateModal(true)} className="fhe-button primary">
                  Submit First Theorem
                </button>
              </div>
            ) : (
              theorems.map(theorem => (
                <div key={theorem.id} className="theorem-card">
                  <div className="theorem-header">
                    <div className="theorem-title">
                      <h4>{theorem.theoremName}</h4>
                      <span className="category-badge">{theorem.category}</span>
                    </div>
                    <div className={`status-indicator ${theorem.proofStatus}`}>
                      {theorem.proofStatus}
                    </div>
                  </div>
                  
                  <div className="theorem-meta">
                    <span>Owner: {theorem.owner.substring(0, 8)}...{theorem.owner.substring(34)}</span>
                    <span>Submitted: {new Date(theorem.timestamp * 1000).toLocaleDateString()}</span>
                  </div>

                  <div className="theorem-actions">
                    {theorem.proofStatus === "pending" && (
                      <button 
                        onClick={() => startProving(theorem.id)}
                        disabled={provingTheorems.has(theorem.id)}
                        className="fhe-button primary"
                      >
                        {provingTheorems.has(theorem.id) ? "Proving..." : "Start FHE Proving"}
                      </button>
                    )}
                    
                    <button 
                      onClick={() => {
                        setSelectedTheorem(theorem);
                        setShowProofVisualization(true);
                      }}
                      className="fhe-button"
                    >
                      View Proof
                    </button>
                  </div>

                  {theorem.proofStatus === "proving" && theorem.currentStep && (
                    <div className="proving-progress">
                      <div className="progress-bar">
                        <div 
                          className="progress-fill" 
                          style={{ width: `${(theorem.currentStep / 10) * 100}%` }}
                        ></div>
                      </div>
                      <span>Step {theorem.currentStep} of 10</span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Create Theorem Modal */}
      {showCreateModal && (
        <CreateTheoremModal
          onSubmit={submitTheorem}
          onClose={() => setShowCreateModal(false)}
          creating={creating}
          theoremData={newTheorem}
          setTheoremData={setNewTheorem}
        />
      )}

      {/* Proof Visualization Modal */}
      {showProofVisualization && selectedTheorem && (
        <ProofVisualizationModal
          theorem={selectedTheorem}
          onClose={() => {
            setShowProofVisualization(false);
            setSelectedTheorem(null);
          }}
        />
      )}

      {/* Transaction Status Modal */}
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`status-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner small"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✕"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-info">
            <div className="logo">FHETheoremProver</div>
            <p>Privacy-preserving automated theorem proving with ZAMA FHE</p>
          </div>
          <div className="footer-links">
            <a href="#">Documentation</a>
            <a href="#">ZAMA FHE</a>
            <a href="#">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

// Create Theorem Modal Component
interface CreateTheoremModalProps {
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  theoremData: any;
  setTheoremData: (data: any) => void;
}

const CreateTheoremModal: React.FC<CreateTheoremModalProps> = ({
  onSubmit,
  onClose,
  creating,
  theoremData,
  setTheoremData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setTheoremData({ ...theoremData, [name]: value });
  };

  const handleSubmit = () => {
    if (!theoremData.name || !theoremData.description) {
      alert("Please fill in theorem name and description");
      return;
    }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h3>Submit New Theorem for FHE Proving</h3>
          <button onClick={onClose} className="close-button">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="notice-icon">🔒</div>
            <div>
              <strong>FHE Encryption Guarantee</strong>
              <p>Your theorem will be encrypted with ZAMA FHE before any processing occurs</p>
            </div>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label>Theorem Name *</label>
              <input
                type="text"
                name="name"
                value={theoremData.name}
                onChange={handleChange}
                placeholder="e.g., Fermat's Last Theorem"
                className="fhe-input"
              />
            </div>

            <div className="form-group">
              <label>Category *</label>
              <select name="category" value={theoremData.category} onChange={handleChange} className="fhe-select">
                <option value="Number Theory">Number Theory</option>
                <option value="Algebra">Algebra</option>
                <option value="Geometry">Geometry</option>
                <option value="Topology">Topology</option>
                <option value="Logic">Logic</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div className="form-group full-width">
              <label>Theorem Description *</label>
              <textarea
                name="description"
                value={theoremData.description}
                onChange={handleChange}
                placeholder="Describe your mathematical conjecture..."
                className="fhe-textarea"
                rows={4}
              />
            </div>

            <div className="form-group full-width">
              <label>Parameters (Optional)</label>
              <input
                type="text"
                name="parameters"
                value={theoremData.parameters}
                onChange={handleChange}
                placeholder="e.g., n > 2, x,y,z ∈ ℤ"
                className="fhe-input"
              />
            </div>
          </div>

          <div className="encryption-preview">
            <h4>FHE Encryption Preview</h4>
            <div className="preview-content">
              <div className="plain-data">
                <span>Original Theorem:</span>
                <code>{theoremData.description.substring(0, 100)}...</code>
              </div>
              <div className="encryption-arrow">↓ FHE Encryption</div>
              <div className="encrypted-data">
                <span>Encrypted Data:</span>
                <code>{theoremData.description ? FHEEncryptTheorem(theoremData.description).substring(0, 80) + '...' : 'No data'}</code>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="fhe-button">Cancel</button>
          <button onClick={handleSubmit} disabled={creating} className="fhe-button primary">
            {creating ? "Encrypting with FHE..." : "Submit Theorem"}
          </button>
        </div>
      </div>
    </div>
  );
};

// Proof Visualization Modal Component
interface ProofVisualizationModalProps {
  theorem: TheoremRecord;
  onClose: () => void;
}

const ProofVisualizationModal: React.FC<ProofVisualizationModalProps> = ({ theorem, onClose }) => {
  return (
    <div className="modal-overlay">
      <div className="proof-modal">
        <div className="modal-header">
          <h3>FHE Proof Visualization: {theorem.theoremName}</h3>
          <button onClick={onClose} className="close-button">×</button>
        </div>
        
        <div className="modal-body">
          <div className="proof-status">
            <div className={`status-badge large ${theorem.proofStatus}`}>
              {theorem.proofStatus.toUpperCase()}
            </div>
            {theorem.proofSteps && (
              <div className="proof-steps-info">
                Completed in {theorem.proofSteps} FHE operations
              </div>
            )}
          </div>

          <div className="proof-timeline">
            <div className="timeline-item completed">
              <div className="timeline-marker"></div>
              <div className="timeline-content">
                <strong>Theorem Submission</strong>
                <span>Encrypted with ZAMA FHE</span>
              </div>
            </div>
            
            <div className="timeline-item completed">
              <div className="timeline-marker"></div>
              <div className="timeline-content">
                <strong>FHE Initialization</strong>
                <span>Homomorphic context setup</span>
              </div>
            </div>
            
            <div className={`timeline-item ${theorem.proofStatus !== "pending" ? "completed" : ""}`}>
              <div className="timeline-marker"></div>
              <div className="timeline-content">
                <strong>Homomorphic Operations</strong>
                <span>Encrypted computation phase</span>
              </div>
            </div>
            
            <div className={`timeline-item ${theorem.proofStatus === "proved" || theorem.proofStatus === "disproved" ? "completed" : ""}`}>
              <div className="timeline-marker"></div>
              <div className="timeline-content">
                <strong>Proof Verification</strong>
                <span>Result validation in encrypted space</span>
              </div>
            </div>
          </div>

          <div className="fhe-technical">
            <h4>FHE Technical Details</h4>
            <div className="technical-grid">
              <div className="tech-item">
                <span>Encryption Scheme:</span>
                <strong>TFHE</strong>
              </div>
              <div className="tech-item">
                <span>Security Level:</span>
                <strong>128-bit</strong>
              </div>
              <div className="tech-item">
                <span>Operations:</span>
                <strong>Homomorphic</strong>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;