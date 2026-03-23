#include "redis_publisher.hpp"

#include <cstdarg>
#include <cstdio>
#include <stdexcept>
#include <iostream>

RedisPublisher::RedisPublisher(const std::string& host, int port)
    : host_(host), port_(port) {}

RedisPublisher::~RedisPublisher() {
    std::lock_guard<std::mutex> lock(pool_mtx_);
    for (auto& [id, ctx] : pool_) {
        if (ctx) redisFree(ctx);
    }
}

redisContext* RedisPublisher::new_connection() {
    struct timeval timeout = {2, 0};  // 2 second connect timeout
    redisContext* ctx = redisConnectWithTimeout(host_.c_str(), port_, timeout);
    if (!ctx || ctx->err) {
        std::string err = ctx ? ctx->errstr : "allocation failed";
        if (ctx) redisFree(ctx);
        throw std::runtime_error("Redis connect failed: " + err);
    }
    return ctx;
}

redisContext* RedisPublisher::get_connection() {
    auto tid = std::this_thread::get_id();
    std::lock_guard<std::mutex> lock(pool_mtx_);
    auto it = pool_.find(tid);
    if (it == pool_.end() || it->second == nullptr) {
        pool_[tid] = new_connection();
    }
    return pool_[tid];
}

void RedisPublisher::publish(const std::string& channel, const std::string& message) {
    try {
        redisContext* ctx = get_connection();
        redisReply* reply = static_cast<redisReply*>(
            redisCommand(ctx, "PUBLISH %s %b",
                         channel.c_str(),
                         message.data(), message.size()));
        if (reply) freeReplyObject(reply);
    } catch (const std::exception& e) {
        std::cerr << "[RedisPublisher] publish error: " << e.what() << "\n";
    }
}

void RedisPublisher::xadd(const std::string& stream,
                          const std::string& field,
                          const std::string& value,
                          long long maxlen) {
    try {
        redisContext* ctx = get_connection();
        redisReply* reply = static_cast<redisReply*>(
            redisCommand(ctx,
                         "XADD %s MAXLEN ~ %lld * %s %b",
                         stream.c_str(),
                         maxlen,
                         field.c_str(),
                         value.data(), value.size()));
        if (reply) freeReplyObject(reply);
    } catch (const std::exception& e) {
        std::cerr << "[RedisPublisher] xadd error: " << e.what() << "\n";
    }
}

void RedisPublisher::hset(const std::string& key,
                          const std::string& field,
                          const std::string& value) {
    try {
        redisContext* ctx = get_connection();
        redisReply* reply = static_cast<redisReply*>(
            redisCommand(ctx, "HSET %s %s %b",
                         key.c_str(),
                         field.c_str(),
                         value.data(), value.size()));
        if (reply) freeReplyObject(reply);
    } catch (const std::exception& e) {
        std::cerr << "[RedisPublisher] hset error: " << e.what() << "\n";
    }
}

void RedisPublisher::setex(const std::string& key, int ttl, const std::string& value) {
    try {
        redisContext* ctx = get_connection();
        redisReply* reply = static_cast<redisReply*>(
            redisCommand(ctx, "SETEX %s %d %b",
                         key.c_str(),
                         ttl,
                         value.data(), value.size()));
        if (reply) freeReplyObject(reply);
    } catch (const std::exception& e) {
        std::cerr << "[RedisPublisher] setex error: " << e.what() << "\n";
    }
}
