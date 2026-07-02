/* eslint-disable */
import { useState, useRef, useEffect, useCallback } from 'react';
import { Sparkles, Upload, Send, Loader2, FileText } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { useChatStore } from '../store/useChatStore';
import MessageBubble from './MessageBubble';
import apiClient from '../api/client';
import { useSSE } from '../api/useSSE';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const MainContent = () => {
  const { messages, addMessage, updateMessage, isProcessing, setProcessing, isLoading, setLoading, activePdfId, setActivePdf } = useChatStore();
  const [inputValue, setInputValue] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const { connect: connectSSE } = useSSE();

  useEffect(() => {
    console.log('[MainContent] activePdfId is now:', activePdfId);
  }, [activePdfId]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [messages, isLoading, isProcessing]);

  const pollStatus = (taskId: string | undefined, messageId: string) => {
    if (!taskId || taskId === 'undefined') {
      console.error('[Polling] Aborting: Invalid taskId', taskId);
      updateMessage(messageId, {
        text: 'Error: Did not receive a valid task process ID from the server.',
        isSystem: false,
        isError: true
      });
      setProcessing(false);
      return;
    }

    let attempts = 0;
    const maxAttempts = 30; // 60 seconds (30 * 2000ms)

    const interval = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(interval);
        updateMessage(messageId, {
          text: 'Document processing timeout. Please check the status in the Knowledge Base.',
          isSystem: false,
          isError: true
        });
        setProcessing(false);
        return;
      }

      try {
        const response = await apiClient.get(`/status/${taskId}`);
        const { status, details } = response.data || {};

        if (status === 'completed') {
          clearInterval(interval);
          setActivePdf(taskId);
          updateMessage(messageId, {
            text: details || 'Document has been successfully processed and indexed.',
            isSystem: false,
            hasChart: false
          });
          setProcessing(false);
        } else if (status === 'failed') {
          clearInterval(interval);
          updateMessage(messageId, {
            text: `Sorry, document processing failed: ${details || 'Unknown error'}`,
            isSystem: false,
            isError: true
          });
          setProcessing(false);
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, 2000);
  };

  const uploadFile = async (file: File) => {
    // Validate file extension and MIME type
    const isPdf = file.name.toLowerCase().endsWith('.pdf') && (file.type === 'application/pdf' || file.type === '');
    if (!isPdf) {
      addMessage({
        text: 'Invalid file. Please upload PDF reports only.',
        isUser: false,
        isSystem: true,
        isError: true
      });
      return;
    }

    // Validate file size (< 100MB)
    const MAX_SIZE = 100 * 1024 * 1024; // 100MB in bytes
    if (file.size > MAX_SIZE) {
      addMessage({
        text: 'File too large. Please upload a file smaller than 100MB.',
        isUser: false,
        isSystem: true,
        isError: true
      });
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    const messageId = addMessage({
      text: `Analyzing document: ${file.name}...`,
      isUser: false,
      isSystem: true
    });

    setProcessing(true);

    try {
      const response = await apiClient.post('/upload-pdf', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      pollStatus(response.data.task_id, messageId);
    } catch (error) {
      console.error('Upload error:', error);
      updateMessage(messageId, {
        text: 'Error uploading document. Please try again.',
        isSystem: false,
        isError: true
      });
      setProcessing(false);
    }
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      uploadFile(acceptedFiles[0]);
    }
  }, [uploadFile]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: false,
    noClick: true
  });

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userText = inputValue;
    setInputValue('');
    addMessage({ text: userText, isUser: true });

    setLoading(true);
    const aiMessageId = addMessage({ text: '', isUser: false, isSystem: true, steps: ['Initializing thought process...'] });

    const sseBaseUrl = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001/api/v1').replace('/api/v1', '');
    const url = `${sseBaseUrl}/chat-stream?message=${encodeURIComponent(userText)}&thread_id=default`;

    let steps: string[] = ['Initializing thought process...'];
    useChatStore.getState().setActiveSteps(steps);

    connectSSE(url, {
      onStep: (data) => {
        if (data.output) {
          if (steps[steps.length - 1] !== data.output) {
            steps = [...steps, data.output];
          }
          useChatStore.getState().setActiveSteps(steps);
          updateMessage(aiMessageId, {
            text: '',
            isSystem: true,
            steps: steps
          });
        }
      },
      onFinalAnswer: (data) => {
        if (data.content) {
          updateMessage(aiMessageId, {
            text: data.content,
            isSystem: false,
            steps: steps,
            chartImageUrl: data.chart_url || undefined,
            hasChart: !!data.chart_data,
            chartData: data.chart_data || undefined,
            chartType: data.chart_type || 'bar'
          });
        }
      },

      onDone: () => {
        setLoading(false);
        useChatStore.getState().setActiveSteps([]);
      },
      onError: (err) => {
        console.error('SSE Error:', err);
        updateMessage(aiMessageId, {
          text: 'Sorry, I encountered an error connecting to the server stream.',
          isSystem: false,
          isError: true
        });
        setLoading(false);
        useChatStore.getState().setActiveSteps([]);
      }
    });
  };

  return (
    <main 
      {...getRootProps()}
      className={cn(
        "flex-1 h-screen flex flex-col bg-slate-50 transition-all duration-300 relative",
        isDragActive && "bg-indigo-50/50 ring-2 ring-indigo-500 ring-inset"
      )}
    >
      <input {...getInputProps()} />
      
      {/* Header */}
      <header className="h-16 border-b border-slate-200 bg-white/90 backdrop-blur-md flex items-center justify-between px-8 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Sparkles className="w-5 h-5 text-indigo-600" />
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-emerald-400 rounded-full border border-white" />
          </div>
          <div>
            <h2 className="font-bold text-slate-900 tracking-tight text-[15px] leading-none">Financial Intelligence Agent</h2>
            <p className="text-[10px] text-emerald-600 font-semibold uppercase tracking-widest mt-0.5">Multi-Agent Online</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-full px-3 py-1.5 shadow-sm">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
            LangGraph Active
          </div>
          <button className="text-xs font-bold text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 px-3 py-1.5 rounded-full transition-all">Share</button>
        </div>
      </header>

      {/* Chat Area */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-8 pb-32 space-y-2"
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-2xl mx-auto space-y-6">
            <div className="w-20 h-20 bg-indigo-100 rounded-3xl flex items-center justify-center mb-4 shadow-sm">
              <Sparkles className="w-10 h-10 text-indigo-600" />
            </div>
            <h1 className="text-4xl font-bold text-slate-900 tracking-tight">
              Next-Generation <span className="text-indigo-600">Financial Analysis</span>
            </h1>
            <p className="text-slate-500 text-lg leading-relaxed">
              Upload your financial report (PDF) to start deep data analysis, 
              automated chart generation, and AI insights.
            </p>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full mt-8">
              {/* Upload card */}
              <div 
                onClick={() => document.getElementById('file-upload')?.click()}
                className="p-6 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-500 hover:scale-[1.01] active:scale-[0.99] transition-all text-left group cursor-pointer"
              >
                <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center mb-4 group-hover:bg-indigo-100 transition-colors border border-indigo-100">
                  <FileText className="w-5 h-5 text-indigo-600" />
                </div>
                <h3 className="font-bold text-slate-800 mb-1.5 tracking-tight">Upload Report</h3>
                <p className="text-xs text-slate-500 leading-relaxed">Drag & drop or click upload to start analyzing the PDF document.</p>
              </div>
              {/* Chat card */}
              <div 
                onClick={() => document.getElementById('chat-input-field')?.focus()}
                className="p-6 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md hover:border-emerald-500 hover:scale-[1.01] active:scale-[0.99] transition-all text-left group cursor-pointer"
              >
                <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center mb-4 group-hover:bg-emerald-100 transition-colors border border-emerald-100">
                  <Sparkles className="w-5 h-5 text-emerald-600" />
                </div>
                <h3 className="font-bold text-slate-800 mb-1.5 tracking-tight">Analyze with AI</h3>
                <p className="text-xs text-slate-500 leading-relaxed">Ask financial questions and get in-depth insights with automated charts.</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto w-full">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {isDragActive && (
              <div className="fixed inset-0 z-50 bg-indigo-600/10 backdrop-blur-[2px] flex items-center justify-center pointer-events-none">
                <div className="bg-white p-8 rounded-3xl shadow-2xl border-2 border-indigo-500 flex flex-col items-center space-y-4 animate-in zoom-in-95 duration-300">
                  <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center animate-bounce">
                    <Upload className="w-8 h-8 text-indigo-600" />
                  </div>
                  <p className="text-lg font-semibold text-slate-900">Drop file here to upload</p>
                  <p className="text-sm text-slate-500">PDF format supported</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input Area - FIXED at bottom */}
      <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-slate-50 via-slate-50 to-transparent pt-12">
        <div className="max-w-4xl mx-auto">
          <div className="relative group">
            <div className="absolute inset-0 bg-indigo-500/5 rounded-2xl blur-xl group-focus-within:bg-indigo-500/10 transition-all" />
            <div className="relative flex items-center bg-white border border-slate-200 rounded-2xl shadow-sm focus-within:border-indigo-500 focus-within:ring-4 focus-within:ring-indigo-500/10 transition-all overflow-hidden">
              <button 
                onClick={() => document.getElementById('file-upload')?.click()}
                className="p-4 text-slate-400 hover:text-indigo-600 transition-colors border-r border-slate-100"
              >
                <Upload className="w-5 h-5" />
              </button>
              <input 
                id="file-upload" 
                type="file" 
                className="hidden" 
                accept=".pdf" 
                onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])}
              />
              <input
                id="chat-input-field"
                type="text"
                disabled={!activePdfId}
                placeholder={activePdfId ? "Ask AI about your financial report..." : "Please upload or select a financial report to start chatting..."}
                className="flex-1 py-4 px-2 text-sm focus:outline-none text-slate-700 bg-transparent disabled:cursor-not-allowed disabled:text-slate-400"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
              />
              <button 
                onClick={handleSendMessage}
                disabled={!activePdfId || !inputValue.trim() || isLoading}
                className={cn(
                  "m-2 p-2.5 rounded-xl transition-all",
                  activePdfId && inputValue.trim() && !isLoading 
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-200 hover:bg-indigo-700" 
                    : "bg-slate-100 text-slate-400 cursor-not-allowed"
                )}
              >
                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              </button>
            </div>
          </div>
          <p className="mt-3 text-center text-[11px] text-slate-400 font-medium">
            AI can make mistakes. Please verify important information.
          </p>
        </div>
      </div>
    </main>
  );
};

export default MainContent;
