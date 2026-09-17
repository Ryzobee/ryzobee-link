/* Host-only bridge: use the selected firmware's parsers; never execute Lua. */
#include <stddef.h>
#include <stdio.h>
#include "lua.h"
#include "lauxlib.h"
#include "ryz_script_metadata.h"

size_t ryz_skill_metadata_size(void) { return sizeof(ryz_script_metadata_t); }
size_t ryz_skill_source_max(void) { return RYZ_SCRIPT_METADATA_SOURCE_MAX; }

const char *ryz_skill_metadata_value(const ryz_script_metadata_t *m, int field) {
    if (field == 0) return m->author;
    if (field == 1) return m->version;
    return m->description;
}

int ryz_skill_metadata_flags(const ryz_script_metadata_t *m, int field) {
    if (field == 0)
        return m->author_present | (m->author_truncated << 1) | (m->author_invalid << 2);
    if (field == 1)
        return m->version_present | (m->version_truncated << 1) | (m->version_invalid << 2);
    return m->description_present | (m->description_truncated << 1) | (m->description_invalid << 2);
}

int ryz_skill_lua_check(const char *source, size_t length, char *error, size_t capacity) {
    lua_State *L = luaL_newstate();
    if (!L) {
        snprintf(error, capacity, "Lua parser allocation failed");
        return LUA_ERRMEM;
    }
    /* Text-only compilation, no standard libraries, lua_call or lua_pcall. */
    int status = luaL_loadbufferx(L, source, length, "@script", "t");
    if (status != LUA_OK) {
        const char *message = lua_tostring(L, -1);
        snprintf(error, capacity, "%s", message ? message : "Lua syntax error");
    } else if (capacity) {
        error[0] = '\0';
    }
    lua_close(L);
    return status;
}
