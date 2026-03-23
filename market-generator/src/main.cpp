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
    if (g_generators) {
        for (auto& gen : *g_generators) gen->stop();
    }
    if (g_client) g_client->disconnect();
    std::exit(0);
}

// ─── main ────────────────────────────────────────────────────────────────────

int main() {
    const char* engine_host_env   = std::getenv("ENGINE_HOST");
    const char* engine_port_env   = std::getenv("ENGINE_PORT");
    const char* stocks_config_env = std::getenv("STOCKS_CONFIG");

    std::string engine_host  = engine_host_env  ? engine_host_env  : "127.0.0.1";
    int         engine_port  = engine_port_env  ? std::stoi(engine_port_env) : 9000;
    std::string stocks_config = stocks_config_env ? stocks_config_env : "/shared/stocks.yaml";

    std::cout << "[main] Engine: " << engine_host << ":" << engine_port << "\n";
    std::cout << "[main] Stocks config: " << stocks_config << "\n";

    // ── Load stocks ──────────────────────────────────────────────────────────
    YAML::Node config;
    try {
        config = YAML::LoadFile(stocks_config);
    } catch (const std::exception& e) {
        std::cerr << "[main] Failed to load stocks: " << e.what() << "\n";
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
                  << " init=" << sc.initial_price
                  << " μ=" << sc.drift
                  << " σ=" << sc.volatility << "\n";
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
        generators.emplace_back(std::make_unique<GBMGenerator>(sc, client));
        generators.back()->start();
    }

    std::cout << "[main] " << generators.size() << " GBM generators running\n";

    // ── Signal handlers ───────────────────────────────────────────────────────
    std::signal(SIGTERM, handle_signal);
    std::signal(SIGINT,  handle_signal);

    // ── Wait forever ─────────────────────────────────────────────────────────
    for (auto& gen : generators) {
        // join is done in stop(); block main thread by waiting on stop signal
    }

    // Park main thread
    while (true) {
        std::this_thread::sleep_for(std::chrono::hours(1));
    }

    return 0;
}
