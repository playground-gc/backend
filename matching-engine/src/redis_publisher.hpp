#pragma once

#include <hiredis/hiredis.h>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

/**
 * Thread-safe Redis publisher.
 *
 * Uses one hiredis connection per calling thread (thread-local pool keyed by
 * std::thread::id) so that multiple symbol worker threads can publish in
 * parallel without contention on a single connection.
 */
class RedisPublisher {
public:
    RedisPublisher(const std::string& host, int port);
    ~RedisPublisher();

    // PUBLISH channel message
    void publish(const std::string& channel, const std::string& message);

    // XADD stream * field value  (with MAXLEN ~ to cap stream size)
    void xadd(const std::string& stream,
              const std::string& field,
              const std::string& value,
              long long maxlen = 100000);

    // HSET key field value
    void hset(const std::string& key,
              const std::string& field,
              const std::string& value);

    // SET key value EX ttl_seconds
    void setex(const std::string& key, int ttl_seconds, const std::string& value);

private:
    std::string host_;
    int port_;

    std::mutex pool_mtx_;
    std::unordered_map<std::thread::id, redisContext*> pool_;

    redisContext* get_connection();
    redisContext* new_connection();
    void execute(redisContext* ctx, const char* fmt, ...);
};
