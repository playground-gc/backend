#include "matching_engine.hpp"
#include "redis_publisher.hpp"
#include "tcp_server.hpp"

#include <csignal>
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

#include <yaml-cpp/yaml.h>

// ─── Globals for signal handler ───────────────────────────────────────────────
static MatchingEngine* g_engine  = nullptr;
static TCPServer*      g_server  = nullptr;

static void handle_signal(int sig) {
    std::cout << "\n[main] Signal " << sig << " received – shutting down...\n";
    if (g_server)  g_server->stop();
    if (g_engine)  g_engine->shutdown();
    std::exit(0);
}

// ─── main ────────────────────────────────────────────────────────────────────

int main() {
    // ── Config from environment ───────────────────────────────────────────────
    const char* redis_host_env = std::getenv("REDIS_HOST");
    const char* redis_port_env = std::getenv("REDIS_PORT");
    const char* engine_port_env = std::getenv("ENGINE_PORT");
    const char* stocks_config_env = std::getenv("STOCKS_CONFIG");

    std::string redis_host   = redis_host_env   ? redis_host_env   : "127.0.0.1";
    int         redis_port   = redis_port_env   ? std::stoi(redis_port_env)  : 6379;
    int         engine_port  = engine_port_env  ? std::stoi(engine_port_env) : 9000;
    std::string stocks_config = stocks_config_env ? stocks_config_env : "/shared/stocks.yaml";

    std::cout << "[main] Redis: " << redis_host << ":" << redis_port << "\n";
    std::cout << "[main] Engine TCP port: " << engine_port << "\n";
    std::cout << "[main] Stocks config: " << stocks_config << "\n";

    // ── Load stocks ──────────────────────────────────────────────────────────
    YAML::Node config;
    try {
        config = YAML::LoadFile(stocks_config);
    } catch (const std::exception& e) {
        std::cerr << "[main] Failed to load stocks config: " << e.what() << "\n";
        return 1;
    }

    std::vector<std::string> symbols;
    for (const auto& stock : config["stocks"]) {
        symbols.push_back(stock["symbol"].as<std::string>());
    }
    std::cout << "[main] Loaded " << symbols.size() << " symbols\n";

    // ── Create publisher ─────────────────────────────────────────────────────
    RedisPublisher publisher(redis_host, redis_port);

    // ── Create matching engine ────────────────────────────────────────────────
    MatchingEngine engine(publisher);
    g_engine = &engine;

    for (const auto& sym : symbols) {
        engine.add_symbol(sym);
    }

    // ── Create TCP server ─────────────────────────────────────────────────────
    TCPServer server(engine_port, engine);
    g_server = &server;

    // ── Signal handlers ───────────────────────────────────────────────────────
    std::signal(SIGTERM, handle_signal);
    std::signal(SIGINT,  handle_signal);

    // ── Start (blocks) ────────────────────────────────────────────────────────
    std::cout << "[main] Matching engine ready\n";
    server.start();

    return 0;
}
