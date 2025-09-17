// LifecycleManager.tsx
import React, { useEffect, useState } from "react";
import axios from "axios";

interface Lifecycle {
  ID: number;
  Code: string;
  Instrument: string;
  Transition: string;
  Applicable_Documents: string;
  SWIFT_Messages: string;
  Required_Documents: string | null;
}

const LifecycleManager: React.FC = () => {
  const [lifecycles, setLifecycles] = useState<Lifecycle[]>([]);
  const [selectedInstrument, setSelectedInstrument] = useState("");
  const [selectedLifecycle, setSelectedLifecycle] = useState<Lifecycle | null>(null);
  const [newDocName, setNewDocName] = useState("");
  const [requiredDocs, setRequiredDocs] = useState<string[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await axios.get("http://localhost:3000/api/documents/lifecycles");
        setLifecycles(
          res.data.map((lc: any, index: number) => ({
            ...lc,
            ID: lc.ID !== undefined && lc.ID !== null ? Number(lc.ID) : index + 1,
          }))
        );

      } catch (err) {
        console.error("Failed to fetch lifecycles:", err);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    setSelectedLifecycle(null);
    setRequiredDocs([]);
  }, [selectedInstrument]);

  const handleAddDoc = () => {
    const doc = newDocName.trim();
    if (doc && !requiredDocs.includes(doc)) {
      setRequiredDocs([...requiredDocs, doc]);
      setNewDocName("");
    }
  };

  const handleRemoveDoc = (doc: string) => {
    setRequiredDocs(requiredDocs.filter(d => d !== doc));
  };

  const handleSave = async () => {
    if (!selectedLifecycle) return alert("Please select a lifecycle first.");

    try {
      await axios.post(
        `http://localhost:3000/api/documents/lifecycles/${selectedLifecycle.ID}/add-documents`,
        { required_documents: requiredDocs }
      );
      alert("Documents updated successfully!");
    } catch (err) {
      console.error("Failed to update documents:", err);
      alert("Failed to update documents");
    }
  };

  const handleDeleteDoc = async (docName: string) => {
    if (!selectedLifecycle) return;

    if (!window.confirm(`Delete "${docName}" from this lifecycle?`)) return;

    try {
      await axios.delete(
        `http://localhost:3000/api/documents/lifecycles/${selectedLifecycle.ID}/delete-document`,
        { data: { document_name: docName } }
      );

      alert(`"${docName}" deleted successfully!`);
      setRequiredDocs(requiredDocs.filter(d => d !== docName));
    } catch (err) {
      console.error("Failed to delete document:", err);
      alert("Failed to delete document");
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6 text-slate-900">Lifecycle Document Manager</h1>

      {/* Instrument Selector */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-700 mb-1">Select Instrument:</label>
        <select
          className="border border-slate-300 px-3 py-2 rounded w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={selectedInstrument}
          onChange={(e) => setSelectedInstrument(e.target.value)}
        >
          <option value="">-- Choose Instrument --</option>
          {[...new Set(lifecycles.map(lc => lc.Instrument))].map(instr => (
            <option key={instr} value={instr}>{instr}</option>
          ))}
        </select>
      </div>

      {/* Lifecycle Selector */}
      {selectedInstrument && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-slate-700 mb-1">Select Lifecycle:</label>
          <select
            className="border border-slate-300 px-3 py-2 rounded w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={selectedLifecycle ? selectedLifecycle.ID.toString() : ""}
            onChange={(e) => {
              const id = Number(e.target.value);
              const lc = lifecycles.find(lc => lc.ID === id) || null;
              setSelectedLifecycle(lc);
              setRequiredDocs(lc?.Required_Documents?.split(",").map(d => d.trim()) || []);
              console.log("Selected Lifecycle ID:", id);
            }}
          >
            <option value="">-- Choose Lifecycle --</option>
            {lifecycles
              .filter(lc => lc.Instrument === selectedInstrument)
              .map(lc => (
                <option key={lc.ID} value={lc.ID}>{lc.Transition}</option>
              ))}
          </select>
        </div>
      )}

      {/* Required Documents */}
      {selectedLifecycle && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-slate-700 mb-2">Required Documents:</label>
          <div className="space-y-2">
            {requiredDocs.map((doc, idx) => (
              <div key={idx} className="flex items-center justify-between border rounded px-3 py-2 bg-slate-50">
                <span className="text-slate-900">{doc}</span>
                <button
                  className="text-red-500 hover:text-red-700"
                  onClick={() => handleRemoveDoc(doc)}
                >
                  Remove Locally
                </button>
                <button
                  className="text-red-500 hover:text-red-700"
                  onClick={() => handleDeleteDoc(doc)}
                >
                  Delete from Backend
                </button>
              </div>
            ))}

            <div className="flex items-center space-x-2 mt-2">
              <input
                type="text"
                className="border px-3 py-2 rounded flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="New document name"
                value={newDocName}
                onChange={(e) => setNewDocName(e.target.value)}
              />
              <button
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
                onClick={handleAddDoc}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedLifecycle && (
        <button
          className="bg-green-600 text-white px-6 py-3 rounded hover:bg-green-700"
          onClick={handleSave}
        >
          Save Documents
        </button>
      )}
    </div>
  );
};

export default LifecycleManager;
