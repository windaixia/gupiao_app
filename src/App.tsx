import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Layout from "./components/layout/Layout";
import Home from "./pages/Home";
import StockAnalysis from "./pages/Stock/StockAnalysis";
import Login from "./pages/Auth/Login";
import Register from "./pages/Auth/Register";
import Profile from "./pages/Profile/Profile";
import Watchlist from "./pages/Profile/Watchlist";
import Subscription from "./pages/Profile/Subscription";
import Portfolio from "./pages/Profile/Portfolio";
import ReviewCenter from "./pages/Profile/ReviewCenter";
import MembershipAdmin from "./pages/Admin/MembershipAdmin";
import AnalysisHistory from "./pages/Stock/AnalysisHistory";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="stock/:code" element={<StockAnalysis />} />
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />
          <Route path="profile" element={<Profile />} />
          <Route path="watchlist" element={<Watchlist />} />
          <Route path="subscription" element={<Subscription />} />
          <Route path="admin/memberships" element={<MembershipAdmin />} />
          <Route path="portfolio" element={<Portfolio />} />
          <Route path="review-center" element={<ReviewCenter />} />
          <Route path="stock/:code/history" element={<AnalysisHistory />} />
          <Route path="*" element={<div className="text-center text-xl py-20">404 Not Found</div>} />
        </Route>
      </Routes>
    </Router>
  );
}
