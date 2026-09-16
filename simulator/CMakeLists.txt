cmake_minimum_required(VERSION 3.20)
project(ryzobee_link_simulator LANGUAGES C CXX)
set(CMAKE_C_STANDARD 11)
if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "Use emcmake cmake. This is a browser WASM target.")
endif()
set(RYZ_FIRMWARE "" CACHE PATH "Pinned RootMaker firmware/rootmaker directory")
if(NOT EXISTS "${RYZ_FIRMWARE}/components/ryz_runtime/app_runtime.c")
  message(FATAL_ERROR "Set RYZ_FIRMWARE to the locked firmware/rootmaker directory")
endif()
set(LV_BUILD_CONF_PATH "${CMAKE_CURRENT_SOURCE_DIR}/lv_conf.h" CACHE PATH "" FORCE)
set(LV_BUILD_SET_CONFIG_OPTS OFF CACHE BOOL "" FORCE)
set(LV_BUILD_USE_KCONFIG OFF CACHE BOOL "" FORCE)
set(CONFIG_LV_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(CONFIG_LV_BUILD_DEMOS OFF CACHE BOOL "" FORCE)
set(CONFIG_LV_USE_THORVG_INTERNAL OFF CACHE BOOL "" FORCE)
add_subdirectory("${RYZ_FIRMWARE}/managed_components/lvgl__lvgl" lvgl)
add_executable(ryzobee
  bridge.c display.c
  "${RYZ_FIRMWARE}/host/pixels/platform.c"
  "${RYZ_FIRMWARE}/components/ryz_runtime/app_runtime.c"
  "${RYZ_FIRMWARE}/components/ryz_runtime/app_tools.c"
  "${RYZ_FIRMWARE}/components/ryz_lvgl/ryz_lvgl.c"
  "${RYZ_FIRMWARE}/components/ryz_lvgl/ryz_lua_assets.c"
  "${RYZ_FIRMWARE}/components/ryz_lvgl/ryz_lvgl_perf.c"
  "${RYZ_FIRMWARE}/components/ryz_font/ryz_font_disabled.c"
  "${RYZ_FIRMWARE}/components/ryz_system_ui/ryz_v5_font.c"
  "${RYZ_FIRMWARE}/managed_components/georgik__lua/lua/onelua.c")
target_include_directories(ryzobee PRIVATE
  "${RYZ_FIRMWARE}/host/pixels/stubs"
  "${RYZ_FIRMWARE}/components/ryz_runtime/include"
  "${RYZ_FIRMWARE}/components/ryz_lvgl/include"
  "${RYZ_FIRMWARE}/components/ryz_font/include"
  "${RYZ_FIRMWARE}/components/ryz_system_ui/include"
  "${RYZ_FIRMWARE}/components/ryz_board/include"
  "${RYZ_FIRMWARE}/components/ryz_board"
  "${RYZ_FIRMWARE}/components/ryz_tools/include"
  "${RYZ_FIRMWARE}/components/ryz_i2c_scan/include"
  "${RYZ_FIRMWARE}/components/ryz_rgb/include"
  "${RYZ_FIRMWARE}/components/ryz_monitor/include"
  "${RYZ_FIRMWARE}/managed_components/georgik__lua/include"
  "${RYZ_FIRMWARE}/managed_components/georgik__lua/lua")
target_compile_definitions(ryzobee PRIVATE MAKE_LIB CONFIG_LUA_MAXSTACK=8192)
target_compile_options(ryzobee PRIVATE -Wall -Wextra -Wno-unused-parameter)
target_link_libraries(ryzobee PRIVATE lvgl m)
target_link_options(ryzobee PRIVATE
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=worker -sASYNCIFY=1
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=16777216 -sMAXIMUM_MEMORY=67108864
  -sSTACK_SIZE=262144 -sASYNCIFY_STACK_SIZE=262144
  "-sEXPORTED_FUNCTIONS=['_link_run','_link_stop','_link_pointer','_malloc','_free']"
  "-sEXPORTED_RUNTIME_METHODS=['ccall','UTF8ToString','HEAPU8']"
  -sASSERTIONS=1 --no-entry)
set_target_properties(ryzobee PROPERTIES SUFFIX ".js")
