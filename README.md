# Mapbox Vector Tiles

Just-in-time parser for loaded Mapbox Vector Tiles (https://docs.mapbox.com/vector-tiles/specification/).

Forked from the original by [Leonid Gorshkov](https://github.com/gorshkov-leonid/mapbox-vector-tiles-chrome-extension), but modified to use [Typescript](https://github.com/microsoft/TypeScript), [Vite](https://github.com/vitejs/vite) build tooling, and to comply with [Chrome's Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3). I also added dark mode (driven by the browser setting).

![Screenshot](/screenshot.png)

## Installing

1. Check if your `Node.js` version is >= **25** or use [Volta](https://github.com/volta-cli/volta).
2. Run `npm install` to install the dependencies.

## Developing

run the command

```shell
$ npm run dev
```

## Packing

run the command

```shell
$ npm run build
```

Now, the content of `build` folder will be the packaged extension.
