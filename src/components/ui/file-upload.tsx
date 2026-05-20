"use client";

import * as React from "react";
import { Upload, File, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FileUploadProps {
  onUpload: (file: File) => void;
  accept?: string;
  maxSize?: number; // bytes, default 10MB
  className?: string;
  label?: string;
}

const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10MB

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileUpload({
  onUpload,
  accept,
  maxSize = DEFAULT_MAX_SIZE,
  className,
  label,
}: FileUploadProps) {
  const [dragActive, setDragActive] = React.useState(false);
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    setError(null);
    if (file.size > maxSize) {
      setError(`File too large. Maximum size is ${formatSize(maxSize)}.`);
      return;
    }
    setSelectedFile(file);
    onUpload(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const clearFile = () => {
    setSelectedFile(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className={cn("w-full", className)}>
      {label && (
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 transition-colors",
          dragActive
            ? "border-primary-400 bg-primary-50"
            : "border-gray-300 bg-gray-50 hover:border-gray-400"
        )}
      >
        <Upload className="mb-2 h-8 w-8 text-gray-400" />
        <p className="text-sm text-gray-600">
          <span className="font-medium text-primary-500">Click to upload</span> or drag and drop
        </p>
        <p className="mt-1 text-xs text-gray-400">
          {accept ? `Accepted: ${accept}` : "Any file type"} | Max {formatSize(maxSize)}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={handleChange}
          className="hidden"
        />
      </div>
      {selectedFile && (
        <div className="mt-2 flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2">
          <File className="h-4 w-4 text-gray-400" />
          <span className="flex-1 truncate text-sm text-gray-700">
            {selectedFile.name}
          </span>
          <span className="text-xs text-gray-400">{formatSize(selectedFile.size)}</span>
          <button onClick={clearFile} className="text-gray-400 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export { FileUpload };
