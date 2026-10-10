# Unbound save fixtures (local only)

Everything in this folder except this README is gitignored: real saves
contain personal trainer data (name, trainer/secret ID, nicknames).

To run the fixture-backed tests in `test/unbound/parse.test.mjs`:

- Copy one or more Unbound 2.1 `.sav` files here, named so they sort
  chronologically (e.g. `2026-10-06.sav`, `2026-10-10.sav`).
- Optionally add `expected.json` with per-save expected values:

  ```json
  {
    "saves": {
      "2026-10-06.sav": {
        "saveIndex": 510,
        "trainer": { "name": "...", "id": 0, "secretId": 0 },
        "playtime": { "hours": 0, "minutes": 0, "seconds": 0 },
        "badges": 1,
        "levelCap": 26,
        "party": ["nickname", "..."],
        "boxes": { "1": ["nickname", "..."] },
        "mons": { "<pid hex>": { "species": "...", "level": 0, "met": { "locationId": 0, "level": 0 } } }
      }
    }
  }
  ```

Without fixtures, those tests skip and the synthetic tests still run.
