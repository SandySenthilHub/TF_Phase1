import React, { useEffect, useState } from 'react';

interface DocumentViewerProps {
  documentId: string;
  onClose: () => void;
}

const DocumentViewer: React.FC<DocumentViewerProps> = ({ documentId, onClose }) => {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    const fetchPdf = async () => {
      try {
        const response = await fetch(`http://localhost:3000/api/documents/${documentId}/pdf`);
        if (!response.ok) {
          throw new Error('Failed to fetch PDF');
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        setPdfUrl(url);
      } catch (error) {
        console.error('Error loading PDF:', error);
      }
    };

    fetchPdf();
  }, [documentId]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-white p-4 rounded shadow-lg max-w-4xl w-full h-[90%] relative">
        <button
          onClick={onClose}
          className="absolute top-2 right-2 text-white bg-red-600 px-3 py-1 rounded hover:bg-red-700"
        >
          Close
        </button>
        {pdfUrl ? (
          <iframe src={pdfUrl} title="PDF Viewer" className="w-full h-full border-none" />
        ) : (
          <p>Loading PDF...</p>
        )}
      </div>
    </div>
  );
};

export default DocumentViewer;
