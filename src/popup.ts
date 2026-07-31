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
