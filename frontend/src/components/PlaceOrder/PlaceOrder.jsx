import React, { useState, useEffect } from "react";
import { useOrderSubmit } from "../../hooks/useOrderSubmit";
import { usePortfolio } from "../../hooks/usePortfolio";
import { dataManager } from "../../services/dataManager";
import { useNotificationStore } from "../../store";
import AuthModal from "../AuthModal/AuthModal";

// Must be defined OUTSIDE the parent component so React doesn't
// treat it as a new component type on every render (which would
// unmount/remount the <input> and kill keyboard focus).
function InputRow({ label, value, onChange, disabled, placeholder, suffix }) {
  return (
    <div style={styles.inputGroup}>
      <span style={styles.prefix}>{label}</span>
      <input
        style={styles.input}
        disabled={disabled}
        placeholder={placeholder || ""}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span style={styles.suffix}>{suffix}</span>
    </div>
  );
}

export default function PlaceOrder({ symbol, isAuthenticated }) {
  const addNotification = useNotificationStore((s) => s.addNotification);
  const { submit } = useOrderSubmit();
  const { cashBalance, holdings, refresh } = usePortfolio(isAuthenticated);
  const [orderType, setOrderType] = useState("Limit");

  // Limit / Market
  const [price, setPrice] = useState("");
  // Stop Limit / Stop Market
  const [stopPrice, setStopPrice] = useState("");
  const [limitPrice, setLimitPrice] = useState("");

  const [amountBuy, setAmountBuy] = useState("");
  const [amountSell, setAmountSell] = useState("");

  const [currentPrice, setCurrentPrice] = useState(0);
  const [buyError, setBuyError] = useState("");
  const [sellError, setSellError] = useState("");
  const [isBuying, setIsBuying] = useState(false);
  const [isSelling, setIsSelling] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const availableBalanceUSD = cashBalance;
  const heldPosition = holdings.find((h) => h.symbol === symbol);
  const availableBalanceCrypto = heldPosition ? heldPosition.quantity : 0;

  const isStopOrder = orderType === "Stop Limit" || orderType === "Stop Market";
  const isStopLimit = orderType === "Stop Limit";
  const isMarket = orderType === "Market";
  const isLimit = orderType === "Limit";

  useEffect(() => {
    const unsub = dataManager.subscribe(symbol, (data) => {
      setCurrentPrice(data.ticker.price);
      // Removed autofill to prevent overwriting user input
    });
    return unsub;
  }, [symbol]);

  const handleBuyPct = (pct) => {
    const activePrice = isMarket
      ? currentPrice
      : isStopOrder
        ? parseFloat(limitPrice) || parseFloat(stopPrice) || currentPrice
        : parseFloat(price) || currentPrice;
    const calculatedAmt = (availableBalanceUSD * (pct / 100)) / activePrice;
    setAmountBuy(calculatedAmt.toFixed(4));
  };

  const handleSellPct = (pct) => {
    setAmountSell((availableBalanceCrypto * (pct / 100)).toFixed(4));
  };

  const validateStopFields = (setter) => {
    if (!parseFloat(stopPrice) || parseFloat(stopPrice) <= 0) {
      setter("Enter a valid stop price");
      return false;
    }
    if (
      isStopLimit &&
      (!parseFloat(limitPrice) || parseFloat(limitPrice) <= 0)
    ) {
      setter("Enter a valid limit price");
      return false;
    }
    return true;
  };

  const typeMap = {
    Limit: "limit",
    Market: "market",
    "Stop Limit": "stop_limit",
    "Stop Market": "stop_market",
  };

  const placeBuy = async () => {
    setBuyError("");
    const qty = parseFloat(amountBuy);
    if (!qty || qty <= 0) {
      setBuyError("Enter a valid amount");
      return;
    }
    if (isLimit && (!parseFloat(price) || parseFloat(price) <= 0)) {
      setBuyError("Enter a valid price");
      return;
    }
    if (isStopOrder && !validateStopFields(setBuyError)) return;

    setIsBuying(true);
    const result = await submit({
      symbol,
      type: typeMap[orderType],
      side: "buy",
      price: isLimit ? price : undefined,
      stop_price: isStopOrder ? stopPrice : undefined,
      limit_price: isStopLimit ? limitPrice : undefined,
      quantity: qty,
    });
    setIsBuying(false);
    if (result.success) {
      addNotification(`Buy order for ${qty} ${baseAsset} placed at ${isLimit ? price : "Market"}`, "buy");
      setAmountBuy("");
      setTimeout(refresh, 1000);
    } else {
      setBuyError(result.error || "Order failed");
    }
  };

  const placeSell = async () => {
    setSellError("");
    const qty = parseFloat(amountSell);
    if (!qty || qty <= 0) {
      setSellError("Enter a valid amount");
      return;
    }
    if (isLimit && (!parseFloat(price) || parseFloat(price) <= 0)) {
      setSellError("Enter a valid price");
      return;
    }
    if (isStopOrder && !validateStopFields(setSellError)) return;

    setIsSelling(true);
    const result = await submit({
      symbol,
      type: typeMap[orderType],
      side: "sell",
      price: isLimit ? price : undefined,
      stop_price: isStopOrder ? stopPrice : undefined,
      limit_price: isStopLimit ? limitPrice : undefined,
      quantity: qty,
    });
    setIsSelling(false);
    if (result.success) {
      addNotification(`Sell order for ${qty} ${baseAsset} placed at ${isLimit ? price : "Market"}`, "sell");
      setAmountSell("");
      setTimeout(refresh, 1000);
    } else {
      setSellError(result.error || "Order failed");
    }
  };

  const baseAsset = symbol.replace("_S", "");
  const quoteAsset = "USD";

  return (
    <div id="tour-place-order" style={styles.container}>
      {showAuthModal && (
        <AuthModal
          initialSignUp={false}
          onClose={() => setShowAuthModal(false)}
          onSuccess={() => { setShowAuthModal(false); window.location.reload(); }}
        />
      )}
      {/* Order-type tabs */}
      <div style={styles.tabsStrip}>
        {["Limit", "Market", "Stop Limit", "Stop Market"].map((t) => (
          <span
            key={t}
            style={{
              ...styles.tab,
              color: orderType === t ? "#5AF2B5" : "rgba(255, 255, 255, 0.5)",
              borderBottom:
                orderType === t ? "2px solid #5AF2B5" : "2px solid transparent",
              textShadow:
                orderType === t ? "0 0 8px rgba(90, 242, 181, 0.4)" : "none",
            }}
            onClick={() => setOrderType(t)}
          >
            {t}
          </span>
        ))}
      </div>

      <div style={styles.formsContainer}>
        {/* ── BUY COLUMN ── */}
        <div style={styles.formCol}>
          <div style={styles.balanceRow}>
            <span style={styles.balanceAvbl}>Avl</span>
            <span>
              {availableBalanceUSD.toLocaleString()} {quoteAsset}
            </span>
          </div>

          {/* Limit price */}
          {isLimit && (
            <InputRow
              label="Price"
              value={price}
              onChange={setPrice}
              suffix={quoteAsset}
            />
          )}

          {/* Market — no price input */}
          {isMarket && (
            <InputRow
              label="Price"
              value=""
              onChange={() => {}}
              disabled
              placeholder="Market"
              suffix={quoteAsset}
            />
          )}

          {/* Stop fields */}
          {isStopOrder && (
            <>
              <InputRow
                label="Stop"
                value={stopPrice}
                onChange={setStopPrice}
                suffix={quoteAsset}
                placeholder="Trigger price"
              />
              {isStopLimit && (
                <InputRow
                  label="Limit"
                  value={limitPrice}
                  onChange={setLimitPrice}
                  suffix={quoteAsset}
                  placeholder="Limit price after trigger"
                />
              )}
            </>
          )}

          <InputRow
            label="Volume"
            value={amountBuy}
            onChange={setAmountBuy}
            suffix={baseAsset}
          />

          <div style={styles.sliderContainer}>
            <div style={styles.sliderLine} />
            {[0, 25, 50, 75, 100].map((pct) => (
              <div
                key={`buy-pct-${pct}`}
                style={styles.diamond}
                onClick={() => handleBuyPct(pct)}
                title={`${pct}%`}
              />
            ))}
          </div>

          {isStopOrder && (
            <div style={styles.stopHint}>
              {orderType === "Stop Limit"
                ? "When market hits Stop → limit order at Limit price"
                : "When market hits Stop → market order executes"}
            </div>
          )}

          {buyError && <div style={styles.errorMsg}>{buyError}</div>}
          <button
            style={{
              ...styles.buyBtn,
              opacity: isBuying ? 0.5 : 1,
              cursor: isBuying ? "not-allowed" : "pointer",
            }}
            onClick={isAuthenticated ? placeBuy : () => setShowAuthModal(true)}
            disabled={isBuying}
            title={!isAuthenticated ? "Sign in to trade" : ""}
          >
            {isBuying
              ? "Placing…"
              : !isAuthenticated
                ? "Login to Buy"
                : `Buy ${baseAsset}`}
          </button>
        </div>

        {/* ── SELL COLUMN ── */}
        <div style={styles.formCol}>
          <div style={styles.balanceRow}>
            <span style={styles.balanceAvbl}>Avl</span>
            <span>
              {availableBalanceCrypto.toLocaleString()} {baseAsset}
            </span>
          </div>

          {isLimit && (
            <InputRow
              label="Price"
              value={price}
              onChange={setPrice}
              suffix={quoteAsset}
            />
          )}

          {isMarket && (
            <InputRow
              label="Price"
              value=""
              onChange={() => {}}
              disabled
              placeholder="Market"
              suffix={quoteAsset}
            />
          )}

          {isStopOrder && (
            <>
              <InputRow
                label="Stop"
                value={stopPrice}
                onChange={setStopPrice}
                suffix={quoteAsset}
                placeholder="Trigger price"
              />
              {isStopLimit && (
                <InputRow
                  label="Limit"
                  value={limitPrice}
                  onChange={setLimitPrice}
                  suffix={quoteAsset}
                  placeholder="Limit price after trigger"
                />
              )}
            </>
          )}

          <InputRow
            label="Volume"
            value={amountSell}
            onChange={setAmountSell}
            suffix={baseAsset}
          />

          <div style={styles.sliderContainer}>
            <div style={styles.sliderLine} />
            {[0, 25, 50, 75, 100].map((pct) => (
              <div
                key={`sell-pct-${pct}`}
                style={styles.diamond}
                onClick={() => handleSellPct(pct)}
                title={`${pct}%`}
              />
            ))}
          </div>

          {isStopOrder && (
            <div style={styles.stopHint}>
              {orderType === "Stop Limit"
                ? "When market hits Stop → limit order at Limit price"
                : "When market hits Stop → market order executes"}
            </div>
          )}

          {sellError && <div style={styles.errorMsg}>{sellError}</div>}
          <button
            style={{
              ...styles.sellBtn,
              opacity: isSelling ? 0.5 : 1,
              cursor: isSelling ? "not-allowed" : "pointer",
            }}
            onClick={isAuthenticated ? placeSell : () => setShowAuthModal(true)}
            disabled={isSelling}
            title={!isAuthenticated ? "Sign in to trade" : ""}
          >
            {isSelling
              ? "Placing…"
              : !isAuthenticated
                ? "Login to Sell"
                : `Sell ${baseAsset}`}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    padding: "16px 20px",
    display: "flex",
    flexDirection: "column",
    height: "100%",
    background: "transparent",
    backdropFilter: "blur(10px)",
  },
  tabsStrip: {
    display: "flex",
    gap: "16px",
    fontWeight: "600",
    fontSize: "12px",
    marginBottom: "16px",
    flexWrap: "wrap",
    textTransform: "uppercase",
    letterSpacing: "1px",
  },
  tab: { cursor: "pointer", paddingBottom: "6px", transition: "all 0.2s" },
  formsContainer: { display: "flex", gap: "20px", flex: 1, flexWrap: "wrap" },
  formCol: { flex: 1, minWidth: "260px", display: "flex", flexDirection: "column", gap: "10px" },
  balanceRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "11px",
    marginBottom: "4px",
    fontWeight: "500",
  },
  balanceAvbl: { color: "rgba(255, 255, 255, 0.5)" },
  inputGroup: {
    display: "flex",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: "0px",
    padding: "8px 12px",
    height: "38px",
    transition: "border-color 0.2s",
  },
  prefix: {
    color: "rgba(255, 255, 255, 0.5)",
    fontSize: "12px",
    width: "50px",
    flexShrink: 0,
  },
  input: {
    flex: 1,
    background: "transparent",
    border: "none",
    color: "white",
    outline: "none",
    textAlign: "right",
    fontFamily: "inherit",
    fontSize: "13px",
    width: "100%",
    userSelect: "text",
    pointerEvents: "auto",
    fontWeight: "600",
  },
  suffix: {
    color: "rgba(255, 255, 255, 0.8)",
    fontSize: "12px",
    marginLeft: "8px",
    fontWeight: "600",
  },
  sliderContainer: {
    position: "relative",
    height: "16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    margin: "8px 0",
  },
  sliderLine: {
    position: "absolute",
    top: "7px",
    left: "4px",
    right: "4px",
    height: "2px",
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    zIndex: 0,
  },
  diamond: {
    width: "10px",
    height: "10px",
    transform: "rotate(45deg)",
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    border: "1px solid #000",
    zIndex: 1,
    cursor: "pointer",
    transition: "background-color 0.2s",
  },
  stopHint: {
    fontSize: "11px",
    color: "rgba(255, 255, 255, 0.4)",
    lineHeight: "1.4",
    marginTop: "4px",
  },
  buyBtn: {
    backgroundColor: "rgba(14, 203, 129, 0.1)",
    color: "#0ecb81",
    border: "1px solid rgba(14, 203, 129, 0.3)",
    borderRadius: "0px",
    height: "40px",
    fontWeight: "700",
    fontSize: "14px",
    cursor: "pointer",
    marginTop: "auto",
    textTransform: "uppercase",
    letterSpacing: "1px",
    transition: "all 0.2s",
  },
  sellBtn: {
    backgroundColor: "rgba(246, 70, 93, 0.1)",
    color: "#f6465d",
    border: "1px solid rgba(246, 70, 93, 0.3)",
    borderRadius: "0px",
    height: "40px",
    fontWeight: "700",
    fontSize: "14px",
    cursor: "pointer",
    marginTop: "auto",
    textTransform: "uppercase",
    letterSpacing: "1px",
    transition: "all 0.2s",
  },
  errorMsg: {
    color: "#f6465d",
    fontSize: "11px",
    textAlign: "center",
    backgroundColor: "rgba(246, 70, 93, 0.1)",
    padding: "4px",
    borderRadius: "0px",
  },
};
