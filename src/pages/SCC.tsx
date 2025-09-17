import React, { useEffect, useState } from "react";


interface Metadata {
    id: string;
    cifNumber: string;
    lcNumber: string;
    lifecycle: string;
    instrument: string;
}

interface DocumentData {
    Id: string;
    DocumentName: string;
}

interface FormData {
    formId: string;
    formName: string;
}

// Custom type for document selection
type DocSelection = {
    status: "full" | "partial" | "none";
    notes?: string;
};


const SubControlCenter: React.FC = () => {
    const [metadata, setMetadata] = useState<Metadata | null>(null);
    const [documents, setDocuments] = useState<DocumentData[]>([]);
    const [docForms, setDocForms] = useState<{ [docId: string]: FormData[] }>({});
    const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
    const [activeTabs, setActiveTabs] = useState<{ [formId: string]: "pdf" | "text" | "fields" }>({});
    const [formContent, setFormContent] = useState<{ [formId: string]: JSX.Element | null }>({});
    const [formTexts, setFormTexts] = useState<{ [formId: string]: string }>({}); // 👈 raw extracted text
    const [loading, setLoading] = useState(true);
    const [activeFormId, setActiveFormId] = useState<string | null>(null);

    const [showInventory, setShowInventory] = useState(false);
    const [inventoryDocs, setInventoryDocs] = useState<{ document_name: string; copies_required: number; raw_clause: string; processed: boolean }[]>([]);
    const [docSelections, setDocSelections] = useState<Record<string, DocSelection>>({});
    const [saveMsg, setSaveMsg] = useState<string | null>(null);
    const [selectedDocs, setSelectedDocs] = useState<Record<string, DocSelection>>({});

    const [inventoryMsg, setInventoryMsg] = useState<string | null>(null);
    const [inventoryLoading, setInventoryLoading] = useState(false);
    const [processedDocs, setProcessedDocs] = useState<string[]>([]);
    const [pendingDocs, setPendingDocs] = useState<string[]>([]);

    const sessionId = localStorage.getItem("sessionId");

    useEffect(() => {
        const fetchData = async () => {
            if (!sessionId) return;

            const metaRes = await fetch(`http://localhost:3000/api/documents/session/${sessionId}/meta`);
            const metaData = await metaRes.json();
            setMetadata(metaData);

            const docRes = await fetch(`http://localhost:3000/api/documents/session/${sessionId}`);
            const docsData = await docRes.json();
            setDocuments(docsData);

            setLoading(false);
        };
        fetchData();
    }, [sessionId]);

    useEffect(() => {
        if (expandedDoc && docForms[expandedDoc] && docForms[expandedDoc].length === 1) {
            const singleForm = docForms[expandedDoc][0];
            setActiveFormId(singleForm.formId);
            setActiveTabs((prev) => ({
                ...prev,
                [singleForm.formId]: prev[singleForm.formId] || "pdf",
            }));
        }
    }, [expandedDoc, docForms]);

    const toggleDoc = async (docId: string) => {
        if (expandedDoc === docId) {
            setExpandedDoc(null);
            setActiveFormId(null);
            return;
        }
        setExpandedDoc(docId);
        setActiveFormId(null);

        if (!docForms[docId]) {
            const res = await fetch(`http://localhost:3000/api/documents/forms/list/${docId}`);
            const data = await res.json();
            const normalizedForms: FormData[] = (data.forms || []).map((f: any) => ({
                formId: String(f.formId),
                formName: f.formName,
            }));
            setDocForms((prev) => ({ ...prev, [docId]: normalizedForms }));

            // Auto-load first form's text
            if (normalizedForms.length > 0) {
                const firstForm = normalizedForms[0];
                setActiveFormId(firstForm.formId);
                setActiveTabs((prev) => ({ ...prev, [firstForm.formId]: "text" }));
                loadFormContent(docId, firstForm.formId, "text");
            }
        }
    };


    const loadFormContent = async (docId: string, formId: string, type: "text" | "fields") => {
        const res = await fetch(
            `http://localhost:3000/api/documents/forms/${docId}?formId=${formId}&type=${type}`
        );
        if (!res.ok) return;
        const data = await res.json();

        if (type === "text") {
            setFormTexts((prev) => ({ ...prev, [formId]: data.text })); // 👈 save raw text
            setFormContent((prev) => ({
                ...prev,
                [formId]: (
                    <div className="p-3 bg-gray-50 border rounded whitespace-pre-wrap">
                        <pre>{data.text}</pre>
                    </div>
                ),
            }));
        } else {
            const renderFieldsGrid = (obj: any): JSX.Element => {
                if (!obj) return <></>;
                const rows: JSX.Element[] = [];

                const processObject = (o: any, prefix = "") => {
                    if (!o) return;
                    if (Array.isArray(o)) {
                        o.forEach((item) => processObject(item, prefix));
                    } else if (typeof o === "object") {
                        Object.entries(o).forEach(([key, value]) => {
                            const displayKey = prefix ? `${prefix}.${key}` : key;
                            if (value && typeof value === "object") {
                                processObject(value, displayKey);
                            } else {
                                rows.push(
                                    <div
                                        key={displayKey}
                                        className="flex flex-col bg-gray-50 p-2 border rounded shadow-sm"
                                        style={{ wordBreak: "break-all" }}
                                    >
                                        <span className="font-semibold text-blue-700">{displayKey}</span>
                                        <span className="text-gray-800">{String(value)}</span>
                                    </div>
                                );
                            }
                        });
                    }
                };

                processObject(obj);

                return <div className="grid grid-cols-2 md:grid-cols-3 gap-4">{rows}</div>;
            };

            setFormContent((prev) => ({
                ...prev,
                [formId]: <div className="p-3">{renderFieldsGrid(data)}</div>,
            }));
        }
    };

    const handleTabChange = (docId: string, formId: string, tab: "pdf" | "text" | "fields") => {
        setActiveTabs((prev) => ({ ...prev, [formId]: tab }));
        if (tab !== "pdf") {
            loadFormContent(docId, formId, tab);
        }
    };

    const handleInventory = async () => {
        if (!activeFormId || !formTexts[activeFormId]) {
            setInventoryMsg("Please open a form in TEXT view before checking inventory.");
            setShowInventory(true);
            return;
        }

        setInventoryLoading(true);
        try {
            const res = await fetch("http://localhost:3000/api/documents/inventory", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ extractedText: formTexts[activeFormId] }),
            });

            const data = await res.json();
            const docs: any[] = data.requiredDocuments?.documents || [];

            setInventoryDocs(docs); // 👈 store required docs

            const processed: string[] = [];
            const pending: string[] = [];

            docs.forEach((doc) => {
                if (doc.is_processed) {
                    processed.push(`${doc.document_name} (${doc.copies_required} copies)`);
                } else {
                    pending.push(`${doc.document_name} (${doc.copies_required} copies)`);
                }
            });

            setProcessedDocs(processed);
            setPendingDocs(pending);
            setInventoryMsg(null);
            setShowInventory(true);
        } catch (err) {
            console.error(err);
            setInventoryMsg("Failed to fetch inventory");
            setShowInventory(true);
        }
        setInventoryLoading(false);
    };


    const handleSelectionChange = (docName: string, status: "full" | "partial" | "none") => {
        setDocSelections((prev) => ({
            ...prev,
            [docName]: {
                status,
                // keep old notes if partial, clear otherwise
                notes: status === "partial" ? prev[docName]?.notes || "" : undefined,
            },
        }));
    };

    const handleNoteChange = (docName: string, value: string) => {
        setDocSelections((prev) => ({
            ...prev,
            [docName]: {
                ...prev[docName],
                notes: value,
            },
        }));
    };




    if (loading) return <p className="p-6 text-blue-600">Loading...</p>;

    return (
        <>
            <h1 className="text-3xl font-bold mb-6 text-blue-800" style={{ margin: "4% 4% 4% 2%" }}>
                Sub Control Center
            </h1>

            <div
                className="p-6 bg-gray-50 min-h-screen text-gray-900 flex flex-col "
                style={{ border: "1px solid lightgray", borderRadius: "8px", margin: "2%", width: "80%" }}
            >
                {metadata && (
                    <div className="bg-white shadow-md rounded-lg p-6 border mb-4">
                        <div className="text-xl font-semibold">
                            LC Number: <span className="ml-2">{metadata.lcNumber}</span>
                        </div>
                        <div className="text-xl">
                            Lifecycle:{" "}
                            <span className="ml-2">
                                {metadata.instrument} - {metadata.lifecycle}
                            </span>
                        </div>
                    </div>
                )}





                {/* Inventory Modal */}
                {showInventory && (
                    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50">
                        <div className="bg-white rounded-lg shadow-lg p-6 w-[600px] max-h-[80vh] overflow-auto">
                            <h2 className="text-xl font-semibold mb-4 text-blue-700">Document Inventory</h2>

                            {inventoryMsg ? (
                                <p className="text-red-600">{inventoryMsg}</p>
                            ) : (
                                <div className="flex flex-col gap-4">
                                    {/* ✅ Inventory content here */}
                                    {inventoryDocs.map((doc) => {
                                        const sel = docSelections[doc.document_name];

                                        return (
                                            <div key={doc.document_name} className="border p-2 rounded">
                                                <p className="font-semibold">
                                                    {doc.document_name}{" "}
                                                    <span className="text-sm text-gray-500">
                                                        ({doc.copies_required} copies required)
                                                    </span>
                                                </p>

                                                {/* Full / Partial / None radios */}
                                                <div className="flex gap-4 mt-2">
                                                    {["full", "partial", "none"].map((status) => (
                                                        <label key={status} className="flex items-center gap-1">
                                                            <input
                                                                type="radio"
                                                                name={`doc-${doc.document_name}`}
                                                                value={status}
                                                                checked={sel?.status === status}
                                                                onChange={() =>
                                                                    handleSelectionChange(doc.document_name, status as "full" | "partial" | "none")
                                                                }
                                                                className="w-4 h-4"
                                                            />
                                                            <span className="capitalize">{status}</span>
                                                        </label>
                                                    ))}
                                                </div>

                                                {/* ✅ Notes input only after a radio is chosen */}
                                                {sel?.status && (
                                                    <textarea
                                                        className="mt-2 w-full border rounded p-2"
                                                        placeholder="Enter notes..."
                                                        value={sel.notes || ""}
                                                        onChange={(e) => handleNoteChange(doc.document_name, e.target.value)}
                                                    />
                                                )}
                                            </div>
                                        );
                                    })}




                                    {/* Save & Close buttons */}
                                    <div className="flex justify-end gap-2">
                                        <button
                                            onClick={async () => {
                                                try {
                                                    const payload = Object.entries(docSelections).map(([name, sel]) => ({
                                                        document_name: name,
                                                        status: sel.status,
                                                        notes: sel.notes || null,
                                                    }));

                                                    console.log("🚀 Sending payload:", payload);

                                                    await fetch("http://localhost:3000/api/documents/save-selection", {
                                                        method: "POST",
                                                        headers: { "Content-Type": "application/json" },
                                                        body: JSON.stringify({
                                                            sessionId,
                                                            docId: expandedDoc,
                                                            documents: payload,
                                                        }),
                                                    });

                                                    setSaveMsg("Selection saved successfully!");
                                                } catch (err) {
                                                    console.error(err);
                                                    setSaveMsg("Failed to save selection.");
                                                }
                                            }}
                                            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                                        >
                                            Save Selection
                                        </button>


                                        <button
                                            onClick={() => setShowInventory(false)}
                                            className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                                        >
                                            Close
                                        </button>
                                    </div>

                                    {saveMsg && (
                                        <p className="text-sm text-blue-700 font-medium">{saveMsg}</p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}



                {/* Documents */}
                <div className="bg-white shadow-md rounded-lg p-6 border mb-4">
                    <div className="flex flex-wrap gap-4">
                        {documents.map((doc, index) => (
                            <div
                                key={doc.Id}
                                className={`w-64 cursor-pointer p-4 rounded shadow text-center ${expandedDoc === doc.Id ? "bg-blue-100" : "bg-white"
                                    } hover:bg-blue-50`}
                                onClick={() => toggleDoc(doc.Id)}
                            >
                                <p className="font-semibold text-blue-800">
                                    {index + 1}. {doc.DocumentName}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Forms under expanded document */}
                {expandedDoc && (
                    <div className="bg-white shadow-md rounded-lg p-6 border mb-8">
                        {docForms[expandedDoc] && docForms[expandedDoc].length > 1 && (
                            <div className="flex gap-4 flex-wrap">
                                {docForms[expandedDoc].map((form) => {
                                    const displayName = form.formName
                                        .split("_")
                                        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                                        .join(" ");

                                    return (
                                        <div
                                            key={form.formId}
                                            className={`cursor-pointer px-4 py-2 rounded border shadow 
                        ${activeFormId === form.formId
                                                    ? "bg-blue-100 text-blue-700 font-semibold"
                                                    : "bg-white text-gray-700"
                                                }`}
                                            onClick={() => {
                                                setActiveFormId(form.formId);
                                                setActiveTabs((prev) => ({ ...prev, [form.formId]: "pdf" }));
                                            }}
                                        >
                                            {displayName}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {activeFormId && (
                            <div
                                className="mt-6 p-4 border rounded bg-gray-50 shadow"
                                style={{ width: "50%" }}
                            >
                                <div className="flex gap-6 mb-4 border-b justify-around">
                                    {["pdf", "text", "fields"].map((tab) => (
                                        <div
                                            key={tab}
                                            onClick={() => handleTabChange(expandedDoc, activeFormId, tab as any)}
                                            className={`cursor-pointer pb-2 text-lg font-medium ${activeTabs[activeFormId] === tab
                                                ? "text-blue-600 border-b-2 border-blue-600"
                                                : "text-gray-600"
                                                }`}
                                        >
                                            {tab.toUpperCase()}
                                        </div>
                                    ))}
                                </div>

                                <div className="mb-4">
                                    <button
                                        onClick={handleInventory}
                                        className="px-4 py-2 bg-blue-600 text-white rounded shadow hover:bg-blue-700 flex items-center gap-2"
                                    >
                                        {inventoryLoading && (
                                            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                                        )}
                                        Document Inventory
                                    </button>
                                </div>

                                <div className="p-4 border rounded bg-white h-[400px] overflow-auto">
                                    {activeTabs[activeFormId] === "pdf" ? (
                                        (() => {
                                            const activeForm = docForms[expandedDoc]?.find(
                                                (f) => f.formId === activeFormId
                                            );
                                            const folderName = activeForm?.formName || activeFormId;
                                            const iframeSrc =
                                                docForms[expandedDoc]?.length === 1
                                                    ? `/outputs/${sessionId}/${expandedDoc}.pdf`
                                                    : `/grouped/${sessionId}/${expandedDoc}/${folderName}/document.pdf`;

                                            return (
                                                <iframe
                                                    src={iframeSrc}
                                                    title={`PDF Preview`}
                                                    width="100%"
                                                    height="100%"
                                                    className="border-0"
                                                />
                                            );
                                        })()
                                    ) : (
                                        formContent[activeFormId] || (
                                            <p className="text-gray-500">No content available</p>
                                        )
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </>
    );
};

export default SubControlCenter;
