cmake_minimum_required(VERSION 3.20)
project(trigger_engine CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type")

# ─── Dependencies ─────────────────────────────────────────────────────────────

find_package(PkgConfig REQUIRED)
pkg_check_modules(HIREDIS REQUIRED hiredis)

find_package(yaml-cpp REQUIRED)

# libpq (PostgreSQL C client library)
find_package(PostgreSQL REQUIRED)

# nlohmann/json (header-only, fetched at configure time)
include(FetchContent)
FetchContent_Declare(
    nlohmann_json
    URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz
    URL_HASH SHA256=d6c65aca6b1ed68e7a182f4757257b107ae403032760ed6ef121c9d55e81757d
)
FetchContent_MakeAvailable(nlohmann_json)

# ─── Sources ──────────────────────────────────────────────────────────────────

add_executable(trigger_engine
    src/main.cpp
    src/trigger_engine.cpp
    src/pg_client.cpp
    src/redis_sub.cpp
    src/engine_client.cpp
)

target_include_directories(trigger_engine PRIVATE
    src
    ${HIREDIS_INCLUDE_DIRS}
    ${PostgreSQL_INCLUDE_DIRS}
)

target_link_libraries(trigger_engine PRIVATE
    ${HIREDIS_LIBRARIES}
    ${PostgreSQL_LIBRARIES}
    nlohmann_json::nlohmann_json
    yaml-cpp
    pthread
)

target_compile_options(trigger_engine PRIVATE
    -O3 -Wall -Wextra
)
