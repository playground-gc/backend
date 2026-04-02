import React, { useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import Header from "./components/Header/Header";
import MarketWatch from "./components/MarketWatch/MarketWatch";
import { TradeFeed } from "./components/panels/TradeFeed";
import ChartGrid from "./components/ChartGrid/ChartGrid";
import OrderBook from "./components/orderbook/OrderBook";
import PlaceOrder from "./components/PlaceOrder/PlaceOrder";
import UserPanel from "./components/UserPanel/UserPanel";
import AuthModal from "./components/AuthModal/AuthModal";
import { useAuthStore } from "./store";
import ProfilePage from "./pages/ProfilePage.jsx";
import TutorialTour from "./components/TutorialTour/TutorialTour";
import ToastContainer from "./components/Notification/Toast.jsx";
import { useTutorialStore } from "./store/index.js";

function TradingTerminal() {
  const { token } = useAuthStore();

  const [activeSymbol, setActiveSymbol] = useState("AAPL_S");
  const [isAuthenticated, setIsAuthenticated] = useState(!!token);
  const [showAuth, setShowAuth] = useState(!token);
  const [authInitialSignUp, setAuthInitialSignUp] = useState(false);
  const { startTutorial } = useTutorialStore();

  const [comparisonSymbols, setComparisonSymbols] = useState([]);

  const handleLoginSuccess = (authPayload) => {
    const username = typeof authPayload === "string" ? authPayload : authPayload?.username;
    void username;
    setIsAuthenticated(true);
    setShowAuth(false);

    const hasCompleted = localStorage.getItem("hasCompletedTutorial");
    if (!hasCompleted) {
      // Delay launch so target panels are mounted when Joyride resolves selectors.
      setTimeout(() => {
        startTutorial();
      }, 500);
    }
  };

  const toggleComparison = (symbol) => {
    if (symbol === activeSymbol) return;
    setComparisonSymbols((prev) =>
      prev.includes(symbol)
        ? prev.filter((s) => s !== symbol)
        : [...prev, symbol],
    );
  };

  return (
    <div className="app-container">
      <ToastContainer />
      <TutorialTour />
      <div className="panel header-area">
        <Header symbol={activeSymbol} onLoginClick={() => setShowAuth(true)} />
      </div>

      {/* Left Column -> Order Book (Swapped based on prompt) */}
      <div className="panel left-area">
        <OrderBook symbol={activeSymbol} />
      </div>

      {/* Center Column -> Chart, PlaceOrder, and UserPanel stacked */}
      <div className="center-stack">
        <div
          className="panel"
          style={{ flex: "1 1 500px", minHeight: "400px" }}
        >
          <ChartGrid
            mainSymbol={activeSymbol}
            comparisonSymbols={comparisonSymbols}
          />
        </div>
        <div
          className="panel"
          style={{ flexShrink: 0, minHeight: "360px" }}
        >
          <PlaceOrder symbol={activeSymbol} isAuthenticated={isAuthenticated} />
        </div>
        <div className="panel" style={{ flexShrink: 0, minHeight: "200px" }}>
          <UserPanel isAuthenticated={isAuthenticated} />
        </div>
      </div>

      {/* Right Column → Market Watch + Market Radar Panel */}
      <div className="panel right-area" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <MarketWatch
          activeSymbol={activeSymbol}
          comparisonSymbols={comparisonSymbols}
          onSelectSymbol={(sym) => setActiveSymbol(sym)}
          onToggleComparison={toggleComparison}
        />
        <TradeFeed symbol={activeSymbol} />
      </div>

      {showAuth && (
        <AuthModal
          initialSignUp={authInitialSignUp}
          onClose={() => setShowAuth(false)}
          onSuccess={handleLoginSuccess}
        />
      )}
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/trading-charts" replace />} />
        <Route path="/terminal" element={<TradingTerminal />} />
        <Route path="/trading-charts" element={<TradingTerminal />} />
        <Route path="/portfolio" element={<ProfilePage />} />
        <Route path="/portfolio/*" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/trading-charts" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
