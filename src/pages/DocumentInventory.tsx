import React, { useState } from "react";

interface RequiredDoc {
  document: string;
  copies: string;
}

const DocumentInventory: React.FC<{
  sessionId: string | null;
  documents: { Id: string; DocumentName: string }[];
}> = ({ sessionId, documents }) => {
  const [loading, setLoading] = useState(false);
  const [requiredDocs, setRequiredDocs] = useState<RequiredDoc[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchInventory = async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);

    try {
      // 🔹 Call backend to analyze 46A
      const res = await fetch("http://localhost:3000/api/documents/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });

      const data = await res.json();

      if (data.error) {
        setError(data.error);
      } else {
        setRequiredDocs(data.required_documents || []);
      }
    } catch (err) {
      setError("Failed to load inventory");
    }
    setLoading(false);
  };

  // 🔹 Compute processed vs pending
  const processedNames = documents.map((d) => d.DocumentName.toLowerCase());
  const checklist = requiredDocs.map((req) => ({
    ...req,
    processed: processedNames.some((name) =>
      name.includes(req.document.toLowerCase())
    ),
  }));

  return (
    <div className="my-6">
      <button
        onClick={fetchInventory}
        className="px-4 py-2 bg-blue-600 text-white rounded shadow hover:bg-blue-700"
      >
        Show Document Inventory
      </button>

      {loading && <p className="mt-4 text-blue-600">Checking documents...</p>}
      {error && <p className="mt-4 text-red-600">{error}</p>}

      {!loading && !error && checklist.length > 0 && (
        <div className="mt-6 p-4 bg-white rounded shadow border">
          <h2 className="text-xl font-semibold mb-4 text-blue-800">
            Document Inventory
          </h2>
          <div className="grid grid-cols-2 gap-4">
            {checklist.map((doc, idx) => (
              <div
                key={idx}
                className={`p-3 rounded border ${
                  doc.processed
                    ? "bg-green-100 border-green-400"
                    : "bg-red-100 border-red-400"
                }`}
              >
                <input
                  type="checkbox"
                  checked={doc.processed}
                  readOnly
                  className="mr-2"
                />
                <span className="font-medium">{doc.document}</span>{" "}
                <span className="text-gray-600">({doc.copies})</span>
                <div className="text-sm">
                  {doc.processed ? "✅ Processed" : "❌ Pending"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default DocumentInventory;
