#include "redis_sub.hpp"

#include <hiredis/hiredis.h>
#include <nlohmann/json.hpp>

#include <chrono>
#include <cstring>
#include <iostream>
#include <stdexcept>
#include <thread>
#include <unistd.h>

using json = nlohmann::json;

// ─── Constructor / Destructor ─────────────────────────────────────────────────

RedisSub::RedisSub(const std::string& host, int port)
    : host_(host), port_(port) {}

RedisSub::~RedisSub() {
    stop();
}

// ─── connect_sub ─────────────────────────────────────────────────────────────

bool RedisSub::connect_sub(const std::vector<std::string>& symbols) {
    if (sub_ctx_) { redisFree(sub_ctx_); sub_ctx_ = nullptr; }

    sub_ctx_ = redisConnect(host_.c_str(), port_);
    if (!sub_ctx_ || sub_ctx_->err) {
        std::cerr << "[RedisSub] Subscriber connect failed: "
                  << (sub_ctx_ ? sub_ctx_->errstr : "null") << "\n";
        return false;
    }

    // Subscribe to trades:{symbol} for each symbol
    for (const auto& sym : symbols) {
        std::string ch = "trades:" + sym;
        redisReply* r = (redisReply*)redisCommand(sub_ctx_, "SUBSCRIBE %s", ch.c_str());
        if (r) freeReplyObject(r);
    }

    // Subscribe to stop_orders control channels
    {
        redisReply* r = (redisReply*)redisCommand(sub_ctx_, "SUBSCRIBE stop_orders:new stop_orders:cancel");
        if (r) freeReplyObject(r);
    }

    std::cout << "[RedisSub] Subscriber connected, listening on "
              << symbols.size() << " symbol channels + stop_orders\n";
    return true;
}

// ─── connect_pub ─────────────────────────────────────────────────────────────

bool RedisSub::connect_pub() {
    if (pub_ctx_) { redisFree(pub_ctx_); pub_ctx_ = nullptr; }
    pub_ctx_ = redisConnect(host_.c_str(), port_);
    if (!pub_ctx_ || pub_ctx_->err) {
        std::cerr << "[RedisSub] Publisher connect failed: "
                  << (pub_ctx_ ? pub_ctx_->errstr : "null") << "\n";
        return false;
    }
    return true;
}

// ─── start ───────────────────────────────────────────────────────────────────

void RedisSub::start(const std::vector<std::string>& symbols) {
    connect_pub();
    running_ = true;
    sub_thread_ = std::thread(&RedisSub::listener_loop, this, symbols);
}

// ─── stop ────────────────────────────────────────────────────────────────────

void RedisSub::stop() {
    running_ = false;
    // Close the subscriber socket fd to interrupt the blocking redisGetReply call.
    // We must NOT call redisFree() here — that would free the context while the
    // subscriber thread is still inside redisGetReply() using it (use-after-free).
    // Closing just the fd causes redisGetReply to return REDIS_ERR, which lets
    // the thread exit cleanly. We free the context after joining.
    if (sub_ctx_ && sub_ctx_->fd >= 0) {
        ::close(sub_ctx_->fd);
        sub_ctx_->fd = -1;
    }
    if (sub_thread_.joinable()) sub_thread_.join();
    // Thread has exited — now safe to free contexts
    if (sub_ctx_) { redisFree(sub_ctx_); sub_ctx_ = nullptr; }
    {
        std::lock_guard<std::mutex> lk(pub_mtx_);
        if (pub_ctx_) { redisFree(pub_ctx_); pub_ctx_ = nullptr; }
    }
}

// ─── publish ─────────────────────────────────────────────────────────────────

void RedisSub::publish(const std::string& channel, const std::string& message) {
    std::lock_guard<std::mutex> lk(pub_mtx_);
    if (!pub_ctx_ || pub_ctx_->err) {
        if (!connect_pub()) return;
    }
    redisReply* r = (redisReply*)redisCommand(
        pub_ctx_, "PUBLISH %s %s", channel.c_str(), message.c_str());
    if (r) freeReplyObject(r);
}

// ─── listener_loop ────────────────────────────────────────────────────────────

void RedisSub::listener_loop(std::vector<std::string> symbols) {
    while (running_) {
        if (!connect_sub(symbols)) {
            std::this_thread::sleep_for(std::chrono::seconds(2));
            continue;
        }

        while (running_) {
            redisReply* reply = nullptr;
            int rc = redisGetReply(sub_ctx_, (void**)&reply);

            if (rc != REDIS_OK || !reply) {
                std::cerr << "[RedisSub] Connection lost, reconnecting...\n";
                if (reply) freeReplyObject(reply);
                break;  // outer loop will reconnect
            }

            // pub/sub message format: ["message", channel, data]
            if (reply->type == REDIS_REPLY_ARRAY && reply->elements == 3) {
                std::string type    = reply->element[0]->str ? reply->element[0]->str : "";
                std::string channel = reply->element[1]->str ? reply->element[1]->str : "";
                std::string data    = reply->element[2]->str ? reply->element[2]->str : "";

                if (type == "message" && !channel.empty() && !data.empty()) {
                    dispatch(channel, data);
                }
            }

            freeReplyObject(reply);
        }
    }
}

// ─── dispatch ─────────────────────────────────────────────────────────────────

void RedisSub::dispatch(const std::string& channel, const std::string& data) {
    try {
        // trades:{symbol} → price tick
        if (channel.rfind("trades:", 0) == 0) {
            if (price_tick_cb_) {
                auto j    = json::parse(data);
                double p  = j.at("price").get<double>();
                std::string sym = channel.substr(7); // strip "trades:"
                price_tick_cb_(sym, p);
            }
            return;
        }

        if (channel == "stop_orders:new") {
            if (new_order_cb_) new_order_cb_(data);
            return;
        }

        if (channel == "stop_orders:cancel") {
            if (cancel_order_cb_) cancel_order_cb_(data);
            return;
        }

    } catch (const std::exception& ex) {
        std::cerr << "[RedisSub] dispatch error on " << channel
                  << ": " << ex.what() << "\n";
    }
}
