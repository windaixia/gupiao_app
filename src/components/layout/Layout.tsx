import { Link, Outlet } from 'react-router-dom';
import { LineChart, Search, User, LogOut, TrendingUp } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';

export default function Layout() {
  const { user, signOut } = useAuthStore();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Top Navigation */}
      <header className="bg-blue-900 text-white shadow-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-8">
              <Link to="/" className="flex items-center space-x-2 text-xl font-bold">
                <TrendingUp className="h-6 w-6 text-green-400" />
                <span>AI 股票分析</span>
              </Link>
              <nav className="hidden md:flex space-x-4">
                <Link to="/" className="hover:text-green-400 px-3 py-2 rounded-md text-sm font-medium transition-colors">
                  大盘
                </Link>
                {user && (
                  <>
                    <Link to="/portfolio" className="hover:text-green-400 px-3 py-2 rounded-md text-sm font-medium transition-colors">
                      模拟盘
                    </Link>
                    <Link to="/review-center" className="hover:text-green-400 px-3 py-2 rounded-md text-sm font-medium transition-colors">
                      AI复盘
                    </Link>
                    <Link to="/watchlist" className="hover:text-green-400 px-3 py-2 rounded-md text-sm font-medium transition-colors">
                      自选股
                    </Link>
                  </>
                )}
              </nav>
            </div>
            <div className="flex items-center space-x-4">
              {/* Global Search could go here */}
              <div className="relative hidden md:block">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Search className="h-4 w-4 text-slate-300" />
                </div>
                <input
                  type="text"
                  placeholder="搜索股票代码..."
                  className="bg-blue-800 text-white placeholder-slate-300 rounded-full pl-10 pr-4 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400 focus:bg-blue-700 transition-colors w-64"
                />
              </div>

              {user ? (
                <div className="flex items-center space-x-4">
                  <Link to="/profile" className="flex items-center space-x-1 hover:text-green-400 transition-colors">
                    <User className="h-5 w-5" />
                    <span className="text-sm font-medium">{user.name || user.email}</span>
                  </Link>
                  <button
                    onClick={() => signOut()}
                    className="flex items-center space-x-1 text-slate-300 hover:text-white transition-colors"
                    title="退出登录"
                  >
                    <LogOut className="h-5 w-5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center space-x-2">
                  <Link to="/login" className="text-sm font-medium hover:text-green-400 transition-colors px-3 py-2">
                    登录
                  </Link>
                  <Link to="/register" className="bg-green-500 hover:bg-green-400 text-white px-4 py-1.5 rounded-full text-sm font-medium transition-colors">
                    注册
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-8 text-center text-sm">
        <div className="max-w-7xl mx-auto px-4">
          <p>&copy; {new Date().getFullYear()} AI StockPro. All rights reserved.</p>
          <p className="mt-2 text-xs text-slate-500">Disclaimer: AI analysis is for informational purposes only and does not constitute financial advice.</p>
        </div>
      </footer>
    </div>
  );
}
