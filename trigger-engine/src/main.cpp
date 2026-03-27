#include "trigger_engine.hpp"
#include "pg_client.hpp"
#include "engine_client.hpp"
#include "redis_sub.hpp"

#include <chrono>
#include <csignal>
#include <cstdlib>
#include <iostream>
#include <string>
#include <thread>
#include <vector>

#include <yaml-cpp/yaml.h>

// ─── Globals for signal handler ───────────────────────────────────────────────

static TriggerEngine* g_engine = nullptr;

static void handle_signal(int sig) {
    std::cout << "\n[main] Signal " << sig << " – shutting down...\n";
    if (g_engine) g_engine->shutdown();
    std::exit(0);
}

// ─── main ────────────────────────────────────────────────────────────────────

int main() {
    // ── Environment variables ─────────────────────────────────────────────────
    const char* redis_host_env  = std::getenv("REDIS_HOST");
    const char* redis_port_env  = std::getenv("REDIS_PORT");
    const char* engine_host_env = std::getenv("ENGINE_HOST");
    const char* engine_port_env = std::getenv("ENGINE_PORT");
    const char* postgres_url    = std::getenv("POSTGRES_URL");
    const char* stocks_cfg_env  = std::getenv("STOCKS_CONFIG");

    std::string redis_host   = redis_host_env  ? redis_host_env  : "127.0.0.1";
    int         redis_port   = redis_port_env  ? std::stoi(redis_port_env)  : 6379;
    std::string engine_host  = engine_host_env ? engine_host_env : "127.0.0.1";
    int         engine_port  = engine_port_env ? std::stoi(engine_port_env) : 9000;
    std::string pg_url       = postgres_url    ? postgres_url    : "postgresql://synthbull:synthbull_pass@localhost:5432/synthbull";
    std::string stocks_cfg   = stocks_cfg_env  ? stocks_cfg_env  : "/shared/stocks.yaml";

    std::cout << "[main] Redis:  " << redis_host  << ":" << redis_port  << "\n";
    std::cout << "[main] Engine: " << engine_host << ":" << engine_port << "\n";
    std::cout << "[main] PG URL: " << pg_url      << "\n";
    std::cout << "[main] Stocks: " << stocks_cfg  << "\n";

    // ── Load symbol list from stocks.yaml ────────────────────────────────────
    YAML::Node config;
    try {
        config = YAML::LoadFile(stocks_cfg);
    } catch (const std::exception& e) {
        std::cerr << "[main] Failed to load stocks config: " << e.what() << "\n";
        return 1;
    }

    std::vector<std::string> symbols;
    for (const auto& stock : config["stocks"]) {
        symbols.push_back(stock["symbol"].as<std::string>());
    }
    std::cout << "[main] Loaded " << symbols.size() << " symbols\n";

    // ── Connect to PostgreSQL ─────────────────────────────────────────────────
    PgClient pg(pg_url);
    try {
        pg.connect();
    } catch (const std::exception& e) {
        std::cerr << "[main] PostgreSQL error: " << e.what() << "\n";
        return 1;
    }

    // ── Connect to Matching Engine (TCP) ─────────────────────────────────────
    EngineClient eng(engine_host, engine_port);
    eng.connect();   // blocks with backoff until connected

    // ── Create Redis subscriber / publisher ───────────────────────────────────
    RedisSub redis(redis_host, redis_port);

    // ── Create and initialize Trigger Engine ──────────────────────────────────
    TriggerEngine engine(pg, eng, redis);
    g_engine = &engine;

    engine.initialize(symbols);

    // ── Signal handlers ───────────────────────────────────────────────────────
    std::signal(SIGTERM, handle_signal);
    std::signal(SIGINT,  handle_signal);

    // ── Start (blocks on Redis subscriber thread) ─────────────────────────────
    std::cout << "[main] Trigger engine ready\n";
    engine.run();

    // Block main thread – Redis subscriber and expiry sweeper run in background
    while (true) {
        std::this_thread::sleep_for(std::chrono::seconds(60));
    }

    return 0;
}
