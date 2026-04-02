import React, { useEffect, useState } from "react";
import { dataManager } from "../../services/dataManager";

export default function OrderBook({ symbol }) {
  const [orderBook, setOrderBook] = useState({ bids: [], asks: [] });
  const [price, setPrice] = useState(0);
  const [isUp, setIsUp] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let lastPrice = 0;
    const unsub = dataManager.subscribe(symbol, (data) => {
      if (data.ticker.price > 0) {
        setLoading(false);
        setOrderBook(data.orderBook);
        setPrice(data.ticker.price);

        if (data.ticker.price !== lastPrice) {
          setIsUp(data.ticker.price >= lastPrice);
          lastPrice = data.ticker.price;
        }
      }
    });
    return unsub;
  }, [symbol]);

  // Safety Guard: Show a skeleton/loading state if no data has arrived yet
  if (loading || !price) {
    return (
      <div
        style={{
          ...styles.container,
          justifyContent: "center",
          alignItems: "center",
          color: "var(--color-text-muted)",
        }}
      >
        <div className="animate-pulse">
          Waiting for Market Data from Port 8001...
        </div>
      </div>
    );
  }

  const askRows = [...(orderBook.asks || [])].reverse().slice(0, 15);
  const bidRows = (orderBook.bids || []).slice(0, 15);

  // Calculate max total for the visual depth bars
  const maxTotal =
    Math.max(askRows[0]?.total || 1, bidRows[bidRows.length - 1]?.total || 1) *
    1.2;

  return (
    <div id="tour-order-book" style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={{ flex: 1, color: "rgba(255, 255, 255, 0.5)" }}>
          Price(USD)
        </div>
        <div
          style={{
            flex: 1,
            textAlign: "right",
            color: "rgba(255, 255, 255, 0.5)",
          }}
        >
          Size
        </div>
        <div
          style={{
            flex: 1,
            textAlign: "right",
            color: "rgba(255, 255, 255, 0.5)",
          }}
        >
          Total
        </div>
      </div>

      <div style={styles.orderList}>
        {/* Asks (Sells) - Red */}
        {askRows.map((ask, i) => {
          const pct = ask.total / maxTotal;
          const depthWidth = `${pct * 100}%`;
          return (
            <div
              key={`ask-${i}`}
              style={styles.row}
              onMouseOver={(e) =>
                (e.currentTarget.style.background = "rgba(255, 255, 255, 0.03)")
              }
              onMouseOut={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
            >
              <div style={styles.depthBarRed(depthWidth, pct)} />
              <div style={{ ...styles.cell, width: "33.3%", color: "#f6465d" }}>
                {ask.price.toFixed(2)}
              </div>
              <div
                style={{
                  ...styles.cell,
                  width: "33.3%",
                  textAlign: "right",
                  color: "rgba(255,255,255,0.8)",
                }}
              >
                {ask.size.toFixed(3)}
              </div>
              <div
                style={{
                  ...styles.cell,
                  width: "33.3%",
                  textAlign: "right",
                  color: "rgba(255,255,255,0.8)",
                }}
              >
                {ask.total.toFixed(3)}
              </div>
            </div>
          );
        })}

        {/* Spread / Current Price Row */}
        <div style={styles.spreadRow}>
          <span
            style={{
              fontSize: "20px",
              fontWeight: "800",
              color: isUp ? "#0ecb81" : "#f6465d",
              textShadow: isUp
                ? "0 0 10px rgba(14, 203, 129, 0.3)"
                : "0 0 10px rgba(246, 70, 93, 0.3)",
            }}
          >
            {price.toFixed(2)} {isUp ? <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ display: "inline-block", verticalAlign: "middle", marginRight: "2px" }}><path d="M12 4l8 16H4z"/></svg> : <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ display: "inline-block", verticalAlign: "middle", marginRight: "2px" }}><path d="M12 20L4 4h16z"/></svg>}
          </span>
          <span
            style={{
              fontSize: "11px",
              color: "rgba(255,255,255,0.4)",
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: "1px",
            }}
          >
            More Data
          </span>
        </div>

        {/* Bids (Buys) - Green */}
        {bidRows.map((bid, i) => {
          const pct = bid.total / maxTotal;
          const depthWidth = `${pct * 100}%`;
          return (
            <div
              key={`bid-${i}`}
              style={styles.row}
              onMouseOver={(e) =>
                (e.currentTarget.style.background = "rgba(255, 255, 255, 0.03)")
              }
              onMouseOut={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
            >
              <div style={styles.depthBarGreen(depthWidth, pct)} />
              <div style={{ ...styles.cell, width: "33.3%", color: "#0ecb81" }}>
                {bid.price.toFixed(2)}
              </div>
              <div
                style={{
                  ...styles.cell,
                  width: "33.3%",
                  textAlign: "right",
                  color: "rgba(255,255,255,0.8)",
                }}
              >
                {bid.size.toFixed(3)}
              </div>
              <div
                style={{
                  ...styles.cell,
                  width: "33.3%",
                  textAlign: "right",
                  color: "rgba(255,255,255,0.8)",
                }}
              >
                {bid.total.toFixed(3)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
  container: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    padding: "16px 0",
    fontSize: "12px",
    userSelect: "none",
    background: "transparent",
  },
  header: {
    display: "flex",
    padding: "0 20px 12px 20px",
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "1px",
    fontWeight: "600",
  },
  orderList: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
  },
  row: {
    display: "flex",
    position: "relative",
    padding: "4px 20px",
    cursor: "pointer",
    alignItems: "center",
    transition: "background 0.2s",
  },
  cell: { zIndex: 1, fontWeight: "500" },
  depthBarRed: (width, pct) => ({
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width,
    backgroundColor: `rgba(246, 70, 93, ${(0.05 + pct * 0.2).toFixed(3)})`,
    zIndex: 0,
  }),
  depthBarGreen: (width, pct) => ({
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width,
    backgroundColor: `rgba(14, 203, 129, ${(0.05 + pct * 0.2).toFixed(3)})`,
    zIndex: 0,
  }),
  spreadRow: {
    padding: "12px 20px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    borderTop: "1px solid rgba(255, 255, 255, 0.05)",
    borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
    margin: "8px 0",
    background: "transparent",
  },
};
