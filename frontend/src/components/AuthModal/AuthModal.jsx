import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom";
import { Mail, Lock, User, LogIn, UserPlus, Eye, EyeOff } from "lucide-react";
import { useAuthStore } from "../../store";
import { login, register } from "../../services/api/authApi";

export default function AuthModal({ onClose, onSuccess, initialSignUp = false }) {
  const setAuth = useAuthStore((state) => state.setAuth);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSignUp, setIsSignUp] = useState(initialSignUp);
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  // Reset error on mode switch
  useEffect(() => { setError(""); }, [isSignUp]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password || !username || (isSignUp && !email)) {
      setError("Please fill in all required fields.");
      setShake(true);
      setTimeout(() => setShake(false), 500);
      return;
    }
    setLoading(true);
    setError("");
    try {
      if (isSignUp) {
        const res = await register({
          username: username || email,
          email,
          password,
        });
        setAuth({
          token: res.access_token,
          username: res.username,
          userId: res.user_id,
        });
        onSuccess({ username: res.username, authType: "signup" });
      } else {
        const res = await login({ username: username || email, password });
        setAuth({
          token: res.access_token,
          username: res.username,
          userId: res.user_id,
        });
        onSuccess({ username: res.username, authType: "login" });
      }
      onClose();
    } catch (err) {
      setError(err.message || "Authentication failed. Check your credentials.");
      setShake(true);
      setTimeout(() => setShake(false), 500);
    } finally {
      setLoading(false);
    }
  };

  const content = (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <style>{`
          input:-webkit-autofill,
          input:-webkit-autofill:hover,
          input:-webkit-autofill:focus,
          input:-webkit-autofill:active {
            -webkit-box-shadow: 0 0 0px 1000px #000000 inset !important;
            box-shadow: 0 0 0px 1000px #000000 inset !important;
            -webkit-text-fill-color: #ffffff !important;
            caret-color: #ffffff;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            transition: background-color 9999s ease-in-out 0s;
          }
          .auth-input:focus {
            border-color: rgba(90, 242, 181, 0.5) !important;
            box-shadow: 0 0 0 2px rgba(90, 242, 181, 0.1) !important;
          }
          .auth-submit-btn:hover {
            background: #7af7c8 !important;
            box-shadow: 0 0 24px rgba(90, 242, 181, 0.5) !important;
            transform: translateY(-1px);
          }
          .auth-close:hover { color: #fff !important; }
        `}</style>

        {/* Mint top accent bar */}
        <div style={styles.topAccent} />

        {/* Logo + Title header */}
        <div style={styles.logoRow}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="#5AF2B5"
            style={{ filter: "drop-shadow(0 0 6px rgba(90,242,181,0.6))" }}>
            <polygon points="12,2 22,22 2,22" />
          </svg>
          <span style={styles.brandName}>
            Synthetic <b style={{ color: "#fff" }}>Bull</b>
          </span>
        </div>

        <div style={styles.header}>
          <h2 style={styles.title}>
            {isSignUp ? "Create Account" : "Welcome Back"}
          </h2>
          <div style={styles.closeBtn} className="auth-close" onClick={onClose}>✕</div>
        </div>

        <p style={styles.subtitle}>
          {isSignUp
            ? "Join Synthetic Bull and start trading synthetic assets."
            : "Sign in to your trading account to continue."}
        </p>

        {error && <div style={styles.error}>{error}</div>}

        <form onSubmit={handleSubmit} style={styles.formMode}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Username</label>
            <div style={styles.inputWrapper}>
              <User size={16} style={styles.inputIcon} />
              <input
                type="text"
                className="auth-input"
                style={{ ...styles.input, paddingLeft: "40px" }}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                autoComplete="username"
              />
            </div>
          </div>

          {/* Email — sign up only */}
          {isSignUp && (
            <div style={styles.inputGroup}>
              <label style={styles.label}>Email</label>
              <div style={styles.inputWrapper}>
                <Mail size={16} style={styles.inputIcon} />
                <input
                  type="email"
                  className="auth-input"
                  style={{ ...styles.input, paddingLeft: "40px" }}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  autoComplete="email"
                />
              </div>
            </div>
          )}

          <div style={styles.inputGroup}>
            <label style={styles.label}>Password</label>
            <div style={styles.inputWrapper}>
              <Lock size={16} style={styles.inputIcon} />
              <input
                type={showPassword ? "text" : "password"}
                className="auth-input"
                style={{ ...styles.input, paddingLeft: "40px", paddingRight: "44px" }}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete={isSignUp ? "new-password" : "current-password"}
              />
              <button
                type="button"
                style={styles.eyeBtn}
                onClick={() => setShowPassword((prev) => !prev)}
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff size={16} style={styles.eyeIcon} />
                ) : (
                  <Eye size={16} style={styles.eyeIcon} />
                )}
              </button>
            </div>
          </div>

          <button type="submit" className="auth-submit-btn" style={styles.loginBtn} disabled={loading}>
            {loading ? (
              "Please wait..."
            ) : isSignUp ? (
              <>
                <UserPlus size={16} style={{ marginRight: 8, verticalAlign: "middle" }} />
                Create Account
              </>
            ) : (
              <>
                <LogIn size={16} style={{ marginRight: 8, verticalAlign: "middle" }} />
                Sign In
              </>
            )}
          </button>
        </form>

        <div style={styles.divider}>
          <div style={styles.dividerLine} />
          <span style={styles.dividerText}>or</span>
          <div style={styles.dividerLine} />
        </div>

        <div style={styles.footerLink}>
          {isSignUp ? (
            <>
              <span style={{ color: "rgba(255,255,255,0.5)" }}>Already have an account? </span>
              <span
                style={{ color: "#5AF2B5", cursor: "pointer", fontWeight: "bold" }}
                onClick={() => setIsSignUp(false)}
              >
                Sign In
              </span>
            </>
          ) : (
            <>
              <span style={{ color: "rgba(255,255,255,0.5)" }}>New to Synthetic Bull? </span>
              <span
                style={{ color: "#5AF2B5", cursor: "pointer", fontWeight: "bold" }}
                onClick={() => setIsSignUp(true)}
              >
                Create Account
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
  return ReactDOM.createPortal(content, document.body);
}

const styles = {
  overlay: {
    position: "fixed",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    backdropFilter: "blur(8px)",
  },
  modal: {
    backgroundColor: "rgba(4, 10, 8, 0.96)",
    backdropFilter: "blur(20px)",
    border: "1px solid rgba(90, 242, 181, 0.2)",
    boxShadow: "0 0 60px rgba(90, 242, 181, 0.1), 0 30px 80px rgba(0,0,0,0.8), inset 0 0 30px rgba(90, 242, 181, 0.03)",
    width: "420px",
    borderRadius: "4px",
    padding: "0 36px 36px",
    display: "flex",
    flexDirection: "column",
    position: "relative",
    overflow: "hidden",
  },
  topAccent: {
    height: "2px",
    background: "linear-gradient(90deg, transparent, #5AF2B5, #7af7c8, #5AF2B5, transparent)",
    marginLeft: "-36px",
    marginRight: "-36px",
    marginBottom: "28px",
    boxShadow: "0 0 12px rgba(90,242,181,0.4)",
  },
  logoRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "20px",
  },
  brandName: {
    fontFamily: "'Barlow Semi Condensed', sans-serif",
    fontWeight: 900,
    fontSize: "18px",
    letterSpacing: "0.15em",
    textTransform: "uppercase",
    color: "#5AF2B5",
    textShadow: "0 0 8px rgba(90,242,181,0.4)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "8px",
  },
  title: {
    margin: 0,
    fontSize: "26px",
    color: "#fff",
    fontWeight: "800",
    letterSpacing: "-0.02em",
  },
  subtitle: {
    margin: "0 0 24px",
    fontSize: "13px",
    color: "rgba(255,255,255,0.4)",
    lineHeight: 1.5,
  },
  closeBtn: {
    fontSize: "18px",
    color: "rgba(255,255,255,0.4)",
    cursor: "pointer",
    transition: "color 0.2s",
    lineHeight: 1,
  },
  error: {
    backgroundColor: "rgba(246, 70, 93, 0.1)",
    color: "#F6465D",
    border: "1px solid rgba(246,70,93,0.25)",
    padding: "10px 14px",
    borderRadius: "2px",
    marginBottom: "16px",
    fontSize: "13px",
    textAlign: "center",
  },
  formMode: { display: "flex", flexDirection: "column", gap: "16px" },
  inputGroup: { display: "flex", flexDirection: "column", gap: "6px" },
  inputWrapper: { position: "relative", display: "flex", alignItems: "center" },
  inputIcon: {
    position: "absolute",
    left: "12px",
    color: "rgba(90, 242, 181, 0.5)",
    pointerEvents: "none",
  },
  label: { color: "rgba(255,255,255,0.5)", fontSize: "12px", letterSpacing: "0.08em", textTransform: "uppercase" },
  input: {
    width: "100%",
    boxSizing: "border-box",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    color: "white",
    padding: "12px 16px",
    borderRadius: "2px",
    outline: "none",
    fontSize: "15px",
    transition: "border 0.2s, box-shadow 0.2s",
    fontFamily: "inherit",
  },
  loginBtn: {
    backgroundColor: "#5AF2B5",
    color: "#0D0D0D",
    border: "none",
    padding: "14px",
    borderRadius: "2px",
    fontSize: "15px",
    fontWeight: "800",
    cursor: "pointer",
    marginTop: "8px",
    boxShadow: "0 0 20px rgba(90, 242, 181, 0.3)",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    transition: "background 0.2s, box-shadow 0.2s, transform 0.15s",
  },
  eyeBtn: {
    position: "absolute",
    right: "12px",
    background: "none",
    border: "none",
    padding: "0",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  eyeIcon: { color: "rgba(255, 255, 255, 0.35)", transition: "color 0.2s" },
  divider: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    margin: "20px 0 16px",
  },
  dividerLine: {
    flex: 1,
    height: "1px",
    background: "rgba(255,255,255,0.08)",
  },
  dividerText: {
    color: "rgba(255,255,255,0.25)",
    fontSize: "12px",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
  },
  footerLink: { textAlign: "center", fontSize: "14px" },
};
