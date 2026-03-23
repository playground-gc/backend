cmake_minimum_required(VERSION 3.20)
project(market_generator CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type")

# ─── Dependencies ─────────────────────────────────────────────────────────────

find_package(yaml-cpp REQUIRED)

include(FetchContent)
FetchContent_Declare(
    nlohmann_json
    URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz
    URL_HASH SHA256=d6c65aca6b1ed68e7a182f4757257b107ae403032760ed6ef121c9d55e81757d
)
FetchContent_MakeAvailable(nlohmann_json)

# ─── Sources ──────────────────────────────────────────────────────────────────

add_executable(market_generator
    src/main.cpp
    src/gbm_generator.cpp
    src/order_client.cpp
)

target_include_directories(market_generator PRIVATE src)

target_link_libraries(market_generator PRIVATE
    nlohmann_json::nlohmann_json
    yaml-cpp
    pthread
)

target_compile_options(market_generator PRIVATE
    -O3 -Wall -Wextra
)
