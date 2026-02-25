# 0WM OpMode (Operator Mode)

0WM OpMode is the operator dashboard for creating and preparing projects. You use it to upload floorplans, edit their boundaries and walls, georeference them on a world map, and send metadata to the [0WM Server](https://github.com/lab0-cc/0WM-Server). After setup, day-to-day surveying is mainly done in the [0WM Client](https://github.com/lab0-cc/0WM-Client).

## Quick Start

This project consists of static HTML/JS code and does not need a build step; you must however fetch its submodules:

```bash
git clone https://github.com/lab0-cc/0WM-OpMode.git
cd 0WM-OpMode
git submodule update --init --recursive
```

To run a local web server exposing those files, simply run:

```
python3 -m http.server 8001
```

Finally, open `http://127.0.0.1:8001`.

## Configuration

The only configuration necessary for the OpMode is to make it point to the server in `config.json`. For our development environment:

```json
{
  "api": "http://127.0.0.1:8000"
}
```

`api` must point to the 0WM Server.

## Creating a project

When you create a project, upload a floorplan image (`PNG`, `JPEG`, or `WebP`). A clean top-down image works best.

Use this workflow:

1. Set the project name.
2. In **Floorplan Editor**, draw the boundaries and walls.
3. In **Map Editor**, define placement anchors on the floorplan and perform georeferencing on the world map,
4. In **Additional Parameters**, set altitude values (`zmin`, `zmax`, `height`), with any two consistent values.

On a typical development environment, our documentation uses `127.0.0.1:8000` for the server, `127.0.0.1:8001` for the OpMode, `127.0.0.1:8002` for the client, and` 127.0.0.1:8003` for the mock AP.

## Funding

This project is funded through [NGI Zero Core](https://nlnet.nl/core), a fund established by [NLnet](https://nlnet.nl) with financial support from the European Commission's [Next Generation Internet](https://ngi.eu) program. Learn more at the [NLnet project page](https://nlnet.nl/project/0WM).

[<img src="https://nlnet.nl/logo/banner.png" alt="NLnet foundation logo" width="20%" />](https://nlnet.nl)
[<img src="https://nlnet.nl/image/logos/NGI0_tag.svg" alt="NGI Zero Logo" width="20%" />](https://nlnet.nl/core)
