import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { dataManager } from "../../services/dataManager";
import { useAuthStore } from "../../store";
import AuthModal from "../AuthModal/AuthModal";
import { useTutorialStore } from "../../store";
import { Info } from "lucide-react";

const TwitterIcon = ({ size }) => (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z"/></svg>);
const FacebookIcon = ({ size }) => (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>);
const InstagramIcon = ({ size }) => (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>);
const GithubIcon = ({ size }) => (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>);

export default function Header({ symbol, onLoginClick }) {
  const { token, username, clearAuth } = useAuthStore();
  const [ticker, setTicker] = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(!!token);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [userName, setUserName] = useState(username || "");

  useEffect(() => {
    const unsub = dataManager.subscribe(symbol, (data) => {
      setTicker({ ...data.ticker });
    });
    return unsub;
  }, [symbol]);

  useEffect(() => {
    setIsLoggedIn(!!token);
    if (username) setUserName(username);
  }, [token, username]);

  if (!ticker) return <div style={styles.header}>Loading...</div>;

  const isUp = ticker.change >= 0;

  return (
    <div id="tour-stats-bar" style={styles.header}>
      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} onSuccess={(authPayload) => {
        const user = typeof authPayload === "string" ? authPayload : authPayload?.username;
        setUserName(user || "");
        setIsLoggedIn(true);
        setShowAuthModal(false);
      }} />}
      <div style={styles.leftGroup}>
        <a href="/" style={{
          fontFamily: "'Barlow Semi Condensed', sans-serif",
          fontWeight: 900,
          fontSize: "20px",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "#f0f2fc",
          textDecoration: "none",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          marginRight: "24px",
          borderRight: "1px solid rgba(255,255,255,0.1)",
          paddingRight: "24px"
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#5AF2B5">
            <polygon points="12,2 22,22 2,22" />
          </svg>
          <div>Synthetic <b style={{ color: "#5AF2B5", fontWeight: 900 }}>Bull</b></div>
        </a>

        <div style={styles.symbolGroup}>
          <h1 style={styles.symbol}>{ticker.symbol}</h1>
          <span style={styles.link}>
            Synthetic Asset
          </span>
        </div>

        <div style={styles.statGroup}>
          <div style={styles.statValue}>
            <span
              className={isUp ? "up-color" : "down-color"}
              style={styles.price}
            >
              {ticker.price.toFixed(2)}
            </span>
          </div>
          <div style={styles.statLabel}>$ {ticker.price.toFixed(2)}</div>
        </div>

        <div style={styles.statGroup}>
          <div style={styles.statLabel}>24h Change</div>
          <div
            className={isUp ? "up-color" : "down-color"}
            style={styles.statValue}
          >
            {isUp ? "+" : ""}
            {ticker.change.toFixed(2)}%
          </div>
        </div>

        <div style={styles.statGroup}>
          <div style={styles.statLabel}>24h High</div>
          <div style={styles.statValue}>{ticker.high.toFixed(4)}</div>
        </div>

        <div style={styles.statGroup}>
          <div style={styles.statLabel}>24h Low</div>
          <div style={styles.statValue}>{ticker.low.toFixed(4)}</div>
        </div>

        <div style={styles.statGroup}>
          <div style={styles.statLabel}>24h Vol</div>
          <div style={styles.statValue}>{ticker.volume.toLocaleString()}</div>
        </div>
      </div>

      <div style={styles.rightGroup}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', borderRight: '1px solid rgba(255,255,255,0.1)', paddingRight: '16px', marginRight: '8px' }}>
          <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(255,255,255,0.5)', display: 'flex', transition: 'color 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.color = '#fff'} onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.5)'} title="Twitter">
            <TwitterIcon size={18} />
          </a>
          <a href="https://facebook.com" target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(255,255,255,0.5)', display: 'flex', transition: 'color 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.color = '#fff'} onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.5)'} title="Facebook">
            <FacebookIcon size={18} />
          </a>
          <a href="https://instagram.com" target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(255,255,255,0.5)', display: 'flex', transition: 'color 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.color = '#fff'} onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.5)'} title="Instagram">
            <InstagramIcon size={18} />
          </a>
          <a href="https://github.com" target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(255,255,255,0.5)', display: 'flex', transition: 'color 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.color = '#fff'} onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.5)'} title="GitHub">
            <GithubIcon size={18} />
          </a>
        </div>
        <button 
          onClick={() => useTutorialStore.getState().startTutorial()} 
          style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', display: 'flex', alignItems: 'center', marginRight: '16px' }}
          title="Restart Tutorial Tour"
        >
          <Info size={18} />
        </button>
        {userName ? (
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div
              style={{
                color: "#5AF2B5",
                fontWeight: "600",
                textShadow: "0 0 8px rgba(90, 242, 181, 0.4)",
                letterSpacing: "1px",
                textTransform: "uppercase",
                fontSize: "13px",
              }}
            >
              {userName}
            </div>
            <Link to="/portfolio" style={styles.profileBtn}>
              Profile
            </Link>
            <button
              onClick={() => {
                clearAuth();
                window.location.reload();
              }}
              style={styles.logoutBtn}
            >
              Log Out
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div style={{ color: "rgba(255, 255, 255, 0.5)", fontSize: "12px", textTransform: "uppercase", letterSpacing: "1px" }}>
              Guest Mode
            </div>
            <button onClick={onLoginClick || (() => setShowAuthModal(true))} style={styles.loginBtn}>Sign In / Sign Up</button>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 24px",
    minHeight: "70px",
    height: "auto",
    width: "100%",
    flexWrap: "wrap",
    gap: "16px",
  },
  leftGroup: { display: "flex", alignItems: "center", gap: "24px", flexWrap: "wrap" },
  rightGroup: { display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap", marginLeft: "auto" },
  symbolGroup: { display: "flex", flexDirection: "column" },
  symbol: {
    fontSize: "24px",
    fontWeight: "800",
    margin: 0,
    color: "#fff",
    textShadow: "0 0 10px rgba(255, 255, 255, 0.2)",
  },
  link: {
    fontSize: "11px",
    color: "rgba(255, 255, 255, 0.5)",
    textDecoration: "none",
    textTransform: "uppercase",
    letterSpacing: "1px",
  },
  statGroup: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
  },
  statLabel: {
    fontSize: "11px",
    color: "rgba(255, 255, 255, 0.5)",
    marginBottom: "4px",
    textTransform: "uppercase",
    letterSpacing: "1px",
  },
  statValue: { fontSize: "14px", fontWeight: "600", color: "#fff" },
  price: { fontSize: "18px", fontWeight: "bold" },
  loginBtn: {
    backgroundColor: "#5AF2B5",
    color: "#0D0D0D",
    border: "none",
    borderRadius: "0px",
    fontWeight: "700",
    padding: "8px 16px",
    cursor: "pointer",
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "1px",
    boxShadow: "0 0 12px rgba(90, 242, 181, 0.3)",
  },
  signupBtn: {
    backgroundColor: "rgba(90, 242, 181, 0.1)",
    color: "#5AF2B5",
    border: "1px solid rgba(90, 242, 181, 0.3)",
    borderRadius: "0px",
    fontWeight: "600",
    padding: "8px 16px",
    cursor: "pointer",
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "1px",
  },
  profileBtn: {
    backgroundColor: "rgba(90, 242, 181, 0.1)",
    color: "#5AF2B5",
    border: "1px solid rgba(90, 242, 181, 0.3)",
    borderRadius: "0px",
    fontWeight: "600",
    padding: "6px 14px",
    cursor: "pointer",
    fontSize: "12px",
    textDecoration: "none",
    textTransform: "uppercase",
    letterSpacing: "1px",
  },
  logoutBtn: {
    backgroundColor: "rgba(246, 70, 93, 0.1)",
    color: "#f6465d",
    border: "1px solid rgba(246, 70, 93, 0.3)",
    borderRadius: "0px",
    fontWeight: "600",
    padding: "6px 14px",
    cursor: "pointer",
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "1px",
  },
};
