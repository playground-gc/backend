import React from "react";
import { useNotificationStore } from "../../store/notificationStore";
import { X, CheckCircle, AlertTriangle, Info, Zap } from "lucide-react";

export default function ToastContainer() {
  const { notifications, removeNotification } = useNotificationStore();

  if (notifications.length === 0) return null;

  return (
    <div style={styles.container}>
      {notifications.map((n) => (
        <ToastItem key={n.id} notification={n} onRemove={() => removeNotification(n.id)} />
      ))}
    </div>
  );
}

function ToastItem({ notification, onRemove }) {
  const isError = notification.type === "error";
  const isSell = notification.type === "sell";
  const accentColor = (isError || isSell) ? "#F6465D" : "#5AF2B5";
  const Icon = isError ? AlertTriangle : CheckCircle;

  return (
    <div style={{ 
      ...styles.toast, 
      borderLeft: `4px solid ${accentColor}`,
      boxShadow: `0 8px 32px rgba(0,0,0,0.4), 0 0 10px ${accentColor}15`,
      animation: "toastSlideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards"
    }}>
      <div style={{ ...styles.iconGlow, background: `${accentColor}20` }}>
        <Icon size={20} color={accentColor} style={{ filter: `drop-shadow(0 0 4px ${accentColor})` }} />
      </div>
      <div style={styles.content}>
        <div style={{ ...styles.title, color: accentColor }}>
          {isError ? "ORDER REJECTED" : isSell ? "SELL ORDER EXECUTED" : "BUY ORDER EXECUTED"}
        </div>
        <div style={styles.message}>{notification.message}</div>
      </div>
      <button 
        style={styles.closeBtn} 
        onClick={onRemove}
        onMouseOver={e => e.currentTarget.style.opacity = 1}
        onMouseOut={e => e.currentTarget.style.opacity = 0.5}
      >
        <X size={14} color="#fff" />
      </button>
      
      {/* Animated progress bar */}
      <div style={{ 
        ...styles.progress, 
        backgroundColor: accentColor, 
        boxShadow: `0 0 10px ${accentColor}`,
        animation: "toastProgress 4s linear forwards" 
      }} />
    </div>
  );
}

const styles = {
  container: {
    position: "fixed",
    top: "84px",
    right: "24px",
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    zIndex: 20000,
    pointerEvents: "none",
  },
  toast: {
    position: "relative",
    width: "340px",
    backgroundColor: "rgba(10, 14, 26, 0.92)",
    backdropFilter: "blur(16px)",
    borderRadius: "2px",
    padding: "18px 20px",
    display: "flex",
    alignItems: "center",
    gap: "16px",
    border: "1px solid rgba(255,255,255,0.03)",
    overflow: "hidden",
    pointerEvents: "auto",
  },
  iconGlow: {
    width: "36px",
    height: "36px",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  content: { flex: 1, paddingRight: "10px" },
  title: {
    fontSize: "11px",
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: "0.15em",
    marginBottom: "4px",
  },
  message: {
    fontSize: "13px",
    color: "#e2e2e2",
    lineHeight: "1.4",
    fontWeight: "500",
  },
  closeBtn: {
    background: "transparent",
    border: "none",
    padding: "6px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.5,
    transition: "all 0.2s",
    marginTop: "-20px",
    marginRight: "-8px",
  },
  progress: {
    position: "absolute",
    bottom: 0,
    left: 0,
    height: "2px",
    opacity: 0.8,
  },
};

// Inject keyframes
const styleSheet = document.createElement("style");
styleSheet.textContent = `
  @keyframes toastSlideIn {
    from { transform: translateX(120%) scale(0.9); opacity: 0; }
    to { transform: translateX(0) scale(1); opacity: 1; }
  }
  @keyframes toastProgress {
    from { width: 100%; }
    to { width: 0%; }
  }
`;
document.head.appendChild(styleSheet);
