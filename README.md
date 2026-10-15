# Pokémon Unbound Nuzlocke Companion

A fork of [domtronn/nuzlocke.app](https://github.com/domtronn/nuzlocke.app)
for one Nuzlocke run of **Pokémon Unbound 2.1.x** played on the Normal
(*Difficult*) setting. On top of the upstream tracker it adds:

- **Save sync** (`/sync`): read the game's save (Delta on iPhone → Delta Sync
  → Dropbox, or a `.sav` upload), preview it, and link Pokémon to tracker
  records. The live panel on the game page shows party, badges, level cap,
  met locations and the next boss.
- **Documented data**: level caps, main-story wild encounters (in the
  encounter picker) and Difficult boss teams, with provenance below.
- **Attempt history, notes and checklists** (`/history`, `/notes`).
- **Backup & restore** (`/backup`) and **end-to-end encrypted cross-device
  sync** (`/devices`).

Everything about a run lives in the browser's `localStorage` on each device.
The server only fetches the save from Dropbox and stores encrypted sync data.

## Set up

### Environment variables

Copy `.env.example` to `.env` for local development (`npm run dev`) and set
the same variables in Vercel (Project → Settings → Environment Variables).
Never commit real values.

| Variable | Needed for | Notes |
|---|---|---|
| `UNBOUND_SAVE_URL` | Save fetch | Dropbox shared link to Delta's `GameSave-<rom sha1>-gameSave` file |
| `UNBOUND_SYNC_KEY` | Save fetch | Random secret, at least 32 characters (`openssl rand -base64 36`) |
| `SYNC_SETUP_KEY` | Device sync | At least 32 characters and **different** from `UNBOUND_SYNC_KEY` |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`) | Device sync | Added by the Vercel Marketplace Upstash Redis integration |

Both server features fail closed: a missing or short key makes
`/api/unbound/save` and `/api/sync/*` answer `503 not-configured` instead of
running unprotected. Without the Redis variables, `npm run dev` uses a
temporary in-memory sync store; production reports `not-configured`.

### Save fetch (Delta → Dropbox)

1. In Delta, turn on Delta Sync with Dropbox. Delta stores the save as
   `Delta Emulator/GameSave-<rom sha1>-gameSave`.
2. In Dropbox, create a shared link to that file and set it as
   `UNBOUND_SAVE_URL`. Only `dropbox.com` shared-file links are accepted; the
   server follows Dropbox redirects only and never returns or logs the link.
3. On each device, open **Sync** (`/sync`), enter `UNBOUND_SYNC_KEY` once (it
   is kept in this browser only, under `nuzlocke.unbound.syncKey`; it is
   never synced or backed up), then *Fetch latest from Dropbox* - or *Choose .sav file*
   to upload one instead.
4. Review the preview and changes, then accept. Accepting stores the save as
   this run's baseline. Linked Pokémon (matched automatically only on a
   unique same-line nickname match, otherwise by your choice) update only
   species, nickname, nature and the active team; records are never created,
   deleted or marked dead.

Supported saves: Unbound 2.1.0–2.1.1.1 (save signature `0x01121999`). PC
box 24 is treated as the graveyard. Delta updates the Dropbox copy when it
syncs, so fetch again after Delta has synced.

### Cross-device sync (`/devices`)

Runs, archived attempts, notes, checklists and checklist progress can sync
between your devices from **Device sync** (`/devices`). It is end-to-end
encrypted: data is compressed and encrypted (AES-256-GCM, Web Crypto) in the
browser with a key the server never receives. The server stores only
ciphertext plus what it needs to sync: item ids (kind + random id), sizes,
revisions, device names and request times. Theme, user id and the Unbound
sync key never sync.

**Set up (once, in Vercel)**

1. Storage → Marketplace → *Upstash* → Redis → create a database (free tier
   is enough) and connect it to this project. This adds `KV_REST_API_URL` and
   `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_*`) to the environment.
2. Settings → Environment Variables → add `SYNC_SETUP_KEY` (Production):
   `openssl rand -base64 36`. It must differ from `UNBOUND_SYNC_KEY`.
3. Redeploy. Until both are set, `/api/sync/*` answers `503 not-configured`.

**Connect devices**

1. First device: Device sync → *setup key* → review the preview → *Connect
   and sync*. Save the **recovery key** it shows in a password manager.
2. Other devices: on a connected device, *Create a pairing code* (single use,
   15 minutes; it contains the encryption key) and enter it on the new device.
   Without another device: setup key + recovery key.
3. Every first connection shows what would be downloaded, uploaded or is
   different, and changes nothing until you confirm. Nothing local is deleted.

Revoke a lost device from the device list on any connected device. Changing
`SYNC_SETUP_KEY` only stops new enrolments; it doesn't affect connected
devices or the Unbound save fetch, and vice versa.

**Recovery**

- Keep using **Backup & restore** (`/backup`): it is independent of sync.
- Data lost on one device: connect it again (pairing code); it downloads
  everything. Or restore a backup there first; restoring never deletes, and
  what you restore uploads on the next sync (deleted items you restore come
  back – skip them in the restore preview if you don't want that).
- Recovery key lost but a device is still connected: *Show recovery key*.
- Recovery key exposed, or every device and the key lost: back up each device,
  then *Erase the synced copy* (setup key required) and set up again from the
  device with the best data. If no device and no key remain, the synced copy
  can't be decrypted – restore from a backup file.

### Backups

**Backup & restore** (`/backup`) downloads one JSON file with every run,
archived attempt, note and accepted Unbound save on this device (including
Pokémon nicknames and trainer details from accepted saves - keep it private).
It never contains the sync key or the save-fetch key.

- Download a backup before big changes (new attempt, restoring, erasing the
  synced copy) and now and then during a run.
- Restoring never deletes anything and changes nothing until you press
  *Apply*. Items that differ are listed; *Keep this device's copy* is the
  default.
- On a device connected to sync, whatever you restore uploads on the next
  sync. Choosing *Use the backup's copy* for an older backup replaces newer
  progress on your other devices too.
- Browsers can clear site data (for example Safari after a long period
  without visiting a site that isn't on the Home Screen). Device sync plus
  regular backups are the protection; on iPhone, adding the app to the Home
  Screen helps.

## Data sources and limitations

Provenance for every Unbound dataset is recorded in
`src/lib/data/unbound/provenance.json` (source, revision, retrieval date and
verification status). Summary:

| Data | Source | Status |
|---|---|---|
| Level caps (Difficult and higher) | [Pokémon Unbound Wiki - Level Cap](https://pokemonunbound.miraheze.org/wiki/Level_Cap) (CC BY-SA 4.0), cross-checked with [PokeCoders](https://www.pokemoncoders.com/level-caps-in-pokemon-unbound/) | Two sources agree |
| Main-story wild encounters | [Pokémon Unbound Wiki](https://pokemonunbound.miraheze.org) location pages, CC BY-SA 4.0, per-page revision ids in `src/lib/data/unbound/encounters.data.js` | Single source; species sample-checked against a second site |
| Normal boss teams | *Pokémon Unbound 2.1.1.1 Trainers Doc - Difficult Bosses [WIP]* workbook (local export; original link, author and license not recorded) | 28 of 30 main-story teams match it |
| Expert boss teams | Inherited from upstream; compared with the wiki only | Not verified |
| Route list, legacy encounter lists, move/ability patches | Inherited from upstream nuzlocke.app | Not verified |
| Save format, species ids | [PUSE](https://github.com/Zannael/PUSE) (MIT), vendored in `src/lib/unbound/vendor/puse` | Checked against real saves |
| Save met-location ids | The player's own saves | 15 ids, unconfirmed in game |

Data adapted from the Pokémon Unbound Wiki stays under CC BY-SA 4.0 (see the
header of each data file and the in-app Credits page). The code license is in
`LICENSE`.

**Known limitations**

- Expert boss teams are not imported from an Expert trainer document; 13 of
  the 30 main-story Expert teams differ from the wiki. The post-game Aklove
  battle at the Ruins of Void is not verified on either difficulty, and
  post-game routes aren't covered.
- Rival levels follow the game's level scaling, so the app's rival levels and
  evolutions can differ from what you meet.
- The Difficult trainer workbook is a work in progress and its latest
  revision can't be confirmed. Two of its values look misspelt (Houndoomite,
  "Bad Tantrum") and were not applied.
- Encounter data comes from one source. Species that only the older app data
  lists are shown as *Unverified*; Antisis City has no wild table on the wiki;
  Safari Zone rates, one Noctowl night rate and one Pelipper level range are
  unknown and shown as such.
- The level cap after Tarmigan Mansion (45) can't be read from the save, so
  at 4 badges both 40 and 45 are shown.
- Met locations for unmapped ids show as *Unknown location*.
- The automated tests don't cover a physical iPhone or the production
  deployment; check a new deploy by hand (pair two devices, fetch the save)
  before relying on it.

## Tests

```
npm test        # node --test over test/data, test/unbound, test/history, test/sync
npm run lint
npm run build
```

Tests that need the player's own save files (kept out of git in
`test/fixtures/unbound/`) are skipped without them. The Redis Lua scripts are
exercised when `redis-server` is installed locally, skipped otherwise.

## Upstream: Nuzlocke tracker

This project is designed for tracking Nuzlocke runs, the Pokemon
you've encountered and their status. But it also provides information
and adivce for Bosses you face. 

### Contributing

Currently, I'm working through entering the data for all existing
games but this can easily be made to support mods or other game
formats.

If you want to contribute you will need to provide 2 files, the
`routes.txt` and `league.txt` which should be in the following format
below named after the generation, e.g. `oras.txt`

**League data**
```
--1|Gym Leader Name|Gym Leader Speciality|/image/path
pokemon|level|move1,move2,move3,move4|ability|held-item
pokemon|level|move1,move2,move3,move4|ability|held-item
pokemon|level|move1,move2,move3,move4|ability|held-item
```

**Route data**
```
Route 1
Route 2
--Gym battle|1|gym-leader
Route 3
```

**Patches**
Patches are needed by
[RomHacks](https://en.wikipedia.org/wiki/ROM_Hacking) as they often
make changes to abilities, moves, items, and stats.

To support a **RomHack** you will need to provide a patches file containing the following

```
--item
item name|item sprite|item description

--move
name|type*|power*|description 

--ability
name|description

--pokemon
hp,atk,def,spa,spd,spe*|name|type1,type2*
```

`*` denotes optional fields, you can leave these blank but you must
include the necessary number of `|`s, e.g. `cut||90` will just modify
the power of `cut`

Pokemon stats are a **comma** `,` separated list, but you should only
include the modifications, e.g. `,,100` will modify the defense to
`100`

You can find extensive examples of these in the [Nuzlocke.data](https://github.com/domtronn/nuzlocke.data) project.


### Alternatives

There are a lot of alternatives out there, and whilst they don't meet
the needs I personally was looking for, you should absolutely check
them out and thank their creators.

- [Nuzlock tracker](https://nuzlocke.netlify.app/) - An all in one nuzlocke manager (most similar) 
- [Nuzlocke tracker](https://ashenfactory.github.io/nuzlocke-tracker/) - A simple in order route tracker
- [Nuzlog](https://techyfatih.github.io/Nuzlog/) - A journal, team and item manager
- [Nuzlocke Generator](https://nuzlocke-generator.herokuapp.com/) - Image creator for runs 

### Useful links

- [Sentry](https://sentry.io/organizations/nuzlocke-tracker/issues/?project=6109144) - Sentry error tracking
- [Analytics](https://nuzlocke-analytics.vercel.app/) - Page views and click trackingc
- [Updates & Support](https://www.buymeacoffee.com/dashboard) - Follow feature updates and support me
- [PixelIt](https://giventofly.github.io/pixelit/#tryit) - A Pixelator for making custom assets
- [Usprited](https://github.com/linuxenko/usprited) - A sprite sheet editor & CSS generator

<!-- https://www.fiverr.com/kohari_nk/make-pixel-16x16-icon?context_referrer=search_gigs&source=top-bar&ref_ctx_id=cf16eab512166c55524582f57bd11493&pckg_id=1&pos=4&context_type=auto&funnel=cf16eab512166c55524582f57bd11493&imp_id=0d9b6187-ef6d-4936-b92e-b8ca99a75986 -->


<!--
Script for testing on webpagetest

window.localStorage.setItem('nuzlocke', '1')
window.localStorage.setItem('nuzlocke.1','{"__team":["Cerulean City","Route 20","Route 3","Mt. Ember"],"Starter":{"id":0,"pokemon":"cyndaquil","location":"Starter"},"Pallet Town":{"id":1,"pokemon":"clamperl","location":"Pallet Town"},"Route 1":{"id":3,"pokemon":"zigzagoon-galar","location":"Route 1"},"Viridian City":{"id":5,"pokemon":"spearow","location":"Viridian City"},"Route 22":{"id":6,"pokemon":"paras","location":"Route 22"},"Route 2":{"id":7,"pokemon":"zigzagoon","location":"Route 2"},"Viridian Forest":{"id":8,"pokemon":"surskit","location":"Viridian Forest"},"Pewter City":{"id":12,"pokemon":"espurr","location":"Pewter City"},"Route 3":{"id":13,"pokemon":"meowth-alola","location":"Route 3"},"Route 4":{"id":14,"pokemon":"magikarp","location":"Route 4"},"Mt. Moon":{"id":15,"pokemon":"zubat","location":"Mt. Moon"},"Route 24":{"id":17,"pokemon":"slakoth","location":"Route 24"},"Route 25":{"id":19,"pokemon":"mantyke","location":"Route 25"},"Cerulean City":{"id":21,"pokemon":"luvdisc","location":"Cerulean City"},"Route 5":{"id":23,"pokemon":"growlithe","location":"Route 5"},"Route 6":{"id":24,"pokemon":"qwilfish","location":"Route 6"},"Vermillion City":{"id":25,"pokemon":"farfetchd-galar","location":"Vermillion City"},"Digletts Cave":{"id":27,"pokemon":"diglett-alola","location":"Digletts Cave"},"S.S. Anne":{"id":28,"pokemon":"wimpod","location":"S.S. Anne"},"Route 11":{"id":30,"pokemon":"golett","location":"Route 11"},"Route 9":{"id":32,"pokemon":"shelmet","location":"Route 9"},"Rock Tunnel":{"id":33,"pokemon":"stunfisk-galar","location":"Rock Tunnel"},"Route 10":{"id":34,"pokemon":"tynamo","location":"Route 10"},"Pokémon Tower":{"id":36,"pokemon":"runerigus","location":"Pokémon Tower"},"Route 12":{"id":37,"pokemon":"dewgong","location":"Route 12"},"Route 8":{"id":38,"pokemon":"girafarig","location":"Route 8"},"Route 7":{"id":39,"pokemon":"inkay","location":"Route 7"},"Celadon City":{"id":40,"pokemon":"honedge","location":"Celadon City"},"Saffron City":{"id":43,"pokemon":"mudkip","location":"Saffron City"},"Route 16":{"id":49,"pokemon":"durant","location":"Route 16"},"Route 17":{"id":50,"pokemon":"muk-alola","location":"Route 17"},"Route 18":{"id":51,"pokemon":"altaria","location":"Route 18"},"Fuschia City":{"id":52,"pokemon":"poliwag","location":"Fuschia City"},"Safari Zone":{"id":55,"pokemon":"klefki","location":"Safari Zone"},"Route 15":{"id":56,"pokemon":"tsareena","location":"Route 15"},"Route 14":{"id":57,"pokemon":"charjabug","location":"Route 14"},"Route 13":{"id":58,"pokemon":"mantine","location":"Route 13"},"Power Plant":{"id":59,"pokemon":"manectric","location":"Power Plant"},"Route 19":{"id":60,"pokemon":"shellder","location":"Route 19"},"Route 20":{"id":61,"pokemon":"wailord","location":"Route 20"},"Seafoam Islands":{"id":62,"pokemon":"vanilluxe","location":"Seafoam Islands"},"Cinnabar Island":{"id":66,"pokemon":"dhelmise","location":"Cinnabar Island"},"Pokémon Mansion":{"id":71,"pokemon":"liepard","location":"Pokémon Mansion"},"Route 21":{"id":73,"pokemon":"qwilfish","location":"Route 21"},"Route 23":{"id":76,"pokemon":"fearow","location":"Route 23"},"Victory Road":{"id":77,"pokemon":"medicham","location":"Victory Road"},"Three Island":{"id":88,"pokemon":"smeargle","location":"Three Island"},"Mt. Ember":{"id":89,"pokemon":"coalossal","location":"Mt. Ember"},"Treasure Beach":{"id":90,"pokemon":"meltan","location":"Treasure Beach"},"Berry Forest":{"id":91,"pokemon":"durant","location":"Berry Forest"},"Bond Bridge":{"id":92,"pokemon":"hawlucha","location":"Bond Bridge"},"Cape Brink":{"id":93,"pokemon":"feebas","location":"Cape Brink"},"Kindle Road":{"id":94,"pokemon":"eelektross","location":"Kindle Road"},"Cerulean Cave":{"id":99,"pokemon":"machamp","location":"Cerulean Cave"}}')
window.localStorage.setItem('nuzlocke.consent', 'true')
window.localStorage.setItem('nuzlocke.saves', '1|1683021373039>1683185762250|Web Page Test Data|radred|01110100|1')
window.localStorage.setItem('nuzlocke.theme', 'dark')
-->
