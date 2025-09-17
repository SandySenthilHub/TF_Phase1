import React, { useState, useEffect, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { useNavigate } from 'react-router-dom';

import {
  Upload as UploadIcon,
  FileText,
  Image,
  X,
  Check,
  AlertCircle,
  Plus,
  FolderOpen,
  Clock,
  CheckCircle2,
  RefreshCw
} from 'lucide-react';
import { useSessionStore } from '../store/sessionStore';
import { useAuthStore } from '../store/authStore';

interface UploadedFile {
  file: File;
  id: string;
  status: 'pending' | 'uploading' | 'success' | 'error' | 'processing';
  progress: number;
  error?: string;
  documentId?: string;
  processingProgress?: {
    stage: string;
    progress: number;
    message: string;
    timestamp: string;
  };
}

interface Lifecycle {
  id: string;
  name: string;
  instrument: string;
  requiredDocuments: string[];
}

const Upload: React.FC = () => {
  const navigate = useNavigate();
  const [lifecycles, setLifecycles] = useState<Lifecycle[]>([]);
  const [selectedDocuments, setSelectedDocuments] = useState<{ [docName: string]: File | null }>({});

  const { sessions, loadSessions, createSession, uploadDocument, isLoading } = useSessionStore();
  const { user } = useAuthStore();
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [showCreateSession, setShowCreateSession] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  // Inside your Upload component
  const selectedSession = sessions.find(s => s.id === selectedSessionId);

  // At the top of your Upload component
  const [isNewLifecycle, setIsNewLifecycle] = useState(false);
  const [newLifecycleName, setNewLifecycleName] = useState("");
  const [newDocName, setNewDocName] = useState("");
  const [selectedDocumentsFallback, setSelectedDocumentsFallback] = useState({});

  const canUploadSelectedDocs = Object.values(selectedDocuments)
    .concat(Object.values(selectedDocumentsFallback))
    .some(f => f instanceof File);


  useEffect(() => {
    if (selectedSession) {
      const lifecycleExists = lifecycles.some(
        lc => `${lc.name} — ${lc.instrument}` === selectedSession.lifecycle
      );
      setIsNewLifecycle(!lifecycleExists);
    }
  }, [selectedSession, lifecycles]);


  const [newSession, setNewSession] = useState({
    cifNumber: '',
    cusName: '',
    cusCategory: '',
    lcNumber: '',
    instrument: '',
    lifecycle: ''
  });

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Poll for processing progress of uploaded files
  // useEffect(() => {
  //   const processingFiles = uploadedFiles.filter(f =>
  //     f.status === 'processing' && f.documentId
  //   );

  //   if (processingFiles.length === 0) return;

  //   const progressInterval = setInterval(async () => {
  //     for (const file of processingFiles) {
  //       try {
  //         const response = await fetch(`http://localhost:3000/api/documents/${file.documentId}/progress`, {
  //           headers: {
  //             'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
  //           }
  //         });

  //         if (response.ok) {
  //           const progress = await response.json();

  //           setUploadedFiles(prev => prev.map(f =>
  //             f.id === file.id
  //               ? {
  //                 ...f,
  //                 processingProgress: progress,
  //                 status: progress.stage === 'completed' ? 'success' :
  //                   progress.stage === 'error' ? 'error' : 'processing'
  //               }
  //               : f
  //           ));
  //         }
  //       } catch (error) {
  //         console.error('Error fetching progress for file:', file.id, error);
  //       }
  //     }
  //   }, 2000); // Poll every 2 seconds

  //   return () => clearInterval(progressInterval);
  // }, [uploadedFiles]);


  const [showAllSessions, setShowAllSessions] = useState(false);
  const activeSessions = sessions.filter(s => s.status !== 'completed' && s.status !== 'frozen');

  const filteredSessions = useMemo(() => {
    if (showAllSessions) return activeSessions;
    if (activeSessions.length === 0) return [];

    // default filter by lcNumber of the first session
    const defaultLc = activeSessions[0].lcNumber;
    return activeSessions.filter((s) => s.lcNumber === defaultLc);
  }, [activeSessions, showAllSessions]);

  useEffect(() => {
    const fetchLifecycles = async () => {
      try {
        const res = await fetch("http://localhost:3000/api/documents/lifecycles");
        if (!res.ok) throw new Error("Failed to fetch lifecycles");

        const data = await res.json();
        // console.log("✅ Raw lifecycles from API:", data); // 👈 log raw API response

        const instruments = data.map((item: any) => {
          const mapped = {
            id: item.ID,
            name: item.Instrument,
            instrument: item.Instrument,
            transition: item.Transition,
            fullLifecycle: `${item.Instrument} — ${item.Transition}`,
            requiredDocuments: item.Applicable_Documents
              ? item.Applicable_Documents.split(',').map((d: string) => d.trim())
              : []
          };
          // console.log("🔹 Mapped lifecycle:", mapped); // 👈 log each mapped object
          return mapped;
        });

        setLifecycles(instruments);
        // console.log("🟢 Lifecycles state set:", instruments); // 👈 final state
      } catch (error) {
        console.error("❌ Error fetching lifecycles:", error);
      }
    };

    fetchLifecycles();
  }, []);



  const uniqueInstruments = Array.from(
    new Set(lifecycles.map((item) => item.name))
  );

  const filteredLifecycles = lifecycles.filter(
    (item) => item.name === newSession.instrument
  );











  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png'],
      'application/pdf': ['.pdf']
    },
    maxSize: 10485760, // 10MB
    disabled: !selectedSessionId || isUploading,
    onDrop: (acceptedFiles) => {
      const newFiles: UploadedFile[] = acceptedFiles.map(file => ({
        file,
        id: Math.random().toString(36).substr(2, 9),
        status: 'pending',
        progress: 0
      }));
      setUploadedFiles(prev => [...prev, ...newFiles]);
    },
    onDropRejected: (rejectedFiles) => {
      rejectedFiles.forEach(rejection => {
        const error = rejection.errors[0]?.message || 'File rejected';
        console.error('File rejected:', rejection.file.name, error);
      });
    }
  });

  const handleIngestClick = () => {
      // alert("Please select a document first!");
      
  };  

  const handleCreateSession = async () => {
    // trim fields to prevent empty spaces being sent
    const payload = {
      cifNumber: newSession.cifNumber.trim(),
      cusName: newSession.cusName.trim(),
      cusCategory: newSession.cusCategory.trim(),
      lcNumber: newSession.lcNumber.trim(),
      instrument: newSession.instrument.trim(),
      lifecycle: newSession.lifecycle.trim()
    };

    if (!payload.cifNumber || !payload.cusName || !payload.cusCategory || !payload.lcNumber || !payload.instrument || !payload.lifecycle) {
      alert('Please fill all required fields');
      return;
    }

    try {
      const session = await createSession(payload);
      setSelectedSessionId(session.id);
      setShowCreateSession(false);
      setNewSession({ cifNumber: '', cusName: '', cusCategory: '', lcNumber: '', instrument: '', lifecycle: '' });
    } catch (error) {
      console.error('Error creating session:', error);
    }
  };


  const uploadFiles = async () => {
    if (!selectedSessionId || uploadedFiles.length === 0) return;

    setIsUploading(true);
    const pendingFiles = uploadedFiles.filter(f => f.status === 'pending');

    for (const uploadFile of pendingFiles) {
      try {
        setUploadedFiles(prev =>
          prev.map(f =>
            f.id === uploadFile.id
              ? { ...f, status: 'uploading', progress: 0 }
              : f
          )
        );

        const progressInterval = setInterval(() => {
          setUploadedFiles(prev =>
            prev.map(f =>
              f.id === uploadFile.id && f.progress < 90
                ? { ...f, progress: f.progress + 10 }
                : f
            )
          );
        }, 200);

        const result = await uploadDocument(selectedSessionId, uploadFile.file);

        clearInterval(progressInterval);
        setUploadedFiles(prev =>
          prev.map(f =>
            f.id === uploadFile.id
              ? {
                ...f,
                status: 'success',
                progress: 100,
                documentId: result?.id
              }
              : f
          )
        );
      } catch (error: any) {
        let errorMessage = 'Upload failed';
        if (error.response?.status === 409) {
          errorMessage = '❌ This document already exists. Please upload a different file.';
        } else if (error.message) {
          errorMessage = error.message;
        }

        setUploadedFiles(prev =>
          prev.map(f =>
            f.id === uploadFile.id
              ? {
                ...f,
                status: 'error',
                progress: 0,
                error: errorMessage
              }
              : f
          )
        );

        // Show UI message
        alert(errorMessage); // Or use toast.error(errorMessage)
      }
    }

    setIsUploading(false);
    navigate(`/sessions/${selectedSessionId}`);
  };



  const getFileIcon = (file: File) => {
    if (file.type.startsWith('image/')) {
      return <Image className="text-blue-500" size={24} />;
    }
    return <FileText className="text-red-500" size={24} />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'created': return 'bg-gray-100 text-gray-800';
      case 'uploading': return 'bg-blue-100 text-blue-800';
      case 'processing': return 'bg-yellow-100 text-yellow-800';
      case 'reviewing': return 'bg-purple-100 text-purple-800';
      case 'completed': return 'bg-green-100 text-green-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  const getFileStatusIcon = (uploadFile: UploadedFile) => {
    switch (uploadFile.status) {
      case 'pending':
        return <Clock className="text-slate-400" size={20} />;
      case 'uploading':
        return <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-600 border-t-transparent" />;
      case 'processing':
        return <RefreshCw className="animate-spin text-yellow-600" size={20} />;
      case 'success':
        return <Check className="text-green-500" size={20} />;
      case 'error':
        return <AlertCircle className="text-red-500" size={20} />;
      default:
        return null;
    }
  };

  const getProcessingMessage = (uploadFile: UploadedFile) => {
    if (uploadFile.status === 'processing' && uploadFile.processingProgress) {
      return uploadFile.processingProgress.message;
    }
    return null;
  };






  // Upload function
  const uploadSelectedDocuments = async () => {
    if (!selectedSessionId) return;

    setIsUploading(true);

    // Find the selected session
    const selectedSession = sessions.find(s => s.id === selectedSessionId);
    if (!selectedSession) {
      alert("Selected session not found.");
      setIsUploading(false);
      return;
    }

    // Determine if this is a new lifecycle
    const lifecycle = lifecycles.find(
      lc => lc.instrument === selectedSession.instrument &&
        selectedSession.lifecycle.includes(lc.transition)
    );
    const isNewLifecycle = !lifecycle;

    // Get docs to upload
    const docsToUpload = isNewLifecycle ? selectedDocumentsFallback : selectedDocuments;

    // Filter only actual files
    const validDocsToUpload: { [key: string]: File } = {};
    Object.entries(docsToUpload).forEach(([docName, file]) => {
      if (file instanceof File) {
        validDocsToUpload[docName] = file;
      }
    });

    if (Object.keys(validDocsToUpload).length === 0) {
      alert("Please select at least one file to upload.");
      setIsUploading(false);
      return;
    }

    let allSuccessful = true;

    for (const [docName, file] of Object.entries(validDocsToUpload)) {
      if (!file) continue;

      const tempFile: UploadedFile = {
        id: Math.random().toString(36).substr(2, 9),
        file,
        status: 'uploading',
        progress: 0,
      };

      setUploadedFiles(prev => [...prev, tempFile]);

      try {
        // Simulate progress
        let progress = 0;
        const interval = setInterval(() => {
          progress = Math.min(progress + 10, 90);
          setUploadedFiles(prev =>
            prev.map(f =>
              f.id === tempFile.id ? { ...f, progress } : f
            )
          );
        }, 200);

        // Determine lifecycle name
        const lifecycleName = isNewLifecycle
          ? newLifecycleName
          : lifecycle?.name || selectedSession.lifecycle || '';

        const result = await uploadDocument(
          selectedSessionId,
          file,
          docName,
          lifecycleName
        );

        clearInterval(interval);

        setUploadedFiles(prev =>
          prev.map(f =>
            f.id === tempFile.id
              ? { ...f, status: 'processing', progress: 100, documentId: result?.id }
              : f
          )
        );

        // Clear the file from state
        if (isNewLifecycle) {
          setSelectedDocumentsFallback(prev => ({ ...prev, [docName]: null }));
        } else {
          setSelectedDocuments(prev => ({ ...prev, [docName]: null }));
        }

      } catch (err: any) {
        allSuccessful = false;

        setUploadedFiles(prev =>
          prev.map(f =>
            f.id === tempFile.id
              ? { ...f, status: 'error', progress: 0, error: err.message || 'Upload failed' }
              : f
          )
        );

        alert(`Failed to upload ${docName}: ${err.message || 'Upload failed'}`);
      }
    }

    setIsUploading(false);

    if (allSuccessful) {
      navigate(`/sessions/${selectedSessionId}`);
    }
  };



  const canUpload = selectedSessionId && uploadedFiles.some(f => f.status === 'pending') && !isUploading;

  if (isLoading) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="animate-pulse space-y-8">
          <div className="text-center">
            <div className="h-10 bg-slate-200 rounded w-1/3 mx-auto mb-4"></div>
            <div className="h-6 bg-slate-200 rounded w-2/3 mx-auto"></div>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
            <div className="h-8 bg-slate-200 rounded w-1/4 mb-6"></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-32 bg-slate-200 rounded-xl"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-4xl font-bold text-slate-900 mb-4">Upload Documents</h1>
        <p className="text-lg text-slate-600 max-w-2xl mx-auto">
          Upload trade finance documents for processing. Select an existing session or create a new one to get started.
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mt-8">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-semibold text-slate-900">Create New Session</h3>

        </div>

        <div className="space-y-4">
          <div className="flex space-x-4">
            {/* CIF Number */}
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                CIF Number *
              </label>
              <input
                type="text"
                value={newSession.cifNumber}
                onChange={(e) =>
                  setNewSession((prev) => ({ ...prev, cifNumber: e.target.value }))
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter CIF number"
              />
            </div>

            {/* Customer Name */}
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Customer Name *
              </label>
              <input
                type="text"
                value={newSession.cusName}
                onChange={(e) =>
                  setNewSession((prev) => ({ ...prev, cusName: e.target.value }))
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter Customer Name"
              />
            </div>

            {/* Customer Category */}
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Customer Category *
              </label>
              <input
                type="text"
                value={newSession.cusCategory}
                onChange={(e) =>
                  setNewSession((prev) => ({ ...prev, cusCategory: e.target.value }))
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter Customer Category"
              />
            </div>
          </div>


          <div className="flex space-x-4">
            {/* LC Number */}
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                LC Number *
              </label>
              <input
                type="text"
                value={newSession.lcNumber}
                onChange={(e) =>
                  setNewSession((prev) => ({ ...prev, lcNumber: e.target.value }))
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter LC number"
              />
            </div>

            {/* Instrument Type */}
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Instrument Type *
              </label>
              <input
                list="instrument-options"
                value={newSession.instrument}
                onChange={(e) =>
                  setNewSession((prev) => ({
                    ...prev,
                    instrument: e.target.value,
                    lifecycle: "", // reset lifecycle when instrument changes
                  }))
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Select Instrument Type"
              />
              <datalist id="instrument-options">
                {uniqueInstruments.map((inst, index) => (
                  <option key={index} value={inst} />
                ))}
              </datalist>
            </div>
          </div>

          {/* Lifecycle */}
          {/* Lifecycle */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Lifecycle *
            </label>

            <input
              list="lifecycle-options"
              value={newSession.lifecycle}
              onChange={(e) =>
                setNewSession((prev) => ({
                  ...prev,
                  lifecycle: e.target.value,
                }))
              }
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Select or enter lifecycle"
            />

            <datalist id="lifecycle-options">
              {lifecycles
                .filter((item) => item.instrument === newSession.instrument) // match selected instrument
                .map((item) => (
                  <option key={item.id} value={item.transition} />
                ))}
            </datalist>
          </div>



        </div>

        <div className="flex space-x-3 mt-6">
          <button
            onClick={() => setShowCreateSession(false)}
            className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreateSession}
            disabled={!newSession.cifNumber || !newSession.cusName || !newSession.cusCategory || !newSession.lcNumber || !newSession.instrument || !newSession.lifecycle}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Create Session
          </button>
        </div>
      </div>

      {/* Session Selection */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold text-slate-900">Select Session</h2>

          {/* Active Sessions */}
          {activeSessions.length > 0 && (
            <div className="flex justify-end mb-4">
              <button
                onClick={() => setShowAllSessions((prev) => !prev)}
                className="px-4 py-2 text-sm rounded-lg border border-slate-300 bg-white hover:bg-slate-50 transition-colors"
              >
                {showAllSessions ? "View Same LC Sessions" : "View All Sessions"}
              </button>
            </div>
          )}
        </div>


        {/* Active Sessions */}
        {filteredSessions.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredSessions.map((session) => (
              <div
                key={session.id}
                onClick={() => !isUploading && setSelectedSessionId(session.id)}
                className={`p-4 rounded-xl border-2 transition-all hover:shadow-md ${isUploading
                  ? "cursor-not-allowed opacity-50"
                  : "cursor-pointer"
                  } ${selectedSessionId === session.id
                    ? "border-blue-500 bg-blue-50"
                    : "border-slate-200 hover:border-slate-300"
                  }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="font-semibold text-slate-900">
                      {session.lcNumber}
                    </h3>
                    <p className="text-sm text-slate-600">CIF: {session.cifNumber}</p>
                    <p className="text-xs text-slate-500 mt-1">Instrument: {session.instrument}</p>
                    <p className="text-xs text-slate-500 mt-1">Lifecycle: {session.lifecycle}</p>
                  </div>
                  {selectedSessionId === session.id && (
                    <CheckCircle2 className="text-blue-500" size={20} />
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span
                    className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(
                      session.status
                    )}`}
                  >
                    {session.status}
                  </span>
                  <span className="text-xs text-slate-500">
                    {session.documents?.length || 0} docs
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <FolderOpen className="mx-auto text-slate-400 mb-4" size={48} />
            <h3 className="text-lg font-medium text-slate-900 mb-2">
              No Active Sessions
            </h3>
            <p className="text-slate-600 mb-4">
              Create a new session to start uploading documents
            </p>
            <button
              onClick={() => setShowCreateSession(true)}
              disabled={isUploading}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create First Session
            </button>
          </div>
        )}

        {/* Selected Session */}
        {/* Selected Session */}
        {selectedSessionId && (() => {
          const selectedSession = sessions.find(s => s.id === selectedSessionId);
          if (!selectedSession) return null;

          // Match lifecycle by instrument + transition substring
          const lifecycle = lifecycles.find(
            lc => lc.instrument === selectedSession.instrument &&
              selectedSession.lifecycle.includes(lc.transition)
          );

          const isNewLifecycle = !lifecycle;

          // Check if at least one file is selected
          const hasFilesSelected =
            Object.values(selectedDocuments).some(f => f) ||
            Object.values(selectedDocumentsFallback).some(f => f);

          return (
            <div className="mt-6 p-6 border border-slate-200 rounded-2xl bg-slate-50">
              <h3 className="text-xl font-semibold text-slate-900 mb-4">
                {isNewLifecycle
                  ? "Upload Documents for New Lifecycle"
                  : `Required Documents for ${lifecycle?.name}`}
              </h3>

              {/* NEW lifecycle */}
              {isNewLifecycle ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    placeholder="Enter new lifecycle name"
                    value={newLifecycleName}
                    onChange={(e) => setNewLifecycleName(e.target.value)}
                    className="border px-2 py-1 rounded w-full mb-2"
                  />

                  {/* Add new documents dynamically */}
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2 mb-2">
                      <input
                        type="text"
                        placeholder="Enter document name"
                        value={newDocName}
                        onChange={(e) => setNewDocName(e.target.value)}
                        className="border px-2 py-1 rounded w-full"
                      />
                      <button
                        onClick={() => {
                          if (newDocName.trim() && !selectedDocumentsFallback[newDocName.trim()]) {
                            setSelectedDocumentsFallback(prev => ({
                              ...prev,
                              [newDocName.trim()]: null,
                            }));
                            setNewDocName("");
                          }
                        }}
                        className="bg-blue-600 text-white px-4 py-1 rounded"
                      >
                        Add
                      </button>
                    </div>

                    {Object.keys(selectedDocumentsFallback).map(doc => (
                      <div key={doc} className="flex items-center space-x-3">
                        <label className="flex-1 text-sm text-slate-700">{doc}</label>
                        <input
                          type="file"
                          onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                              setSelectedDocumentsFallback(prev => ({
                                ...prev,
                                [doc]: e.target.files[0],
                              }));
                            }
                          }}
                        />
                        {selectedDocumentsFallback[doc] && (
                          <span className="text-green-600 text-xs ml-2">File selected</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                // EXISTING lifecycle
                <div className="space-y-3">
                  {/* Predefined docs */}
                  {lifecycle?.requiredDocuments.map(doc => (
                    <div key={doc} className="flex items-center space-x-3">
                      <label className="text-sm text-slate-700 flex-1">{doc}</label>
                      <input
                        type="file"
                        onChange={(e) => {
                          const file = e.target.files?.[0] || null;
                          setSelectedDocuments(prev => ({ ...prev, [doc]: file }));
                        }}
                      />
                      {selectedDocuments[doc] && (
                        <span className="text-green-600 text-xs ml-2">File selected</span>
                      )}
                    </div>
                  ))}

                  {/* Extra docs section */}
                  <div className="mt-4 space-y-2 border-t pt-3">
                    <h4 className="text-sm font-medium text-slate-800">Additional Documents</h4>
                    <div className="flex items-center space-x-2 mb-2">
                      <input
                        type="text"
                        placeholder="Enter additional document name"
                        value={newDocName}
                        onChange={(e) => setNewDocName(e.target.value)}
                        className="border px-2 py-1 rounded w-full"
                      />
                      <button
                        onClick={() => {
                          if (newDocName.trim() && !selectedDocuments[newDocName.trim()]) {
                            setSelectedDocuments(prev => ({
                              ...prev,
                              [newDocName.trim()]: null,
                            }));
                            setNewDocName("");
                          }
                        }}
                        className="bg-blue-600 text-white px-4 py-1 rounded"
                      >
                        Add
                      </button>
                    </div>

                    {Object.keys(selectedDocuments)
                      .filter(doc => !lifecycle?.requiredDocuments.includes(doc)) // only show extra ones
                      .map(doc => (
                        <div key={doc} className="flex items-center space-x-3">
                          <label className="text-sm text-slate-700 flex-1">{doc}</label>
                          <input
                            type="file"
                            onChange={(e) => {
                              const file = e.target.files?.[0] || null;
                              setSelectedDocuments(prev => ({ ...prev, [doc]: file }));
                            }}
                          />
                          {selectedDocuments[doc] && (
                            <span className="text-green-600 text-xs ml-2">File selected</span>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              )}

              <button
                onClick={handleIngestClick}
                className="bg-blue-600 text-white px-4 py-1 rounded mt-5"
              >
                Ingest Document
              </button>


              {/* Upload button */}
              {hasFilesSelected && (
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={uploadSelectedDocuments}
                    disabled={isUploading}
                    className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition-colors flex items-center space-x-2"
                  >
                    <UploadIcon size={20} />
                    <span>
                      {Object.values(selectedDocuments).filter(f => f).length +
                        Object.values(selectedDocumentsFallback).filter(f => f).length > 1
                        ? 'Upload All'
                        : 'Upload'}
                    </span>
                  </button>
                </div>
              )}
            </div>
          );
        })()}

      </div>










    </div>
  );
};

export default Upload;