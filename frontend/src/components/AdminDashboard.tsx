/* eslint-disable */
import { useEffect, useState } from 'react';
import { Users, FileText, HardDrive, BarChart3, Database, Shield } from 'lucide-react';

interface AdminStats {
  total_users: number;
  total_documents: number;
  total_storage_bytes: number;
}

interface UserItem {
  id: string;
  email: string;
  full_name: string;
  role: string;
  created_at: string;
}

interface DocItem {
  id: string;
  filename: string;
  size_bytes: number;
  uploaded_at: string;
  owner_email: string;
}

interface TokenUsage {
  date: string;
  prompt_tokens: number;
  completion_tokens: number;
}

export const AdminDashboard = () => {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [usersList, setUsersList] = useState<UserItem[]>([]);
  const [docsList, setDocsList] = useState<DocItem[]>([]);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const API_URL = import.meta.env.VITE_API_URL || '';

  useEffect(() => {
    const fetchAdminStats = async () => {
      try {
        const response = await fetch(`${API_URL}/api/v1/auth/admin/stats`, {
          credentials: 'include',
        });
        if (!response.ok) {
          throw new Error('Failed to fetch admin stats. Verify administrator access.');
        }
        const data = await response.json();
        if (data.status === 'success') {
          setStats(data.stats);
          setUsersList(data.users);
          setDocsList(data.documents);
          setTokenUsage(data.token_usage);
        }
      } catch (err: any) {
        setError(err.message || 'Error fetching admin data.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchAdminStats();
  }, [API_URL]);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (isLoading) {
    return (
      <div className="flex-1 min-h-screen flex flex-col items-center justify-center bg-slate-950 text-slate-100 select-none">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm text-slate-400">Loading admin console...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 min-h-screen flex items-center justify-center bg-slate-950 p-6 select-none">
        <div className="w-full max-w-md bg-red-950/20 border border-red-900/60 rounded-3xl p-6 text-center">
          <Shield className="w-12 h-12 text-red-500 mx-auto mb-4 animate-bounce" />
          <h3 className="text-lg font-bold text-slate-100 mb-2">Access Denied</h3>
          <p className="text-sm text-red-300/80 leading-relaxed mb-6">{error}</p>
        </div>
      </div>
    );
  }

  // Calculate chart max height helper
  const maxTokens = Math.max(...tokenUsage.map(d => d.prompt_tokens + d.completion_tokens), 1);

  return (
    <main className="flex-1 min-h-screen bg-slate-950 text-slate-100 p-8 overflow-y-auto select-none">
      {/* Decorative Blur */}
      <div className="absolute top-0 right-0 w-[400px] h-[400px] rounded-full bg-indigo-900/5 blur-[100px] pointer-events-none" />

      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
          <Shield className="w-5 h-5 text-indigo-400" />
        </div>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Admin Dashboard</h2>
          <p className="text-xs text-slate-400">System metrics, user directory, and resource monitoring</p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 flex items-center gap-5">
          <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-400 shadow-md">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-slate-400 font-medium">Total Accounts</p>
            <h4 className="text-2xl font-bold text-slate-100 mt-1">{stats?.total_users || 0}</h4>
          </div>
        </div>

        <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 flex items-center gap-5">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 shadow-md">
            <FileText className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-slate-400 font-medium">Documents Stored</p>
            <h4 className="text-2xl font-bold text-slate-100 mt-1">{stats?.total_documents || 0}</h4>
          </div>
        </div>

        <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 flex items-center gap-5">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-400 shadow-md">
            <HardDrive className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-slate-400 font-medium">Storage Consumed</p>
            <h4 className="text-2xl font-bold text-slate-100 mt-1">{formatBytes(stats?.total_storage_bytes || 0)}</h4>
          </div>
        </div>
      </div>

      {/* Token usage visualization */}
      <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 mb-8">
        <div className="flex items-center gap-2 mb-6">
          <BarChart3 className="w-5 h-5 text-indigo-400" />
          <h3 className="text-base font-bold text-slate-100">Local LLM Token Consumption</h3>
        </div>

        <div className="h-64 flex items-end justify-between gap-3 px-4 pt-4 border-b border-slate-800 relative">
          {tokenUsage.map((day, idx) => {
            const promptPct = (day.prompt_tokens / maxTokens) * 100;
            const compPct = (day.completion_tokens / maxTokens) * 100;

            return (
              <div key={idx} className="flex-1 flex flex-col items-center group relative h-full justify-end">
                {/* Tooltip */}
                <div className="absolute bottom-full mb-2 bg-slate-900 border border-slate-700 text-[10px] text-slate-200 px-3 py-2 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10 shadow-xl pointer-events-none w-36 text-center">
                  <p className="font-bold border-b border-slate-800 pb-1 mb-1">{day.date}</p>
                  <p className="text-indigo-400">Prompt: {day.prompt_tokens.toLocaleString()}</p>
                  <p className="text-emerald-400">Completion: {day.completion_tokens.toLocaleString()}</p>
                  <p className="font-semibold text-slate-100 mt-1">Total: {(day.prompt_tokens + day.completion_tokens).toLocaleString()}</p>
                </div>

                {/* Vertical Stack Bar */}
                <div className="w-full max-w-[40px] rounded-t-lg overflow-hidden flex flex-col justify-end h-full">
                  <div 
                    style={{ height: `${compPct}%` }} 
                    className="bg-emerald-500 hover:bg-emerald-400 transition-all duration-300"
                  />
                  <div 
                    style={{ height: `${promptPct}%` }} 
                    className="bg-indigo-600 hover:bg-indigo-500 transition-all duration-300"
                  />
                </div>

                <span className="text-[10px] text-slate-500 mt-2 font-medium">{day.date.slice(5)}</span>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-center gap-6 mt-4 text-[11px] text-slate-400">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-md bg-indigo-600" />
            <span>Prompt Tokens</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-md bg-emerald-500" />
            <span>Completion Tokens</span>
          </div>
        </div>
      </div>

      {/* Users and Documents Lists */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {/* User Directory */}
        <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 overflow-hidden">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-indigo-400" />
              <h3 className="text-base font-bold text-slate-100">User Directory</h3>
            </div>
            <span className="text-[10px] bg-slate-800 text-slate-400 px-2.5 py-1 rounded-full font-bold">
              {usersList.length} Accounts
            </span>
          </div>

          <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider">
                  <th className="pb-3 pl-2">Name</th>
                  <th className="pb-3">Email</th>
                  <th className="pb-3">Role</th>
                  <th className="pb-3 pr-2">Registered</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {usersList.map((usr) => (
                  <tr key={usr.id} className="hover:bg-slate-850/40 transition-colors">
                    <td className="py-3 pl-2 font-semibold text-slate-200">{usr.full_name}</td>
                    <td className="py-3 text-slate-400">{usr.email}</td>
                    <td className="py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                        usr.role === 'ADMIN' ? 'bg-indigo-900/40 text-indigo-300 border border-indigo-800/40' : 'bg-slate-800 text-slate-400'
                      }`}>
                        {usr.role}
                      </span>
                    </td>
                    <td className="py-3 text-slate-500 pr-2">{usr.created_at.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Global Document Catalog */}
        <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 overflow-hidden">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-indigo-400" />
              <h3 className="text-base font-bold text-slate-100">Global Documents</h3>
            </div>
            <span className="text-[10px] bg-slate-800 text-slate-400 px-2.5 py-1 rounded-full font-bold">
              {docsList.length} Files
            </span>
          </div>

          <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider">
                  <th className="pb-3 pl-2">Filename</th>
                  <th className="pb-3">Size</th>
                  <th className="pb-3">Owner</th>
                  <th className="pb-3 pr-2">Uploaded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {docsList.map((doc) => (
                  <tr key={doc.id} className="hover:bg-slate-850/40 transition-colors">
                    <td className="py-3 pl-2 font-semibold text-slate-200 max-w-[160px] truncate" title={doc.filename}>
                      {doc.filename}
                    </td>
                    <td className="py-3 text-slate-400">{formatBytes(doc.size_bytes)}</td>
                    <td className="py-3 text-slate-400 max-w-[120px] truncate" title={doc.owner_email}>
                      {doc.owner_email || 'System'}
                    </td>
                    <td className="py-3 text-slate-500 pr-2">{doc.uploaded_at.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
};
