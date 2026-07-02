/* eslint-disable */
import React, { useState, useEffect, useRef } from 'react';
import { Database, Search, Plus, Trash2, Edit2, FileText, RefreshCw } from 'lucide-react';
import apiClient from '../api/client';

interface Document {
  id: string;
  name: string;
  size: string;
  uploadedAt: string;
  status: 'indexed' | 'processing' | 'failed';
}

const KnowledgeManagement: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [toast, setToast] = useState<{ message: string; type: 'info' | 'success' | 'error' } | null>(null);
  const [processing, setProcessing] = useState(false);
  const [localPath, setLocalPath] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (message: string, type: 'info' | 'success' | 'error') => {
    setToast({ message, type });
    if (type === 'success' || type === 'error') {
      setTimeout(() => setToast(null), 4000);
    }
  };

  const fetchDocuments = async () => {
    try {
      const response = await apiClient.get('/documents');
      setDocuments(response.data);
    } catch (error) {
      console.error('Error fetching documents:', error);
      showToast('Error loading document list.', 'error');
    }
  };

  const handlePathUpload = async () => {
    if (!localPath.trim()) {
      showToast('Vui lòng nhập đường dẫn tệp PDF.', 'error');
      return;
    }
    setProcessing(true);
    showToast('Đang yêu cầu nạp tài liệu...', 'info');
    try {
      const response = await apiClient.post('/upload-by-path', {
        file_path: localPath.trim()
      });
      showToast('Đang phân tích và bóc tách bố cục tài liệu...', 'info');
      fetchDocuments();
      pollStatus(response.data.task_id);
      setLocalPath('');
    } catch (error: any) {
      console.error('Path upload error:', error);
      const errMsg = error.response?.data?.detail || 'Lỗi nạp tài liệu từ đường dẫn local.';
      showToast(errMsg, 'error');
      setProcessing(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  const pollStatus = (taskId: string) => {
    if (!taskId || taskId === 'undefined') {
      showToast('Error: Invalid process task ID.', 'error');
      setProcessing(false);
      return;
    }

    let attempts = 0;
    const maxAttempts = 30; // 60 seconds total at 2000ms intervals

    const interval = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(interval);
        showToast('Document processing timed out.', 'error');
        setProcessing(false);
        fetchDocuments();
        return;
      }

      try {
        const response = await apiClient.get(`/status/${taskId}`);
        const { status, details } = response.data;

        if (status === 'completed') {
          clearInterval(interval);
          showToast('Document analyzed and indexed successfully!', 'success');
          setProcessing(false);
          fetchDocuments(); // Refresh complete list
        } else if (status === 'failed') {
          clearInterval(interval);
          showToast(`Processing failed: ${details || 'Unknown error'}`, 'error');
          setProcessing(false);
          fetchDocuments(); // Refresh failed state
        }
      } catch (error) {
        console.error('Polling error:', error);
        clearInterval(interval);
        setProcessing(false);
        fetchDocuments();
      }
    }, 2000);
  };



  const uploadFile = async (file: File) => {
    const isPdf = file.name.toLowerCase().endsWith('.pdf') && (file.type === 'application/pdf' || file.type === '');
    if (!isPdf) {
      showToast('Invalid file. Please upload a PDF document only.', 'error');
      return;
    }

    const MAX_SIZE = 100 * 1024 * 1024; // 100MB
    if (file.size > MAX_SIZE) {
      showToast('File too large. Please upload a file under 100MB.', 'error');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    setProcessing(true);
    showToast(`Uploading document: ${file.name}...`, 'info');

    try {
      const response = await apiClient.post('/upload-pdf', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      showToast('Analyzing and extracting document layout...', 'info');
      fetchDocuments(); // Fetch 'processing' status
      pollStatus(response.data.task_id);
    } catch (error) {
      showToast('Error uploading document. Please try again.', 'error');
      setProcessing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      uploadFile(e.target.files[0]);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (window.confirm(`Are you sure you want to delete document "${name}"? This action will permanently remove its knowledge base index.`)) {
      try {
        showToast('Deleting document...', 'info');
        await apiClient.delete(`/documents/${id}`);
        showToast('Document deleted and knowledge base updated successfully!', 'success');
        fetchDocuments();
      } catch (error) {
        console.error('Delete error:', error);
        showToast('Failed to delete document. Please try again.', 'error');
      }
    }
  };

  const handleRename = async (id: string, currentName: string) => {
    const newName = window.prompt('Enter new display name for the document:', currentName);
    if (newName && newName.trim() !== '' && newName !== currentName) {
      try {
        showToast('Renaming document...', 'info');
        await apiClient.patch(`/documents/${id}`, { name: newName });
        showToast('Document renamed successfully!', 'success');
        fetchDocuments();
      } catch (error) {
        console.error('Rename error:', error);
        showToast('Failed to rename document.', 'error');
      }
    }
  };

  const filteredDocs = documents.filter(doc => 
    doc.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex-1 min-h-screen bg-slate-50 flex flex-col p-8 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Database className="w-6 h-6 text-indigo-600" />
            Knowledge Base
          </h1>
          <p className="text-sm text-slate-500 mt-1">Manage documents and database knowledge nodes for financial analysis.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-white border border-slate-200 rounded-xl px-2 py-1 shadow-sm">
            <input
              type="text"
              placeholder="Local path to PDF (e.g. E:\Thesis\data\test_pdfs_scanned\VNM_Q3-2025_4.pdf)"
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              className="text-xs bg-transparent border-none outline-none w-80 px-2 py-1 text-slate-800"
            />
            <button
              onClick={handlePathUpload}
              disabled={processing}
              className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 text-indigo-600 text-xs font-semibold rounded-lg transition-all whitespace-nowrap"
            >
              Ingest Path
            </button>
          </div>
          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={processing}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl shadow-lg shadow-indigo-100 transition-all duration-200"
          >
            <Plus className="w-4 h-4" />
            {processing ? 'Processing...' : 'Add Document'}
          </button>
        </div>
        <input 
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          className="hidden"
          accept=".pdf"
        />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Documents</p>
          <p className="text-2xl font-bold text-slate-900 mt-2">{documents.length}</p>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Sync Status</p>
          <div className="flex items-center gap-2 mt-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <p className="text-sm font-bold text-slate-900">
              {documents.filter(d => d.status === 'indexed').length} / {documents.length} Indexed
            </p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Storage Used</p>
          <p className="text-2xl font-bold text-slate-900 mt-2">
            {(documents.reduce((acc, doc) => acc + (parseFloat(doc.size) || 0), 0)).toFixed(1)} MB
          </p>
        </div>
      </div>

      {/* Actions & Filters */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex-1 flex flex-col">
        <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row items-center gap-4 justify-between">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input 
              type="text" 
              placeholder="Search documents..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
            />
          </div>
          <button 
            onClick={fetchDocuments}
            className="flex items-center gap-2 px-3 py-2 text-slate-500 hover:text-slate-800 text-sm font-medium hover:bg-slate-50 rounded-xl transition-all"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh List
          </button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <th className="px-6 py-4">Document Name</th>
                <th className="px-6 py-4">Size</th>
                <th className="px-6 py-4">Uploaded At</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-slate-600">
              {filteredDocs.map(doc => (
                <tr key={doc.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4 font-medium text-slate-800 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                      <FileText className="w-4 h-4" />
                    </div>
                    {doc.name}
                  </td>
                  <td className="px-6 py-4">{doc.size}</td>
                  <td className="px-6 py-4 text-slate-400">{doc.uploadedAt}</td>
                  <td className="px-6 py-4">
                    {doc.status === 'indexed' ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                        Indexed
                      </span>
                    ) : doc.status === 'failed' ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-50 text-red-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                        Failed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                        Processing
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button 
                        onClick={() => handleRename(doc.id, doc.name)}
                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                        title="Rename document"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDelete(doc.id, doc.name)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                        title="Delete document"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredDocs.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-slate-400 italic">
                    No matching documents found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {toast && (
        <div className={`fixed bottom-6 right-6 px-6 py-4 rounded-2xl shadow-xl border text-sm flex items-center gap-3 z-50 animate-fade-in ${
          toast.type === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-800' :
          toast.type === 'error' ? 'bg-rose-50 border-rose-100 text-rose-800' :
          'bg-indigo-50 border-indigo-100 text-indigo-800'
        }`}>
          {toast.type === 'success' && <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />}
          {toast.type === 'error' && <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />}
          {toast.type === 'info' && <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />}
          <p className="font-semibold">{toast.message}</p>
        </div>
      )}
    </div>
  );
};

export default KnowledgeManagement;
