import packageData from '../package.json'

// Versions come from package.json so this list cannot drift out of date; only
// the display name and license URL need maintaining here.
const LIBRARIES: { pkg: keyof typeof packageData.dependencies; label: string; license: string }[] =
  [
    {
      pkg: 'pbf',
      label: 'mapbox/pbf',
      license: 'https://github.com/mapbox/pbf/blob/main/LICENSE',
    },
    {
      pkg: '@mapbox/vector-tile',
      label: 'mapbox/vector-tile-js',
      license: 'https://github.com/mapbox/vector-tile-js/blob/main/LICENSE.txt',
    },
    {
      pkg: 'pretty-ms',
      label: 'sindresorhus/pretty-ms',
      license: 'https://github.com/sindresorhus/pretty-ms/blob/main/license',
    },
    {
      pkg: 'pretty-bytes',
      label: 'sindresorhus/pretty-bytes',
      license: 'https://github.com/sindresorhus/pretty-bytes/blob/main/license',
    },
    {
      pkg: 'hashery',
      label: 'jaredwray/hashery',
      license: 'https://github.com/jaredwray/hashery/blob/main/LICENSE',
    },
    {
      pkg: 'vanilla-jsoneditor',
      label: 'josdejong/vanilla-jsoneditor',
      license: 'https://github.com/josdejong/svelte-jsoneditor/blob/develop/LICENSE.md',
    },
  ]

const librariesList = document.getElementById('libraries')
if (librariesList) {
  librariesList.replaceChildren(
    ...LIBRARIES.map(({ pkg, label, license }) => {
      const item = document.createElement('li')
      const link = document.createElement('a')
      link.href = license
      link.textContent = `${label} ${packageData.dependencies[pkg].replace(/^[^\d]*/, '')}`
      item.appendChild(link)
      return item
    }),
  )
}

const links = document.getElementsByTagName('a')

for (let i = 0; i < links.length; i++) {
  const link = links[i]
  link?.addEventListener('click', function (e) {
    e.preventDefault()
    const url = link.getAttribute('href')
    if (url) {
      chrome.tabs.create({ url })
    }
  })
}
