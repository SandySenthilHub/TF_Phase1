import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  FileText,
  Eye,
  Edit,
  Trash2,
  RefreshCw,
  Check,
  X,
  AlertTriangle,
  Save,
  Lock,
  Unlock,
  Upload,
  Download,
  Settings,
  Layers,
  Play,
  CheckCircle
} from 'lucide-react';
import { useSessionStore } from '../store/sessionStore';
import { useDocumentStore } from '../store/documentStore';
import DocumentViewer from '../components/Documents/DocumentViewer';
import FieldExtractor from '../components/Documents/FieldExtractor';
import DocumentComparator from '../components/Documents/DocumentComparator';


const SessionDetail: React.FC = () => {

  const { sessionId: paramSessionId, documentId: paramDocumentId } = useParams<{ sessionId: string; documentId: string }>();

  const [documentId, setDocumentId] = useState(localStorage.getItem("documentId") || "");
  const [sessionId, setSessionId] = useState(paramSessionId || localStorage.getItem("sessionId") || "");
  const navigate = useNavigate();
  const { currentSession, setCurrentSession, updateSessionStatus } = useSessionStore();
  const {
    documents,
    loadDocuments,
    processDocument,
    validateDocument,
    extractFields,
    compareDocument,
    deleteDocument,
    isLoading
  } = useDocumentStore();

  const [activeTab, setActiveTab] = useState<'documents' | 'splitted' | 'grouped' | 'catalog' | 'final'>('documents');
  const [selectedDocument, setSelectedDocument] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [sessionFrozen, setSessionFrozen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [processingSteps, setProcessingSteps] = useState<Record<string, string>>({});
  const [splittingDocId, setSplittingDocId] = useState<string | null>(null);
  const [activeSplitDocId, setActiveSplitDocId] = useState<string | null>(null);
  const [splitResults, setSplitResults] = useState<any[]>([]);

  const [activeFieldDoc, setActiveFieldDoc] = useState<string | null>(null);
  const [fieldData, setFieldData] = useState<Record<string, string> | null>(null);
  const [fieldLoading, setFieldLoading] = useState(false);
  const [groupedDocs, setGroupedDocs] = useState([]);

  const [groupedResults, setGroupedResults] = useState<any[]>([]);
  const [groupedLoading, setGroupedLoading] = useState(false);


  const [catalogedResults, setCatalogedResults] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const [showViewer, setShowViewer] = useState(false);


  useEffect(() => {
    if (sessionId) {
      loadDocuments(sessionId);
    }
  }, [sessionId, loadDocuments]);


  const handleProcessDocument = async (documentId: string) => {
    setIsProcessing(true);
    setProcessingSteps(prev => ({ ...prev, [documentId]: 'processing' }));

    try {
      await processDocument(documentId);
      setProcessingSteps(prev => ({ ...prev, [documentId]: 'processed' }));
      await updateSessionStatus(sessionId!, 'processing');
    } catch (error) {
      console.error('Error processing document:', error);
      setProcessingSteps(prev => ({ ...prev, [documentId]: 'error' }));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleValidateDocument = async (documentId: string, isValid: boolean) => {
    try {
      setProcessingSteps(prev => ({ ...prev, [documentId]: 'validating' }));

      if (isValid) {
        // Mark as validated and automatically extract fields
        await validateDocument(documentId, true);
        setProcessingSteps(prev => ({ ...prev, [documentId]: 'validated' }));

        // Automatically start field extraction
        setTimeout(async () => {
          try {
            setProcessingSteps(prev => ({ ...prev, [documentId]: 'extracting-fields' }));
            await extractFields(documentId);
            setProcessingSteps(prev => ({ ...prev, [documentId]: 'fields-extracted' }));

            // Check if all documents are processed and move to next tab
            const allDocumentsProcessed = documents.every(doc =>
              doc.id === documentId || doc.status === 'validated' || doc.extractedFields?.length > 0
            );

            if (allDocumentsProcessed) {
              setActiveTab('fields');
              await updateSessionStatus(sessionId!, 'reviewing');
            }
          } catch (error) {
            console.error('Error extracting fields:', error);
            setProcessingSteps(prev => ({ ...prev, [documentId]: 'field-extraction-error' }));
          }
        }, 1000);
      } else {
        // Reprocess document
        setProcessingSteps(prev => ({ ...prev, [documentId]: 'reprocessing' }));
        await handleProcessDocument(documentId);
      }
    } catch (error) {
      console.error('Error validating document:', error);
      setProcessingSteps(prev => ({ ...prev, [documentId]: 'validation-error' }));
    }
  };

  const handleDeleteDocument = async (documentId: string) => {
    try {
      await deleteDocument(documentId);
      setShowDeleteConfirm(null);
      // Reload documents to update the list
      await loadDocuments(sessionId!);
    } catch (error) {
      console.error('Error deleting document:', error);
    }
  };

  const handleFreezeSession = async () => {
    try {
      await updateSessionStatus(sessionId!, 'frozen');
      setSessionFrozen(true);
    } catch (error) {
      console.error('Error freezing session:', error);
    }
  };

  const handleSaveSession = async () => {
    try {
      await updateSessionStatus(sessionId!, 'completed');
      // Trigger final storage process
      navigate('/sessions');
    } catch (error) {
      console.error('Error saving session:', error);
    }
  };

  const handleProcessAllDocuments = async () => {
    setIsProcessing(true);
    const unprocessedDocs = documents.filter(doc => doc.status === 'uploaded');

    for (const doc of unprocessedDocs) {
      await handleProcessDocument(doc.id);
    }

    setIsProcessing(false);
  };

  const handleValidateAllDocuments = async () => {
    const processedDocs = documents.filter(doc => doc.status === 'processed');

    for (const doc of processedDocs) {
      await handleValidateDocument(doc.id, true);
    }
  };

  const handleCompareAllDocuments = async () => {
    setIsProcessing(true);
    const docsWithFields = documents.filter(doc => doc.extractedFields?.length > 0);

    for (const doc of docsWithFields) {
      try {
        await compareDocument(doc.id);
      } catch (error) {
        console.error('Error comparing document:', error);
      }
    }

    setIsProcessing(false);
    setActiveTab('catalog');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'uploaded': return 'bg-blue-100 text-blue-800';
      case 'processing': return 'bg-yellow-100 text-yellow-800';
      case 'processed': return 'bg-green-100 text-green-800';
      case 'validated': return 'bg-emerald-100 text-emerald-800';
      case 'error': return 'bg-red-100 text-red-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  const getProcessingStepColor = (step: string) => {
    switch (step) {
      case 'processing': return 'bg-yellow-100 text-yellow-800';
      case 'processed': return 'bg-green-100 text-green-800';
      case 'validating': return 'bg-blue-100 text-blue-800';
      case 'validated': return 'bg-emerald-100 text-emerald-800';
      case 'extracting-fields': return 'bg-purple-100 text-purple-800';
      case 'fields-extracted': return 'bg-green-100 text-green-800';
      case 'error': return 'bg-red-100 text-red-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  const getProgressPercentage = () => {
    if (documents.length === 0) return 0;

    const uploadedCount = documents.length;
    const processedCount = documents.filter(d => d.status === 'processed' || d.status === 'validated').length;
    const validatedCount = documents.filter(d => d.status === 'validated').length;
    const fieldsExtractedCount = documents.filter(d => d.extractedFields?.length > 0).length;

    if (currentSession?.status === 'completed') return 100;
    if (fieldsExtractedCount === documents.length && fieldsExtractedCount > 0) return 85;
    if (validatedCount === documents.length && validatedCount > 0) return 70;
    if (processedCount === documents.length && processedCount > 0) return 50;
    if (uploadedCount > 0) return 25;

    return 10;
  };


  const runSplitDocument = async (documentId: string) => {
    try {
      setSplittingDocId(documentId);

      const docRes = await fetch(`http://localhost:3000/api/documents/${documentId}/pdf-info`);
      const docData = await docRes.json();

      if (!docRes.ok || !docData?.filePath || !docData?.sessionId) {
        alert("❌ Failed to fetch document path or session ID");
        return;
      }

      // 🔹 Step 1: Split the document
      const splitRes = await fetch(`http://localhost:3000/api/documents/split/${docData.sessionId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filePath: docData.filePath,
          documentId: documentId,
          ocrMethod: ocrMethod,
        }),
      });

      const splitData = await splitRes.json();
      console.log("📦 Split response:", splitData);

      if (splitRes.ok) {
        alert(`✅ Split Success: ${splitData.message}`);
        setActiveSplitDocId(documentId);
        setSplitResults(splitData.files || []);
        localStorage.setItem("documentId", documentId);

        // 🕒 Delay to ensure split results are saved
        setTimeout(() => {
          fetchSplitResultsForDoc(docData.sessionId);
        }, 1500);

        // 🔹 Step 2: Grouping
        const groupRes = await fetch(
          `http://localhost:3000/api/documents/group/${docData.sessionId}/${documentId}`,
          { method: "POST" }
        );

        const groupData = await groupRes.json();
        console.log("🧩 Grouping response:", groupData);

        if (groupRes.ok) {
          alert("✅ Grouping completed successfully.");

          // 🔹 Step 3: Cataloging
          const catalogRes = await fetch(`http://localhost:3000/api/documents/catalog`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              session_id: docData.sessionId,
              document_id: documentId,
            }),
          });

          const catalogData = await catalogRes.json();
          console.log("📚 Cataloging response:", catalogData);

          if (catalogRes.ok) {
            alert("📚 Cataloging completed.");
          } else {
            alert("⚠️ Cataloging failed: " + catalogData?.error);
          }
        } else {
          alert(`⚠️ Grouping failed: ${groupData.error}`);
        }
      } else {
        alert(`❌ Split Failed: ${splitData.error}`);
      }
    } catch (err) {
      alert("❌ Error splitting document: " + err.message);
    } finally {
      setSplittingDocId(null);
    }
  };





  function getGroupedDocuments(sessionId: string, documentId: string) {
    console.log("📡 Fetching grouped documents with:");
    console.log("   Session ID:", sessionId);
    console.log("   Document ID:", documentId);

    const basePath = `http://localhost:3000/grouped/${sessionId}/${documentId}`;

    return fetch(`http://localhost:3000/api/documents/grouped-files/${sessionId}/${documentId}`)
      .then(res => res.json())
      .then(async (data) => {
        const formNames = data.forms || [];
        console.log("📄 Found grouped forms:", formNames);

        const docs = await Promise.all(
          formNames.map((formName) => {
            const pdfUrl = `${basePath}/${formName}/document.pdf`;
            const textUrl = `${basePath}/${formName}/text.txt`;
            // const fieldsUrl = `${basePath}/${formName}/fields.json`; // Uncomment if needed

            return Promise.all([
              fetch(pdfUrl),
              fetch(textUrl),
              // fetch(fieldsUrl),
            ])
              .then(async ([pdfRes, textRes]) => {
                const pdfOk = pdfRes.ok;
                const text = textRes.ok ? await textRes.text() : "";
                // const fields = fieldsRes.ok ? await fieldsRes.json() : {};

                return {
                  formName,
                  pdfUrl: pdfOk ? pdfUrl : null,
                  ocrText: text,
                  // fieldsJson: fields,
                };
              })
              .catch((err) => {
                console.error(`❌ Error fetching grouped document ${formName}`, err);
                return null;
              });
          })
        );

        return docs.filter(Boolean);
      })
      .catch((err) => {
        console.error("❌ Failed to load form names:", err);
        return [];
      });
  }





  useEffect(() => {
    if (sessionId && documentId) {
      getGroupedDocuments(sessionId, documentId).then((docs) => {
        setGroupedDocs(docs);
      });
    }
  }, [sessionId, documentId]);


  useEffect(() => {
    if (sessionId && documentId) {
      console.log("🚀 Calling getGroupedDocuments()");
      getGroupedDocuments(sessionId, documentId).then((docs) => {
        console.log("📦 Grouped docs loaded:", docs);
        setGroupedDocs(docs);
      });
    } else {
      console.warn("❌ sessionId or documentId is missing:");
      console.log("   sessionId:", sessionId);
      console.log("   documentId:", documentId);
    }
  }, [sessionId, documentId]);



  const [splittedDocs, setSplittedDocs] = useState([]);
  const [ocrMethod, setOcrMethod] = useState("azure");

  useEffect(() => {
    if (paramSessionId) {
      setSessionId(paramSessionId);
      localStorage.setItem("sessionId", paramSessionId);
    }
  }, [paramSessionId]);

  useEffect(() => {
    if (paramDocumentId) {
      setDocumentId(paramDocumentId);
      localStorage.setItem("sessionId", paramDocumentId);
    }
  }, [paramDocumentId]);



  useEffect(() => {
    const fetchSplittedDocs = async () => {
      try {
        const id = sessionId || localStorage.getItem("sessionId"); // fallback
        if (!id) {
          console.warn("⚠️ No sessionId available to fetch split docs");
          return;
        }

        const res = await fetch(`http://localhost:3000/api/documents/split/session/${id}`);
        const data = await res.json();

        // console.log("✅ Split docs fetched:", data); // DEBUG LOG
        setSplittedDocs(data.results || []);
      } catch (err) {
        console.error('❌ Failed to load split docs:', err);
      }
    };

    fetchSplittedDocs();
  }, [sessionId]);


  const fetchSplitResultsForDoc = async (docId: string) => {
    try {
      setActiveSplitDocId(docId);

      const sessionId = localStorage.getItem("sessionId");
      if (!sessionId) {
        alert("❌ No session ID found.");
        return;
      }

      const res = await fetch(`http://localhost:3000/api/documents/split/session/${sessionId}`);
      const data = await res.json();

      if (res.ok && data.results?.length > 0) {
        const matchedResult = data.results.find(d =>
          d.files?.some(f => f.pdfPath.includes(docId))
        );

        if (matchedResult) {
          setSplitResults(matchedResult.files || []);
        } else {
          alert("⚠️ No split results available for this document.");
          setSplitResults([]);
        }
      } else {
        alert(`❌ No split data found for session.`);
        setSplitResults([]);
      }
    } catch (err: any) {
      console.error("❌ Error fetching split results:", err);
      alert("❌ Error: " + err.message);
      setSplitResults([]);
    }
  };

  async function fetchGroupedResultsForDoc(sessionId: string, documentId: string) {
    if (!sessionId || !documentId) return;

    setGroupedLoading(true);
    setGroupedResults([]);

    try {
      const res = await fetch(`http://localhost:3000/api/documents/grouped-files/${sessionId}/${documentId}`);
      const data = await res.json();
      const formNames = data.forms || [];

      const basePath = `http://localhost:3000/grouped/${sessionId}/${documentId}`;

      const docs = await Promise.all(
        formNames.map(async (formName) => {
          const pdfUrl = `${basePath}/${formName}/document.pdf`;
          const textUrl = `${basePath}/${formName}/text.txt`;

          const [pdfRes, textRes] = await Promise.all([fetch(pdfUrl), fetch(textUrl)]);
          const pdfOk = pdfRes.ok;
          const text = textRes.ok ? await textRes.text() : "";

          return {
            formName,
            pdfUrl: pdfOk ? pdfUrl : null,
            ocrText: text
          };
        })
      );

      setGroupedResults(docs.filter(Boolean));
    } catch (err) {
      console.error("❌ Failed to fetch grouped documents:", err);
    } finally {
      setGroupedLoading(false);
    }
  }

  useEffect(() => {
    if (sessionId && activeSplitDocId) {
      fetchGroupedResultsForDoc(sessionId, activeSplitDocId);
    }
  }, [activeSplitDocId, sessionId]);


  useEffect(() => {
    if (activeTab === 'catalog' && sessionId && documentId) {
      setCatalogLoading(true);
      fetch(`http://localhost:3000/api/documents/cataloged-documents/${sessionId}/${documentId}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            setCatalogedResults(data.data);
          }
        })
        .catch((err) => console.error("Catalog fetch error:", err))
        .finally(() => setCatalogLoading(false));
    }
  }, [activeTab, sessionId, documentId]);






  const handleFieldTabClick = async (fileName: string) => {
    setActiveFieldDoc(fileName);
    setFieldLoading(true);
    setFieldData(null);

    try {
      const res = await fetch(`http://localhost:3000/api/documents/${sessionId}/${fileName}/fields`);
      const data = await res.json();
      setFieldData(data.fields || {});
    } catch (err) {
      console.error("Field extraction failed", err);
      setFieldData(null);
    } finally {
      setFieldLoading(false);
    }
  };

  useEffect(() => {
    if (splitResults.length > 0 && !activeFieldDoc) {
      const firstFileName = splitResults[0].fileName;
      handleFieldTabClick(firstFileName);
    }
  }, [splitResults]);

  const [ocrEngine, setOcrEngine] = useState("tesseract");

  type OCRSelectorProps = {
    selectedEngine: string;
    onChange: (value: string) => void;
  };

  const OCRSelector: React.FC<OCRSelectorProps> = ({ selectedEngine, onChange }) => {
    return (
      <div className="mb-4 mt-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-white mb-1">
          Select OCR Engine
        </label>
        <select
          value={selectedEngine}
          onChange={(e) => onChange(e.target.value)}
          className="w-full md:w-56 p-2 border border-gray-300 rounded shadow-sm text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-white"
        >
          <option value="azure">Azure Document Intelligence (default)</option>
          <option value="tesseract">Tesseract OCR</option>
          <option value="openai">Azure OpenAI Vision (GPT-4o)</option>
        </select>
      </div>
    );
  };





  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-200 rounded w-1/4"></div>
          <div className="h-64 bg-slate-200 rounded"></div>
        </div>
      </div>
    );
  }

  const progressPercentage = getProgressPercentage();

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate('/sessions')}
            className="p-2 text-slate-600 hover:text-slate-900 transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-3xl font-bold text-slate-900">
              Session: {currentSession?.lcNumber}
            </h1>
            <p className="text-slate-600">
              CIF: {currentSession?.cifNumber} | Lifecycle: {currentSession?.lifecycle}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {!sessionFrozen && currentSession?.status !== 'completed' && (
            <>
              <button
                onClick={handleFreezeSession}
                className="bg-yellow-600 text-white px-4 py-2 rounded-lg hover:bg-yellow-700 transition-colors flex items-center space-x-2"
              >
                <Lock size={20} />
                <span>Freeze Session</span>
              </button>
              <button
                onClick={handleSaveSession}
                className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors flex items-center space-x-2"
              >
                <Save size={20} />
                <span>Save & Complete</span>
              </button>
            </>
          )}
          {sessionFrozen && (
            <div className="flex items-center space-x-2 text-yellow-600">
              <Lock size={20} />
              <span className="font-medium">Session Frozen</span>
            </div>
          )}
        </div>
      </div>

      {/* Enhanced Progress Steps */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold text-slate-900">Processing Progress</h3>
            <span className="text-sm font-medium text-slate-600">{progressPercentage}% Complete</span>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-3">
            <div
              className="bg-gradient-to-r from-blue-500 to-green-500 h-3 rounded-full transition-all duration-500"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          {[
            { step: 1, label: 'Upload', status: documents.length > 0 ? 'completed' : 'pending', count: documents.length },
            { step: 2, label: 'OCR Process', status: documents.some(d => d.status === 'processed' || d.status === 'validated') ? 'completed' : 'pending', count: documents.filter(d => d.status === 'processed' || d.status === 'validated').length },
            { step: 3, label: 'Validate', status: documents.some(d => d.status === 'validated') ? 'completed' : 'pending', count: documents.filter(d => d.status === 'validated').length },
            { step: 4, label: 'Extract Fields', status: documents.some(d => d.extractedFields?.length > 0) ? 'completed' : 'pending', count: documents.filter(d => d.extractedFields?.length > 0).length },
            { step: 5, label: 'Compare & Catalog', status: 'pending', count: 0 },
            { step: 6, label: 'Review', status: 'pending', count: 0 },
            { step: 7, label: 'Final Storage', status: currentSession?.status === 'completed' ? 'completed' : 'pending', count: currentSession?.status === 'completed' ? 1 : 0 }
          ].map((item, index) => (
            <div key={item.step} className="flex items-center">
              <div className="text-center">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-sm font-medium mb-2 ${item.status === 'completed'
                  ? 'bg-green-500 text-white'
                  : 'bg-slate-200 text-slate-600'
                  }`}>
                  {item.status === 'completed' ? <Check size={16} /> : item.step}
                </div>
                <span className="text-sm font-medium text-slate-700">{item.label}</span>
                <div className="text-xs text-slate-500 mt-1">
                  {item.count > 0 && `${item.count}/${documents.length}`}
                </div>
              </div>
              {index < 6 && (
                <div className={`w-16 h-0.5 mx-2 ${item.status === 'completed' ? 'bg-green-500' : 'bg-slate-200'
                  }`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Quick Actions</h3>
        <OCRSelector selectedEngine={ocrMethod} onChange={setOcrMethod} />

        <div className="flex flex-wrap gap-3">
          {documents.some(d => d.status === 'uploaded') && (
            <button
              onClick={handleProcessAllDocuments}
              disabled={isProcessing}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2 disabled:opacity-50"
            >
              <Play size={16} />
              <span>Process All Documents</span>
            </button>
          )}

          {documents.some(d => d.status === 'processed') && (
            <button
              onClick={handleValidateAllDocuments}
              disabled={isProcessing}
              className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors flex items-center space-x-2 disabled:opacity-50"
            >
              <CheckCircle size={16} />
              <span>Validate All Documents</span>
            </button>
          )}

          {documents.some(d => d.extractedFields?.length > 0) && (
            <button
              onClick={handleCompareAllDocuments}
              disabled={isProcessing}
              className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors flex items-center space-x-2 disabled:opacity-50"
            >
              <Settings size={16} />
              <span>Compare All Documents</span>
            </button>
          )}
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200">
        <div className="border-b border-slate-200">
          <nav className="flex space-x-8 px-6">
            {[
              { id: 'documents', label: 'Documents', icon: FileText, count: documents.length },
              { id: 'splitted', label: 'Splitted Docs', icon: Layers },  // ✅ NEW

              { id: 'grouped', label: 'Grouped Docs', icon: Settings },
              { id: 'catalog', label: 'Cataloged Docs', icon: Eye, count: 0 },
              { id: 'final', label: 'Final Review', icon: Check, count: 0 }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center space-x-2 py-4 border-b-2 transition-colors ${activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
              >
                <tab.icon size={20} />
                <span className="font-medium">{tab.label}</span>
                {tab.count > 0 && (
                  <span className="bg-slate-100 text-slate-600 text-xs px-2 py-1 rounded-full">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'documents' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-slate-900">
                  Documents ({documents.length})
                </h2>
                <button
                  onClick={() => navigate('/upload')}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2"
                >
                  <Upload size={20} />
                  <span>Upload More</span>
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {documents.map((document) => (
                  <div key={document.Id} className="bg-slate-50 rounded-lg p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <h3 className="font-medium text-slate-900">{document.FileName}</h3>
                        <p className="text-sm text-slate-600">
                          {document.FileSize ? `${(document.FileSize / 1024).toFixed(2)} KB` : '0 KB'}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          Uploaded:{' '}
                          {new Date(document.UploadedAt).toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata',
                            hour12: true,
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </p>
                      </div>

                      <div className="flex flex-col items-end space-y-1">
                        <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(document.status)}`}>
                          {document.status}
                        </span>
                        {processingSteps[document.Id] && (
                          <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getProcessingStepColor(processingSteps[document.Id])}`}>
                            {processingSteps[document.Id].replace('-', ' ')}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* ✅ Preview Image or PDF */}
                    {document.FileType?.startsWith('image/') ? (
                      <img
                        src={document.FilePath || `/uploads/${document.FileName}`}
                        alt={document.FileName}
                        className="mt-3 w-full h-auto max-h-64 rounded-lg border border-slate-200 object-contain cursor-pointer"
                        onClick={() => window.open(document.FilePath || `/uploads/${document.FileName}`, '_blank')}
                      />
                    ) : document.FileType?.includes('pdf') ? (
                      <div className="mt-3 cursor-pointer" onClick={() => window.open(document.FilePath || `/uploads/${document.FileName}`, '_blank')}>
                        <embed
                          src={document.FilePath || `/uploads/${document.FileName}`}
                          type="application/pdf"
                          className="w-full h-64 rounded-lg border border-slate-200"
                        />
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 italic mt-2">No preview available</p>
                    )}

                    {/* ✅ Action buttons */}
                    <div className="flex items-center space-x-2 mt-4">
                      <button
                        onClick={() => runSplitDocument(document.Id)}
                        className={`flex-1 bg-blue-600 text-white px-3 py-2 rounded text-sm transition-colors flex items-center justify-center space-x-1
                           ${splittingDocId === document.Id ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-700'}`}
                        disabled={splittingDocId === document.Id}
                      >
                        {splittingDocId === document.Id ? (
                          <>
                            <RefreshCw className="animate-spin" size={16} />
                            <span>Processing...</span>
                          </>
                        ) : (
                          <span>Start Process</span>
                        )}
                      </button>

                      {document.status === 'uploaded' && (
                        <button
                          onClick={() => handleProcessDocument(document.Id)}
                          disabled={isProcessing}
                          className="flex-1 bg-green-600 text-white px-3 py-2 rounded text-sm hover:bg-green-700 transition-colors flex items-center justify-center space-x-1 disabled:opacity-50"
                        >
                          <RefreshCw size={16} className={isProcessing ? 'animate-spin' : ''} />
                          <span>Process</span>
                        </button>
                      )}

                      {document.status === 'processed' && (
                        <div className="flex space-x-1">
                          <button
                            onClick={() => handleValidateDocument(document.Id, true)}
                            className="bg-green-600 text-white px-3 py-2 rounded text-sm hover:bg-green-700 transition-colors"
                            title="Validate & Extract Fields"
                          >
                            <Check size={16} />
                          </button>
                          <button
                            onClick={() => handleValidateDocument(document.Id, false)}
                            className="bg-red-600 text-white px-3 py-2 rounded text-sm hover:bg-red-700 transition-colors"
                            title="Reject & Reprocess"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      )}

                      {currentSession?.status !== 'frozen' && currentSession?.status !== 'completed' && (
                        <button
                          onClick={() => setShowDeleteConfirm(document.Id)}
                          className="bg-red-600 text-white px-3 py-2 rounded text-sm hover:bg-red-700 transition-colors"
                          title="Delete Document"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>

                    {/* ✅ Metadata sections */}
                    {document.extractedFields?.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-200">
                        <p className="text-xs text-slate-500">
                          Fields extracted: {document.extractedFields.length}
                        </p>
                      </div>
                    )}

                    {document.iterations?.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-200">
                        <p className="text-xs text-slate-500">
                          Iterations: {document.iterations.length}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>

            </div>
          )}



          {activeTab === 'splitted' && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-slate-900">Splitted Documents</h2>

              {/* Dropdown for selecting a document */}
              <select
                onChange={(e) => fetchSplitResultsForDoc(e.target.value)}
                value={activeSplitDocId || ''}
                className="border border-slate-300 rounded px-2 py-1 text-sm mb-4"
              >
                <option value="">-- Select a Document --</option>
                {documents.map(doc => (
                  <option key={doc.Id} value={doc.Id}>
                    {doc.FileName}
                  </option>
                ))}
              </select>

              {/* Grid of split results */}
              {activeSplitDocId && splitResults.length > 0 ? (
                <div className="grid grid-cols-1 gap-8">
                  {splitResults.map((file, index) => (
                    <div key={index} className="bg-white rounded-lg shadow p-4 space-y-4 border border-slate-200">
                      <h3 className="text-slate-800 font-medium text-sm truncate">{file.fileName}</h3>

                      {/* Grid layout: PDF on left, text on right */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* PDF Preview */}
                        <iframe
                          src={`http://localhost:3000${file.pdfPath}`}
                          title={`PDF Preview ${file.fileName}`}
                          className="w-full h-64 border rounded"
                        ></iframe>

                        {/* Extracted Text */}
                        <div className="bg-gray-50 border rounded p-3 overflow-y-auto h-64 text-xs font-mono whitespace-pre-wrap">
                          <strong className="block text-gray-700 mb-2">Extracted Text</strong>
                          <iframe
                            src={`http://localhost:3000${file.textPath}`}
                            className="w-full h-full bg-white"
                          ></iframe>
                        </div>
                      </div>

                      {/* Fields Preview */}
                      <div className="bg-gray-100 p-3 rounded text-sm text-gray-800 max-h-64 overflow-y-auto border border-gray-200">
                        <strong className="block mb-2">Extracted Fields</strong>
                        {fieldLoading ? (
                          <p>Loading fields...</p>
                        ) : activeFieldDoc === file.fileName && fieldData && Object.keys(fieldData).length > 0 ? (
                          <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                            {Object.entries(fieldData).map(([key, value]) => (
                              <li key={key}><strong>{key}:</strong> {String(value)}</li>
                            ))}
                          </ul>
                        ) : (
                          <p>No fields found for this page.</p>
                        )}
                      </div>

                      {/* Auto trigger field fetch */}
                      {activeFieldDoc !== file.fileName && (
                        <button
                          onClick={() => handleFieldTabClick(file.fileName)}
                          className="text-blue-600 text-sm underline"
                        >
                          Load Fields
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-slate-500 text-sm">
                  {activeSplitDocId
                    ? 'No split results available for this document.'
                    : 'Select a document to view its split results.'}
                </div>
              )}
            </div>
          )}


          {activeTab === 'grouped' && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-slate-900">Grouped Documents</h2>

              {groupedLoading ? (
                <p>Loading grouped documents...</p>
              ) : groupedResults.length > 0 ? (
                <div className="grid grid-cols-1 gap-8">
                  {groupedResults.map((doc, index) => (
                    <div key={index} className="bg-white rounded-lg shadow p-4 space-y-4 border border-slate-200">
                      <h3 className="text-slate-800 font-medium text-sm truncate">{doc.formName}</h3>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* PDF Preview */}
                        <iframe
                          src={doc.pdfUrl}
                          title={`PDF Preview ${doc.formName}`}
                          className="w-full h-64 border rounded"
                        ></iframe>

                        {/* OCR Text */}
                        <div className="bg-gray-50 border rounded p-3 overflow-y-auto h-64 text-xs font-mono whitespace-pre-wrap">
                          <strong className="block text-gray-700 mb-2">Extracted Text</strong>
                          {doc.ocrText}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-slate-500 text-sm">
                  {activeSplitDocId
                    ? 'No grouped results available for this document.'
                    : 'Select a document in "Splitted" tab to view grouped results.'}
                </div>
              )}
            </div>
          )}



         

          {activeTab === 'catalog' && (
  <div className="space-y-6">
    <h2 className="text-xl font-semibold text-slate-900">Cataloged Documents</h2>

    {catalogLoading ? (
      <p>Loading cataloged documents...</p>
    ) : catalogedResults.length > 0 ? (
      <div className="overflow-x-auto">
        <table className="min-w-full bg-white border border-slate-200 text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="py-2 px-4 border-b text-left">Grouped Form</th>
              <th className="py-2 px-4 border-b text-left">Matched Document</th>
              <th className="py-2 px-4 border-b text-left">Confidence</th>
              <th className="py-2 px-4 border-b text-left">Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {catalogedResults
              .filter(entry => entry.document_id === activeSplitDocId)
              .map((entry, idx) => (
                <tr key={idx} className="hover:bg-slate-50">
                  <td className="py-2 px-4 border-b">{entry.grouped_form_type || '-'}</td>
                  <td className="py-2 px-4 border-b">{entry.matched_document_name || '-'}</td>
                  <td className="py-2 px-4 border-b">
                    {entry.confidence_score === 0
                      ? '0'
                      : (parseFloat(entry.confidence_score).toFixed(2))}
                  </td>
                  <td className="py-2 px-4 border-b">
                    {new Date(entry.cataloged_at).toLocaleString()}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    ) : (
      <div className="text-slate-500 text-sm">
        {activeSplitDocId
          ? 'No cataloged results available for this document.'
          : 'Select a document in "Splitted" tab to view cataloged results.'}
      </div>
    )}
  </div>
)}





          {activeTab === 'final' && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-slate-900">Final Review</h2>
              <div className="bg-slate-50 rounded-lg p-6">
                <div className="text-center">
                  <AlertTriangle className="mx-auto text-yellow-500 mb-4" size={48} />
                  <h3 className="text-lg font-medium text-slate-900 mb-2">
                    Ready for Final Storage
                  </h3>
                  <p className="text-slate-600 mb-6">
                    Review all documents and extracted data before saving to the master record.
                  </p>
                  <div className="flex justify-center space-x-4">
                    <button
                      onClick={handleFreezeSession}
                      className="bg-yellow-600 text-white px-6 py-3 rounded-lg hover:bg-yellow-700 transition-colors flex items-center space-x-2"
                    >
                      <Lock size={20} />
                      <span>Freeze Session</span>
                    </button>
                    <button
                      onClick={handleSaveSession}
                      className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition-colors flex items-center space-x-2"
                    >
                      <Save size={20} />
                      <span>Save to Master Record</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Document Viewer Modal */}
      {showViewer && selectedDocument && (
        <DocumentViewer
          documentId={selectedDocument}
          onClose={() => {
            setSelectedDocument(null);
            setShowViewer(false);
          }}
        />
      )}
      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-center space-x-3 mb-4">
              <div className="bg-red-100 p-2 rounded-lg">
                <AlertTriangle className="text-red-600" size={24} />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Delete Document</h3>
                <p className="text-sm text-slate-600">This action cannot be undone</p>
              </div>
            </div>

            <p className="text-slate-700 mb-6">
              Are you sure you want to delete this document? The file will be permanently removed from the system.
            </p>

            <div className="flex space-x-3">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteDocument(showDeleteConfirm)}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SessionDetail;