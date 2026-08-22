# CF AI Chat Mod Registry

Official curated mod registry for CF AI Chat. This is the GitHub repository that the in-app **Mod Store** pulls from.

- **No sketchy forums** - mods here are hand-picked by the CF AI Chat team / moderators from Discord submissions.
- **Storefront** in the app fetches `registry.json` first, then lazy-loads each mod's `store.json` as you scroll, with recommendations based on your installed mods' permissions/tags.

## Structure

```
CF-AI-Mod-Registry/
  registry.json          # index of all mods (ids + where to find store.json)
  packages.json          # alias for registry.json (for backwards compat)
  mods/
    <mod-id>/
      store.json         # full storefront metadata for this mod
      thumbnail.png      # 256x256 thumbnail (optional)
      README.md          # optional
      <mod-id>.zip       # optional downloadable zip (or use GitHub release URL)
```

## For Users

The Mod Store in `CF AI Chat > Mods > Add Mods` automatically pulls from `https://raw.githubusercontent.com/<your-user>/CF-AI-Mod-Registry/main/registry.json` (configurable). For local dev, it falls back to this local folder.

## For Moderators

Use `tools/register_mod.py` - drag & drop a mod zip, it will:
1. Decompress to temp and validate `manifest.json`
2. Create `mods/<mod-id>/` folder
3. Generate `store.json` from manifest + thumbnail
4. Update `registry.json` / `packages.json`

Then `git add && git commit && git push`.

## Storefront Logic

- On open, app downloads `registry.json` (all mod IDs + `registryPath` to each `store.json`)
- While scrolling, it lazily fetches `store.json` for visible mods
- Recommendations score based on installed mods' `permissions` and `tags` (e.g., if you have many `storage`/`tools` mods tagged `productivity`, those mods rank higher)
- Search and tag filtering is client-side after registry load

## Adding a Mod Manually

1. `mods/<id>/store.json` example:
```json
{
  "id": "permanent-memory",
  "name": "Permanent Memory",
  "version": "1.0.0",
  "author": "CF AI Chat Team",
  "description": "Gives the AI permanent memory...",
  "tags": ["memory", "productivity"],
  "permissions": ["storage", "systemPrompt", "tools"],
  "modApiVersion": "1.0.0",
  "thumbnail": "thumbnail.png",
  "downloadUrl": "https://github.com/<user>/CF-AI-Mod-Registry/releases/download/permanent-memory-1.0.0/permanent-memory.zip",
  "storeJson": "mods/permanent-memory/store.json"
}
```
2. Update `registry.json` `mods` array to include it.
