import React from "react";

const OCRSelector = ({
  selectedEngine,
  onChange,
}: {
  selectedEngine: string;
  onChange: (value: string) => void;
}) => {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Select OCR Engine
      </label>
      <select
        value={selectedEngine}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full p-2 border border-gray-300 rounded shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
      >
        <option value="tesseract">Tesseract (Default)</option>
        <option value="opencv">OpenCV + Tesseract</option>
        <option value="easyocr">EasyOCR (Deep Learning)</option>
        <option value="azure">Azure OCR (Cloud API)</option>
      </select>
    </div>
  );
};

export default OCRSelector;
