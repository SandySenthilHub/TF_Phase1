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

interface InventoryItem {
    name: string;
    instruction: string;
}

const SubControlCenter: React.FC = () => {
    const [metadata, setMetadata] = useState<Metadata | null>(null);
    const [documents, setDocuments] = useState<DocumentData[]>([]);
    const [docForms, setDocForms] = useState<{ [docId: string]: FormData[] }>({});
    const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
    const [activeTabs, setActiveTabs] = useState<{ [formId: string]: "pdf" | "text" | "fields" }>({});
    const [formContent, setFormContent] = useState<{ [formId: string]: JSX.Element | null }>({});
    const [loading, setLoading] = useState(true);
    const [activeFormId, setActiveFormId] = useState<string | null>(null);

    const [showInventory, setShowInventory] = useState(false);
    const [inventoryData, setInventoryData] = useState<{
        requiredDocs: InventoryItem[];
        processedDocs: string[];
    }>({
        requiredDocs: [],
        processedDocs: [],
    });

    const [inventoryMsg, setInventoryMsg] = useState<string | null>(null);

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
        }
    };

    const loadFormContent = async (docId: string, formId: string, type: "text" | "fields") => {
        const res = await fetch(
            `http://localhost:3000/api/documents/forms/${docId}?formId=${formId}&type=${type}`
        );
        if (!res.ok) return;
        const data = await res.json();

        if (type === "text") {
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
        if (tab !== "pdf") loadFormContent(docId, formId, tab);
    };

    const buildInventory = async () => {
        setShowInventory(true);
        setInventoryMsg(null);

        let lcDoc: DocumentData | null = null;
        let lcText = "";

        lcDoc = documents.find((doc) => doc.DocumentName.toLowerCase().includes("lc")) || null;

        if (!lcDoc) {
            for (const doc of documents) {
                try {
                    const res = await fetch(
                        `http://localhost:3000/api/documents/forms/${doc.Id}?formId=&type=text`
                    );
                    if (!res.ok) continue;
                    const data = await res.json();
                    const text: string = data.text || "";
                    if (/letter of credit|documentary credit|lc number|46A/i.test(text)) {
                        lcDoc = doc;
                        lcText = text;
                        break;
                    }
                } catch (err) {
                    console.error("Error checking doc text:", err);
                }
            }
        }

        if (!lcDoc) {
            setInventoryMsg("⚠️ No LC document (with 46A) found.");
            return;
        }

        if (!lcText) {
            const res = await fetch(
                `http://localhost:3000/api/documents/forms/${lcDoc.Id}?formId=&type=text`
            );
            if (!res.ok) {
                setInventoryMsg("⚠️ Could not fetch LC text.");
                return;
            }
            const data = await res.json();
            lcText = data.text || "";
        }

        const match = lcText.match(/46A\s*[:\-]?\s*([\s\S]*?)(?=\n\d{2}[A-Z])/i);
        if (!match) {
            setInventoryMsg("⚠️ 46A section not found in LC document.");
            return;
        }

        let section = match[1];

        // Split into clauses (1., 2., 3.) and extract first few words as document name
        const rawDocs = section
            .split(/\n?\d+\.\s/)
            .map((d) => d.trim())
            .filter((d) => d.length > 0);

        const inventoryItems: InventoryItem[] = rawDocs.map((clause) => {
            const firstWords = clause.split(",")[0].split(" ").slice(0, 4).join(" "); // first 3–4 words as name
            return { name: firstWords, instruction: clause };
        });

        const processedDocs = documents.map((d) => d.DocumentName.toLowerCase());

        setInventoryData({ requiredDocs: inventoryItems, processedDocs });
    };

    if (loading) return <p className="p-6 text-blue-600">Loading...</p>;

    return (
        <>
            <h1 className="text-3xl font-bold mb-6 text-blue-800" style={{ margin: "4% 4% 4% 2%" }}>
                Sub Control Center
            </h1>

            <div
                className="p-6 bg-gray-50 min-h-screen text-gray-900 flex flex-col"
                style={{ border: "1px solid lightgray", borderRadius: "8px", margin: "2%", width: "80%" }}
            >
                {metadata && (
                    <div className="bg-white shadow-md rounded-lg p-6 border mb-4">
                        <div className="text-xl font-semibold">
                            LC Number: <span className="ml-2">{metadata.lcNumber}</span>
                        </div>
                        <div className="text-xl">
                            Lifecycle: <span className="ml-2">{metadata.instrument} - {metadata.lifecycle}</span>
                        </div>
                    </div>
                )}

                {/* Button to show inventory */}
                <div className="mb-4">
                    <button
                        onClick={buildInventory}
                        className="px-4 py-2 bg-blue-600 text-white rounded shadow hover:bg-blue-700"
                    >
                        Document Inventory
                    </button>
                </div>

                {/* Inventory Modal */}
                {showInventory && (
                    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50">
                        <div className="bg-white rounded-lg shadow-lg p-6 w-[600px] max-h-[80vh] overflow-auto">
                            <h2 className="text-xl font-semibold mb-4 text-blue-700">Document Inventory</h2>
                            {!inventoryMsg && (
                                <div className="space-y-3">
                                    {inventoryData.requiredDocs.map((doc, idx) => {
                                        const processed = inventoryData.processedDocs.some((d) =>
                                            d.includes(doc.name.toLowerCase())
                                        );

                                        return (
                                            <div
                                                key={idx}
                                                className={`p-3 border rounded ${
                                                    processed ? "bg-green-50 border-green-300" : "bg-yellow-50 border-yellow-300"
                                                }`}
                                            >
                                                <div className="flex items-start gap-2">
                                                    <input type="checkbox" checked={processed} readOnly />
                                                    <div>
                                                        <span className="font-semibold">{doc.name}</span>
                                                        <p className="text-gray-700">{doc.instruction}</p>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            {inventoryMsg && <p className="text-red-600">{inventoryMsg}</p>}
                            <div className="mt-6 text-right">
                                <button
                                    onClick={() => setShowInventory(false)}
                                    className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Documents */}
                <div className="bg-white shadow-md rounded-lg p-6 border mb-4">
                    <div className="flex flex-wrap gap-4">
                        {documents.map((doc, index) => (
                            <div
                                key={doc.Id}
                                className={`w-64 cursor-pointer p-4 rounded shadow text-center ${expandedDoc === doc.Id ? "bg-blue-100" : "bg-white"} hover:bg-blue-50`}
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
                                            className={`cursor-pointer px-4 py-2 rounded border shadow ${activeFormId === form.formId ? "bg-blue-100 text-blue-700 font-semibold" : "bg-white text-gray-700"}`}
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
                            <div className="mt-6 p-4 border rounded bg-gray-50 shadow" style={{ width: "50%" }}>
                                <div className="flex gap-6 mb-4 border-b justify-around">
                                    {["pdf", "text", "fields"].map((tab) => (
                                        <div
                                            key={tab}
                                            onClick={() => handleTabChange(expandedDoc, activeFormId, tab as any)}
                                            className={`cursor-pointer pb-2 text-lg font-medium ${activeTabs[activeFormId] === tab ? "text-blue-600 border-b-2 border-blue-600" : "text-gray-600"}`}
                                        >
                                            {tab.toUpperCase()}
                                        </div>
                                    ))}
                                </div>

                                <div className="p-4 border rounded bg-white h-[400px] overflow-auto">
                                    {activeTabs[activeFormId] === "pdf" ? (
                                        (() => {
                                            const activeForm = docForms[expandedDoc]?.find(f => f.formId === activeFormId);
                                            const folderName = activeForm?.formName || activeFormId;
                                            const iframeSrc = docForms[expandedDoc]?.length === 1
                                                ? `/outputs/${sessionId}/${expandedDoc}.pdf`
                                                : `/grouped/${sessionId}/${expandedDoc}/${folderName}/document.pdf`;

                                            return <iframe src={iframeSrc} title="PDF Preview" width="100%" height="100%" className="border-0" />;
                                        })()
                                    ) : (
                                        formContent[activeFormId] || <p className="text-gray-500">No content available</p>
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
