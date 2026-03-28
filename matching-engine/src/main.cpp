#include "matching_engine.hpp"
#include "redis_publisher.hpp"
#include "tcp_server.hpp"
#include "lf_queue.hpp"
#include "lob_types.hpp"
#include "lob_matching_engine.hpp"

#include <csignal>
#include <cstdlib>
#include <iostream>
#include <string>
#include <thread>
#include <vector>

#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include <pthread.h>
#include <sched.h>

#include <yaml-cpp/yaml.h>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

// ─── Queue sizes ─────────────────────────────────────────────────────────────
static constexpr size_t QUEUE_CAPACITY      = 1'000'000;
static constexpr size_t MAX_PRICE_TICKS     = 10'000;
static constexpr size_t MAX_ENTRIES_PRICE   = 400;

// ─── Globals for signal handler ──────────────────────────────────────────────
static MatchingEngine*     g_engine  = nullptr;
static TCPServer*          g_server  = nullptr;
static std::atomic<bool>*  g_terminate_lob = nullptr;

static void handle_signal(int sig) {
    std::cout << "\n[main] Signal " << sig << " received – shutting down...\n";
    if (g_server)        g_server->stop();
    if (g_engine)        g_engine->shutdown();
    if (g_terminate_lob) g_terminate_lob->store(true, std::memory_order_release);
    std::exit(0);
}

// ─── Helper: pin thread to a CPU core ────────────────────────────────────────
static void pin_thread(std::thread& t, int core_id) {
    cpu_set_t cpuset;
    CPU_ZERO(&cpuset);
    CPU_SET(core_id, &cpuset);
    int rc = pthread_setaffinity_np(t.native_handle(), sizeof(cpuset), &cpuset);
    if (rc != 0)
        std::cerr << "[main] Warning: could not pin thread to core " << core_id << "\n";
}

// ─── Bridge thread: drain broadcast queue → Redis ─────────────────────────────
// Converts BroadcastElement events into Redis orderbook/trade publications so
// the existing Python services (WebSocket service, candle service) keep working.
static void broadcast_bridge(LFQueue<BroadcastElement>*  bq,
                              LFQueue<LOBAcknowledgement>* aq,
                              RedisPublisher*              publisher,
                              std::atomic<bool>&           terminate,
                              const std::string&           symbol) {
    while (!terminate.load(std::memory_order_acquire)) {
        // ── drain broadcast queue ─────────────────────────────────────────────
        BroadcastElement* be = bq->getNextRead();
        if (be != nullptr) {
            if (be->type == 'T') {
                // Trade event
                json j;
                j["event"]    = "trade";
                j["trade_id"] = std::to_string(be->system_id);
                j["symbol"]   = symbol;
                j["price"]    = be->price;
                j["quantity"] = be->quantity;
                j["side"]     = std::string(1, be->side);
                j["timestamp"] = std::chrono::duration_cast<std::chrono::milliseconds>(
                    std::chrono::system_clock::now().time_since_epoch()).count();
                std::string msg = j.dump();
                publisher->publish("trades:" + symbol, msg);
                publisher->xadd("stream:trades", "data", msg);
                publisher->hset("price:" + symbol, "price",    std::to_string(be->price));
                publisher->hset("price:" + symbol, "volume",   std::to_string(be->quantity));
            }
            bq->updateRead();
        }

        // ── drain ack queue (discard — routing handled by API gateway) ────────
        LOBAcknowledgement* ack = aq->getNextRead();
        if (ack != nullptr) aq->updateRead();
    }
}

// ─── main ────────────────────────────────────────────────────────────────────

int main() {
    // ── Config from environment ───────────────────────────────────────────────
    const char* redis_host_env   = std::getenv("REDIS_HOST");
    const char* redis_port_env   = std::getenv("REDIS_PORT");
    const char* engine_port_env  = std::getenv("ENGINE_PORT");
    const char* stocks_config_env = std::getenv("STOCKS_CONFIG");
    const char* lob_core_env     = std::getenv("LOB_ENGINE_CORE");

    std::string redis_host    = redis_host_env   ? redis_host_env   : "127.0.0.1";
    int         redis_port    = redis_port_env   ? std::stoi(redis_port_env)  : 6379;
    int         engine_port   = engine_port_env  ? std::stoi(engine_port_env) : 9000;
    std::string stocks_config = stocks_config_env ? stocks_config_env : "/shared/stocks.yaml";
    int         lob_core      = lob_core_env     ? std::stoi(lob_core_env)   : 2;

    std::cout << "[main] Redis: "         << redis_host << ":" << redis_port << "\n";
    std::cout << "[main] Engine TCP port: " << engine_port << "\n";
    std::cout << "[main] Stocks config: "   << stocks_config << "\n";
    std::cout << "[main] LOB engine core: " << lob_core << "\n";

    // ── Load stocks ───────────────────────────────────────────────────────────
    YAML::Node config;
    try {
        config = YAML::LoadFile(stocks_config);
    } catch (const std::exception& e) {
        std::cerr << "[main] Failed to load stocks config: " << e.what() << "\n";
        return 1;
    }

    std::vector<std::string> symbols;
    for (const auto& stock : config["stocks"])
        symbols.push_back(stock["symbol"].as<std::string>());

    std::cout << "[main] Loaded " << symbols.size() << " symbols\n";
    const std::string primary_symbol = symbols.empty() ? "UNKNOWN" : symbols[0];

    // ── Redis publisher ───────────────────────────────────────────────────────
    RedisPublisher publisher(redis_host, redis_port);

    // ─────────────────────────────────────────────────────────────────────────
    // LOB Matching Engine (Capitol Architecture)
    // ─────────────────────────────────────────────────────────────────────────

    // Allocate queues on the heap so they outlive all threads
    auto* lobOrderQueue  = new LFQueue<LOBOrder>           (QUEUE_CAPACITY);
    auto* lobAckQueue    = new LFQueue<LOBAcknowledgement> (QUEUE_CAPACITY);
    auto* broadcastQueue = new LFQueue<BroadcastElement>   (QUEUE_CAPACITY);
    auto* lobLogQueue    = new LFQueue<LogElement>         (QUEUE_CAPACITY);

    LOBMatchingEngine lobEngine(MAX_PRICE_TICKS, MAX_ENTRIES_PRICE,
                                lobOrderQueue, lobAckQueue,
                                broadcastQueue, lobLogQueue);

    std::atomic<bool> start_lob    {false};
    std::atomic<bool> terminate_lob{false};
    g_terminate_lob = &terminate_lob;

    // Spawn LOB engine on its dedicated core
    std::thread lob_thread([&]() {
        lobEngine.matchingEngineLoop(start_lob, terminate_lob);
    });
    pin_thread(lob_thread, lob_core);
    std::cout << "[main] LOB engine thread pinned to core " << lob_core << "\n";

    // Spawn bridge thread (drains broadcast/ack queues → Redis)
    std::thread bridge_thread(broadcast_bridge,
                              broadcastQueue, lobAckQueue,
                              &publisher, std::ref(terminate_lob),
                              primary_symbol);

    // ─────────────────────────────────────────────────────────────────────────
    // Legacy Matching Engine (existing per-symbol worker threads + TCP)
    // ─────────────────────────────────────────────────────────────────────────

    MatchingEngine engine(publisher);
    g_engine = &engine;

    for (const auto& sym : symbols)
        engine.add_symbol(sym);

    // TCP server now also feeds the LOB order queue
    TCPServer server(engine_port, engine, lobOrderQueue);
    g_server = &server;

    // ── Signal handlers ───────────────────────────────────────────────────────
    std::signal(SIGTERM, handle_signal);
    std::signal(SIGINT,  handle_signal);

    // ── Release the LOB engine ────────────────────────────────────────────────
    start_lob.store(true, std::memory_order_release);
    std::cout << "[main] LOB engine started\n";

    // ── Start TCP server (blocks) ─────────────────────────────────────────────
    std::cout << "[main] Matching engine ready\n";
    server.start();

    // ── Shutdown ──────────────────────────────────────────────────────────────
    terminate_lob.store(true, std::memory_order_release);
    if (lob_thread.joinable())    lob_thread.join();
    if (bridge_thread.joinable()) bridge_thread.join();

    delete lobOrderQueue;
    delete lobAckQueue;
    delete broadcastQueue;
    delete lobLogQueue;

    return 0;
}
