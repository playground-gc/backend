#include "gbm_generator.hpp"
#include "order_client.hpp"

#include <csignal>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <string>
#include <vector>

#include <yaml-cpp/yaml.h>

// ─── Global for signal handler ────────────────────────────────────────────────

static std::vector<std::unique_ptr<GBMGenerator>>* g_generators = nullptr;
static OrderClient* g_client = nullptr;

static void handle_signal(int sig) {
    std::cout << "\n[main] Signal " << sig << " – stopping generators...\n";
    if (g_generators)
        for (auto& gen : *g_generators) gen->stop();
    if (g_client) g_client->disconnect();
    std::exit(0);
}

// ─── main ─────────────────────────────────────────────────────────────────────

int main() {
    // ── Read environment variables ──────────────────────────────────────────
    auto getenv_or = [](const char* key, const char* fallback) -> std::string {
        const char* v = std::getenv(key);
        return v ? v : fallback;
    };

    std::string engine_host   = getenv_or("ENGINE_HOST",   "127.0.0.1");
    int         engine_port   = std::stoi(getenv_or("ENGINE_PORT",   "9000"));
    std::string redis_host    = getenv_or("REDIS_HOST",    "127.0.0.1");
    int         redis_port    = std::stoi(getenv_or("REDIS_PORT",    "6379"));
    std::string stocks_config = getenv_or("STOCKS_CONFIG", "/shared/stocks.yaml");
    int         market_tps    = std::stoi(getenv_or("MARKET_TPS",    "10"));

    std::cout << "[main] Engine:  " << engine_host  << ":" << engine_port  << "\n"
              << "[main] Redis:   " << redis_host   << ":" << redis_port   << "\n"
              << "[main] Stocks:  " << stocks_config << "\n"
              << "[main] TPS:     " << market_tps   << " tick/s  ("
              << (1000 / market_tps) << " ms per tick)\n";

    // ── Load stocks ──────────────────────────────────────────────────────────
    YAML::Node config;
    try {
        config = YAML::LoadFile(stocks_config);
    } catch (const std::exception& e) {
        std::cerr << "[main] Failed to load stocks config: " << e.what() << "\n";
        return 1;
    }

    std::vector<StockConfig> stocks;
    for (const auto& node : config["stocks"]) {
        StockConfig sc;
        sc.symbol        = node["symbol"].as<std::string>();
        sc.initial_price = node["initial_price"].as<double>();
        sc.drift         = node["drift"].as<double>();
        sc.volatility    = node["volatility"].as<double>();
        stocks.push_back(sc);
        std::cout << "[main] Stock: " << sc.symbol
                  << "  init=" << sc.initial_price
                  << "  μ=" << sc.drift
                  << "  σ=" << sc.volatility << "\n";
    }

    if (stocks.empty()) {
        std::cerr << "[main] No stocks found in config. Exiting.\n";
        return 1;
    }

    // ── Connect to matching engine ────────────────────────────────────────────
    OrderClient client(engine_host, engine_port);
    g_client = &client;

    if (!client.connect(20)) {
        std::cerr << "[main] Could not connect to matching engine. Exiting.\n";
        return 1;
    }

    // ── Create generators ─────────────────────────────────────────────────────
    std::vector<std::unique_ptr<GBMGenerator>> generators;
    g_generators = &generators;

    for (const auto& sc : stocks) {
        generators.emplace_back(
            std::make_unique<GBMGenerator>(sc, client, redis_host, redis_port, market_tps));
        generators.back()->start();
    }

    std::cout << "[main] " << generators.size()
              << " GBM generators running at " << market_tps << " ticks/sec\n";

    // ── Signal handlers ───────────────────────────────────────────────────────
    std::signal(SIGTERM, handle_signal);
    std::signal(SIGINT,  handle_signal);

    // ── Park main thread ──────────────────────────────────────────────────────
    while (true)
        std::this_thread::sleep_for(std::chrono::hours(1));

    return 0;
}
