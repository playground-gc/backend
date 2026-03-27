#pragma once

#include <atomic>
#include <functional>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

// Forward declare hiredis types
struct redisContext;

// ─── Message callback types ────────────────────────────────────────────────────

// Called when a trade tick arrives on trades:{symbol}
using PriceTickCb = std::function<void(const std::string& symbol, double price)>;

// Called when a new stop order JSON arrives on stop_orders:new
using NewStopOrderCb = std::function<void(const std::string& json)>;

// Called when a cancel request JSON arrives on stop_orders:cancel
using CancelStopOrderCb = std::function<void(const std::string& json)>;

// ─── RedisSub ─────────────────────────────────────────────────────────────────
// Dedicated subscriber connection (subscribe mode, blocking redisGetReply loop).
// Runs on its own thread. Callbacks are invoked from that thread.
//
// Separate publisher connection used for PUBLISH commands (stop_triggered:*).

class RedisSub {
public:
    RedisSub(const std::string& host, int port);
    ~RedisSub();

    void set_price_tick_cb(PriceTickCb cb)          { price_tick_cb_    = std::move(cb); }
    void set_new_order_cb(NewStopOrderCb cb)         { new_order_cb_     = std::move(cb); }
    void set_cancel_order_cb(CancelStopOrderCb cb)   { cancel_order_cb_  = std::move(cb); }

    // Subscribe to all channels and start the listener thread
    void start(const std::vector<std::string>& symbols);

    // Publish a message on the given channel (uses separate publisher connection)
    void publish(const std::string& channel, const std::string& message);

    void stop();

private:
    std::string host_;
    int         port_;

    redisContext* sub_ctx_ = nullptr;   // subscriber connection (subscriber thread only)
    redisContext* pub_ctx_ = nullptr;   // publisher connection (guarded by pub_mtx_)
    std::mutex    pub_mtx_;

    std::thread       sub_thread_;
    std::atomic<bool> running_{false};

    PriceTickCb       price_tick_cb_;
    NewStopOrderCb    new_order_cb_;
    CancelStopOrderCb cancel_order_cb_;

    bool connect_sub(const std::vector<std::string>& symbols);
    bool connect_pub();
    void listener_loop(std::vector<std::string> symbols);
    void dispatch(const std::string& channel, const std::string& data);
};
