import { useAuthStore } from '@/store/authStore';
import { Link } from 'react-router-dom';
import { User, History, Star, CreditCard, Brain, Wallet } from 'lucide-react';

export default function Profile() {
  const { user, signOut } = useAuthStore();

  if (!user) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold mb-4">请先登录以查看个人中心</h2>
        <Link to="/login" className="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium">去登录</Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold text-slate-900 mb-8">个人中心</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* User Info Card */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 col-span-1 md:col-span-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="bg-blue-100 p-4 rounded-full">
              <User className="h-8 w-8 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">{user.name || '用户'}</h2>
              <p className="text-slate-500">{user.email}</p>
            </div>
          </div>
          <div className="text-right">
            <span className="inline-block bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-sm font-bold uppercase tracking-wider">
              {user.plan || 'free'} 计划
            </span>
            <div className="mt-2">
              <button onClick={() => signOut()} className="text-red-500 hover:text-red-600 text-sm font-medium">退出登录</button>
            </div>
          </div>
        </div>

        {/* Quick Links */}
        <Link to="/watchlist" className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow group">
          <Star className="h-8 w-8 text-yellow-500 mb-4 group-hover:scale-110 transition-transform" />
          <h3 className="text-lg font-bold text-slate-900 mb-1">我的自选股</h3>
          <p className="text-sm text-slate-500">管理关注股票与预警。</p>
        </Link>

        <Link to="/review-center" className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow group">
          <Brain className="h-8 w-8 text-violet-500 mb-4 group-hover:scale-110 transition-transform" />
          <h3 className="text-lg font-bold text-slate-900 mb-1">AI 复盘中心</h3>
          <p className="text-sm text-slate-500">查看 AI 命中率、复盘记录与分析趋势。</p>
        </Link>

        <Link to="/portfolio" className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow group">
          <Wallet className="h-8 w-8 text-blue-500 mb-4 group-hover:scale-110 transition-transform" />
          <h3 className="text-lg font-bold text-slate-900 mb-1">模拟盘账户</h3>
          <p className="text-sm text-slate-500">查看资产、持仓与交易流水。</p>
        </Link>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow group cursor-pointer">
          <History className="h-8 w-8 text-indigo-500 mb-4 group-hover:scale-110 transition-transform" />
          <h3 className="text-lg font-bold text-slate-900 mb-1">分析历史</h3>
          <p className="text-sm text-slate-500">从个股详情页进入对应股票的历史分析记录。</p>
        </div>

        <Link to="/subscription" className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow group">
          <CreditCard className="h-8 w-8 text-green-500 mb-4 group-hover:scale-110 transition-transform" />
          <h3 className="text-lg font-bold text-slate-900 mb-1">订阅管理</h3>
          <p className="text-sm text-slate-500">升级套餐并管理计费。</p>
        </Link>
      </div>
    </div>
  );
}
