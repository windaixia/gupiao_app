import { useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { Link } from 'react-router-dom';
import { CreditCard, CheckCircle2 } from 'lucide-react';

export default function Subscription() {
  const { user, setUser } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');

  if (!user) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold mb-4">请先登录以查看您的订阅</h2>
        <Link to="/login" className="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium">去登录</Link>
      </div>
    );
  }

  const handleUpgrade = async (plan: string) => {
    setLoading(true);
    setSuccess('');
    try {
      const response = await fetch('/api/subscription/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, plan, paymentMethod: 'card_mock' })
      });
      const data = await response.json();
      if (data.success) {
        setUser({ ...user, plan });
        setSuccess(`成功升级到 ${plan === 'premium' ? '高级版' : '专业版'} 计划！`);
      }
    } catch (error) {
      console.error('Upgrade failed', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-slate-900 mb-4">选择您的计划</h1>
        <p className="text-slate-500">获取高级 AI 分析和无限制查询。</p>
        
        {success && (
          <div className="mt-4 bg-green-50 text-green-600 p-3 rounded-lg inline-block font-medium">
            <CheckCircle2 className="inline h-5 w-5 mr-2" />
            {success}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Free Plan */}
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100 flex flex-col relative">
          {user.plan === 'free' && (
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">当前计划</div>
          )}
          <h2 className="text-xl font-bold text-slate-900 mb-2">基础版</h2>
          <div className="text-4xl font-bold text-slate-900 mb-6">¥0<span className="text-lg text-slate-500 font-normal">/月</span></div>
          <ul className="space-y-3 mb-8 flex-grow">
            <li className="flex items-center gap-2 text-slate-600"><CheckCircle2 className="h-5 w-5 text-green-500" /> 每日 3 次 AI 分析</li>
            <li className="flex items-center gap-2 text-slate-600"><CheckCircle2 className="h-5 w-5 text-green-500" /> 基础市场概览</li>
            <li className="flex items-center gap-2 text-slate-600"><CheckCircle2 className="h-5 w-5 text-green-500" /> 自选股 (最多 5 支)</li>
          </ul>
          <button 
            disabled={user.plan === 'free'}
            className="w-full py-3 rounded-xl font-medium border-2 border-slate-200 text-slate-600 disabled:opacity-50 disabled:bg-slate-50"
          >
            {user.plan === 'free' ? '当前' : '降级'}
          </button>
        </div>

        {/* Premium Plan */}
        <div className="bg-blue-600 p-8 rounded-2xl shadow-lg border border-blue-500 flex flex-col relative text-white transform md:-translate-y-4">
          {user.plan === 'premium' && (
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-yellow-400 text-yellow-900 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">当前计划</div>
          )}
          <h2 className="text-xl font-bold mb-2">高级版</h2>
          <div className="text-4xl font-bold mb-6">¥199<span className="text-lg text-blue-200 font-normal">/月</span></div>
          <ul className="space-y-3 mb-8 flex-grow">
            <li className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-blue-300" /> 无限制 AI 分析</li>
            <li className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-blue-300" /> 高级技术指标</li>
            <li className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-blue-300" /> 保存分析历史</li>
            <li className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-blue-300" /> 无限制自选股</li>
          </ul>
          <button 
            onClick={() => handleUpgrade('premium')}
            disabled={loading || user.plan === 'premium'}
            className="w-full py-3 rounded-xl font-bold bg-white text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-90 disabled:cursor-not-allowed"
          >
            {loading ? '处理中...' : user.plan === 'premium' ? '当前' : '升级到高级版'}
          </button>
        </div>

        {/* Pro Plan */}
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100 flex flex-col relative">
          {user.plan === 'professional' && (
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">当前计划</div>
          )}
          <h2 className="text-xl font-bold text-slate-900 mb-2">专业版</h2>
          <div className="text-4xl font-bold text-slate-900 mb-6">¥599<span className="text-lg text-slate-500 font-normal">/月</span></div>
          <ul className="space-y-3 mb-8 flex-grow">
            <li className="flex items-center gap-2 text-slate-600"><CheckCircle2 className="h-5 w-5 text-green-500" /> 包含高级版所有功能</li>
            <li className="flex items-center gap-2 text-slate-600"><CheckCircle2 className="h-5 w-5 text-green-500" /> 开放 API 访问</li>
            <li className="flex items-center gap-2 text-slate-600"><CheckCircle2 className="h-5 w-5 text-green-500" /> 定制 PDF 报告</li>
            <li className="flex items-center gap-2 text-slate-600"><CheckCircle2 className="h-5 w-5 text-green-500" /> 专属优先支持</li>
          </ul>
          <button 
            onClick={() => handleUpgrade('professional')}
            disabled={loading || user.plan === 'professional'}
            className="w-full py-3 rounded-xl font-medium bg-slate-900 text-white hover:bg-slate-800 transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {loading ? '处理中...' : user.plan === 'professional' ? '当前' : '升级到专业版'}
          </button>
        </div>
      </div>
    </div>
  );
}